/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { CommandHandler, CommandGateway } from '../command.gateway.js';
import {
  AddAsset,
  DeleteAsset,
  RecomputeAsset,
  RecomputeProject,
  type AddAssetResult,
  type AddRecipeResult,
} from '../command/asset.command.js';
import type { CoreHasher, CoreHashResult } from '../../domain/provider/hasher.provider.js';
import type { Assets, AssetHashes } from '../../domain/repo/asset.repo.js';
import type { Projects } from '../../domain/repo/project.repo.js';
import type { Algorithm, Project } from '../../domain/model/model.js';
import type { AssetWriter, AssetHashWriter, AssetHashDuplicateWriter } from '../writer/asset.writer.js';
import type { AlgorithmService } from '../service/algorithm.service.js';
import { AssetAddStatus } from '../../domain/model/asset.model.js';
import { Comparison } from '../../domain/model/algorithm.model.js';
import type { Config } from '../../infrastructure/config/types.js';
import { NotFoundError } from '../../domain/errors.js';

export class AssetHandlers {
  constructor(
    private readonly coreHasher: CoreHasher,
    private readonly algorithmService: AlgorithmService,
    private readonly projects: Projects,
    private readonly assets: Assets,
    private readonly assetWriter: AssetWriter,
    private readonly assetHashes: AssetHashes,
    private readonly assetHashWriter: AssetHashWriter,
    private readonly assetHashDuplicateWriter: AssetHashDuplicateWriter,
    private readonly config: Config,
    private readonly commandGateway: CommandGateway,
  ) {}

  async add(command: AddAsset): Promise<AddAssetResult> {
    const project = await this.projects.findById(command.projectId);

    if (!project) {
      throw NotFoundError.project(command.projectId);
    }

    const asset = await this.assetWriter.create({
      projectId: command.projectId,
      identityId: command.identityId,
      identityPath: command.identityPath,
    });
    const coreResults = await this.coreHasher.hash(command.mimeHint, command.fileContentBase64, project.recipes);

    const results: AddRecipeResult[] = [];

    for (const coreResult of coreResults) {
      const algorithm = await this.algorithmService.resolveAlgorithm(coreResult.recipe);

      results.push(await this.addRecipe(project, asset.id, algorithm, coreResult));
    }

    return { identity: asset.identity, results };
  }

  private async addRecipe(
    project: Project,
    assetId: string,
    algorithm: Algorithm,
    coreResult: CoreHashResult,
  ): Promise<AddRecipeResult> {
    const existing = (await this.assetHashes.findByAssetId(assetId)).filter((row) => row.algorithmId === algorithm.id);
    const unchanged =
      existing.length === coreResult.hashes.length &&
      existing.every((row) => row.hash === coreResult.hashes[row.sequenceIndex]);

    if (unchanged) {
      // Frequent update events (metadata changes without a change to the binary content) must
      // not trigger unnecessary similarity recomputation.
      return { recipe: coreResult.recipe, hashes: coreResult.hashes, status: AssetAddStatus.UNCHANGED };
    }

    if (existing.length > 0) {
      await this.assetHashDuplicateWriter.deleteByAsset(algorithm.id, assetId);
    }

    await this.assetHashWriter.replaceAll(assetId, algorithm.id, coreResult.hashes);

    await this.commandGateway.dispatch(
      new RecomputeAsset(project.id, algorithm.id, algorithm.comparison, assetId, project.hammingThreshold),
    );

    return {
      recipe: coreResult.recipe,
      hashes: coreResult.hashes,
      status: existing.length > 0 ? AssetAddStatus.UPDATED : AssetAddStatus.CREATED,
    };
  }

  async delete(command: DeleteAsset): Promise<void> {
    const asset = await this.assets.findByIdentity(command.projectId, command.identity);

    if (asset === null) {
      return;
    }

    const algorithmIds = new Set((await this.assetHashes.findByAssetId(asset.id)).map((hash) => hash.algorithmId));

    for (const algorithmId of algorithmIds) {
      await this.assetHashDuplicateWriter.deleteByAsset(algorithmId, asset.id);
    }

    await this.assetWriter.deleteByIdentity(command.projectId, command.identity);
  }

  /** The single place that decides exact-vs-hamming recompute behaviour — see `RecomputeAsset`'s doc comment. */
  async recomputeAsset(command: RecomputeAsset): Promise<void> {
    if (command.comparison === Comparison.EXACT) {
      await this.assetHashDuplicateWriter.recomputeExact(command.projectId, command.algorithmId, command.assetId);

      return;
    }

    if (command.comparison === Comparison.HAMMING) {
      const minSimilarity = command.hammingThreshold ?? this.config.default_hamming_threshold;

      await this.assetHashDuplicateWriter.recomputeHamming(
        command.projectId,
        command.algorithmId,
        command.assetId,
        minSimilarity,
      );

      return;
    }

    throw new Error(`comparison '${command.comparison}' has no application-layer implementation yet`);
  }

  async recomputeProject(command: RecomputeProject): Promise<number> {
    await this.assetHashDuplicateWriter.deleteByProject(command.projectId, command.algorithmId);

    let cursor: string | null = null;
    let processed = 0;

    for (;;) {
      const ids = await this.assets.listIdsWithHash(command.projectId, command.algorithmId, cursor, command.batchSize);

      if (ids.length === 0) {
        break;
      }

      for (const assetId of ids) {
        await this.commandGateway.dispatch(
          new RecomputeAsset(
            command.projectId,
            command.algorithmId,
            command.comparison,
            assetId,
            command.hammingThreshold,
          ),
        );
      }

      processed += ids.length;
      /* v8 ignore next -- unreachable: ids is non-empty here (the empty case already broke out above) */
      cursor = ids[ids.length - 1] ?? null;
      command.onBatch?.(processed);

      if (ids.length < command.batchSize) {
        break;
      }
    }

    return processed;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  asHandlers(): CommandHandler<any, any>[] {
    const add: CommandHandler<AddAsset, AddAssetResult> = {
      commandClass: AddAsset,
      execute: this.add.bind(this),
    };
    const del: CommandHandler<DeleteAsset, void> = {
      commandClass: DeleteAsset,
      execute: this.delete.bind(this),
    };
    const recomputeAsset: CommandHandler<RecomputeAsset, void> = {
      commandClass: RecomputeAsset,
      execute: this.recomputeAsset.bind(this),
    };
    const recomputeProject: CommandHandler<RecomputeProject, number> = {
      commandClass: RecomputeProject,
      execute: this.recomputeProject.bind(this),
    };

    return [add, del, recomputeAsset, recomputeProject];
  }
}
