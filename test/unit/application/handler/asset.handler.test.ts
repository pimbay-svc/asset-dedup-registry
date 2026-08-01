import { describe, it, expect, vi } from 'vitest';
import { AssetHandlers } from '../../../../src/application/handler/asset.handler.js';
import {
  AddAsset,
  DeleteAsset,
  RecomputeAsset,
  RecomputeProject,
} from '../../../../src/application/command/asset.command.js';
import { AssetAddStatus, MimeHintType, Identity } from '../../../../src/domain/model/asset.model.js';
import { Comparison } from '../../../../src/domain/model/algorithm.model.js';
import type { CoreHasher } from '../../../../src/domain/provider/hasher.provider.js';
import type { Assets, AssetHashes } from '../../../../src/domain/repo/asset.repo.js';
import type { Projects } from '../../../../src/domain/repo/project.repo.js';
import type {
  AssetWriter,
  AssetHashWriter,
  AssetHashDuplicateWriter,
} from '../../../../src/application/writer/asset.writer.js';
import type { AlgorithmService } from '../../../../src/application/service/algorithm.service.js';
import type { CommandGateway } from '../../../../src/application/command.gateway.js';
import type { Config } from '../../../../src/infrastructure/config/types.js';
import type { Algorithm, AssetHash, Project, Asset } from '../../../../src/domain/model/model.js';
import { NotFoundError } from '../../../../src/domain/errors.js';

const MIME_HINT = { type: MimeHintType.MIME, value: 'image/jpeg' };

const CONFIG: Config = {
  core_base_url: 'http://core:3000',
  core_timeout_ms: 5000,
  default_hamming_threshold: 90,
  default_rate_limit_per_minute: 300,
  database: { pool_size: 5 },
};

const PROJECT: Project = {
  id: 'project-1',
  slug: 'demo',
  name: 'Demo',
  recipes: ['binary.sha256'],
  hammingThreshold: null,
  rateLimitPerMinute: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const ASSET: Asset = {
  id: 'asset-uuid-1',
  projectId: 'project-1',
  identityId: 'asset-1',
  identityPath: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const CREATE_ASSET_RESULT = { id: ASSET.id, identity: new Identity('asset-1', null) };

const ALGORITHM: Algorithm = { id: 1, recipe: 'binary.sha256', comparison: Comparison.EXACT };

function existingHash(hash: string, sequenceIndex = 0): AssetHash {
  return {
    id: 1,
    assetId: ASSET.id,
    algorithmId: ALGORITHM.id,
    sequenceIndex,
    hash,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

interface Deps {
  coreHasher: CoreHasher;
  algorithmService: AlgorithmService;
  projects: Projects;
  assets: Assets;
  assetWriter: AssetWriter;
  assetHashes: AssetHashes;
  assetHashWriter: AssetHashWriter;
  assetHashDuplicateWriter: AssetHashDuplicateWriter;
  config: Config;
  commandGateway: CommandGateway;
}

function buildDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    coreHasher: {
      hash: vi.fn().mockResolvedValue([{ recipe: 'binary.sha256', hashes: ['abc123'] }]),
      listAlgorithms: vi.fn(),
    },
    algorithmService: { resolveAlgorithm: vi.fn().mockResolvedValue(ALGORITHM) } as unknown as AlgorithmService,
    projects: { findById: vi.fn().mockResolvedValue(PROJECT), findBySlug: vi.fn(), getBySlug: vi.fn(), list: vi.fn() },
    assets: {
      findByIdentity: vi.fn().mockResolvedValue(ASSET),
      getByIdentity: vi.fn(),
      listRecipes: vi.fn(),
      countByProject: vi.fn(),
      listIdsWithHash: vi.fn().mockResolvedValue([]),
      countPerRecipe: vi.fn(),
      getActivitySummary: vi.fn(),
    },
    assetWriter: { create: vi.fn().mockResolvedValue(CREATE_ASSET_RESULT), deleteByIdentity: vi.fn() },
    assetHashes: { findOne: vi.fn(), findByAssetId: vi.fn().mockResolvedValue([]), countExactDuplicateStats: vi.fn() },
    assetHashWriter: { replaceAll: vi.fn() },
    assetHashDuplicateWriter: {
      recomputeExact: vi.fn(),
      recomputeHamming: vi.fn(),
      deleteByAsset: vi.fn(),
      deleteByProject: vi.fn(),
    },
    config: CONFIG,
    commandGateway: { dispatch: vi.fn(), register: vi.fn(), registerAll: vi.fn() } as unknown as CommandGateway,
    ...overrides,
  };
}

function buildHandlers(deps: Deps): AssetHandlers {
  return new AssetHandlers(
    deps.coreHasher,
    deps.algorithmService,
    deps.projects,
    deps.assets,
    deps.assetWriter,
    deps.assetHashes,
    deps.assetHashWriter,
    deps.assetHashDuplicateWriter,
    deps.config,
    deps.commandGateway,
  );
}

const COMMAND = new AddAsset('project-1', 'asset-1', null, MIME_HINT, 'ZmFrZQ==');

describe('AssetHandlers.add', () => {
  it('throws NotFoundError when the project does not exist', async () => {
    const deps = buildDeps({
      projects: { findById: vi.fn().mockResolvedValue(null), findBySlug: vi.fn(), getBySlug: vi.fn(), list: vi.fn() },
    });

    await expect(buildHandlers(deps).add(COMMAND)).rejects.toThrow(NotFoundError);
  });

  it('creates a new hash when none existed before', async () => {
    const deps = buildDeps();
    const createSpy = vi.spyOn(deps.assetWriter, 'create');
    const deleteByAssetSpy = vi.spyOn(deps.assetHashDuplicateWriter, 'deleteByAsset');
    const replaceAllSpy = vi.spyOn(deps.assetHashWriter, 'replaceAll');
    const dispatchSpy = vi.spyOn(deps.commandGateway, 'dispatch');
    const result = await buildHandlers(deps).add(COMMAND);

    expect(result.results).toEqual([{ recipe: 'binary.sha256', hashes: ['abc123'], status: AssetAddStatus.CREATED }]);
    expect(result.identity).toEqual(CREATE_ASSET_RESULT.identity);
    expect(createSpy).toHaveBeenCalledWith({ projectId: 'project-1', identityId: 'asset-1', identityPath: null });
    expect(deleteByAssetSpy).not.toHaveBeenCalled();
    expect(replaceAllSpy).toHaveBeenCalledWith(ASSET.id, ALGORITHM.id, ['abc123']);
    expect(dispatchSpy).toHaveBeenCalledWith(
      new RecomputeAsset(PROJECT.id, ALGORITHM.id, ALGORITHM.comparison, ASSET.id, PROJECT.hammingThreshold),
    );
  });

  it('detects a change even when only one of several hash sequences differs (not just when all differ)', async () => {
    const deps = buildDeps({
      coreHasher: {
        hash: vi.fn().mockResolvedValue([{ recipe: 'binary.sha256', hashes: ['abc123', 'CHANGED'] }]),
        listAlgorithms: vi.fn(),
      },
      assetHashes: {
        findOne: vi.fn(),
        findByAssetId: vi.fn().mockResolvedValue([existingHash('abc123', 0), existingHash('def456', 1)]),
        countExactDuplicateStats: vi.fn(),
      },
    });

    const result = await buildHandlers(deps).add(COMMAND);

    // sequence 0 (abc123) is unchanged but sequence 1 (def456 -> CHANGED) differs — the set as a whole changed.
    expect(result.results[0]?.status).toBe(AssetAddStatus.UPDATED);
  });

  it("ignores another algorithm's hash rows for the same asset when checking for a change", async () => {
    const otherAlgorithmHash: AssetHash = { ...existingHash('unrelated'), algorithmId: 999 };
    const deps = buildDeps({
      assetHashes: {
        findOne: vi.fn(),
        findByAssetId: vi.fn().mockResolvedValue([otherAlgorithmHash]),
        countExactDuplicateStats: vi.fn(),
      },
    });

    const result = await buildHandlers(deps).add(COMMAND);

    // no existing row for *this* algorithm (only one belonging to algorithm 999) — this is a first-time hash.
    expect(result.results[0]?.status).toBe(AssetAddStatus.CREATED);
  });

  it('is a no-op when the existing hash is unchanged', async () => {
    const deps = buildDeps({
      assetHashes: {
        findOne: vi.fn(),
        findByAssetId: vi.fn().mockResolvedValue([existingHash('abc123')]),
        countExactDuplicateStats: vi.fn(),
      },
    });

    const replaceAllSpy = vi.spyOn(deps.assetHashWriter, 'replaceAll');
    const dispatchSpy = vi.spyOn(deps.commandGateway, 'dispatch');
    const result = await buildHandlers(deps).add(COMMAND);

    expect(result.results).toEqual([{ recipe: 'binary.sha256', hashes: ['abc123'], status: AssetAddStatus.UNCHANGED }]);
    expect(replaceAllSpy).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('deletes old duplicate rows and recomputes when the hash changed', async () => {
    const deps = buildDeps({
      assetHashes: {
        findOne: vi.fn(),
        findByAssetId: vi.fn().mockResolvedValue([existingHash('oldhash')]),
        countExactDuplicateStats: vi.fn(),
      },
    });

    const deleteByAssetSpy = vi.spyOn(deps.assetHashDuplicateWriter, 'deleteByAsset');
    const dispatchSpy = vi.spyOn(deps.commandGateway, 'dispatch');
    const result = await buildHandlers(deps).add(COMMAND);

    expect(result.results[0]?.status).toBe(AssetAddStatus.UPDATED);
    expect(deleteByAssetSpy).toHaveBeenCalledWith(ALGORITHM.id, ASSET.id);
    expect(dispatchSpy).toHaveBeenCalled();
  });

  it('handles multiple recipes from a single core response independently', async () => {
    const otherAlgorithm: Algorithm = { id: 2, recipe: 'image.phash16', comparison: Comparison.HAMMING };
    const deps = buildDeps({
      coreHasher: {
        hash: vi.fn().mockResolvedValue([
          { recipe: 'binary.sha256', hashes: ['abc123'] },
          { recipe: 'image.phash16', hashes: ['deadbeef'] },
        ]),
        listAlgorithms: vi.fn(),
      },
      algorithmService: {
        resolveAlgorithm: vi
          .fn()
          .mockImplementation((recipe: string) =>
            Promise.resolve(recipe === 'binary.sha256' ? ALGORITHM : otherAlgorithm),
          ),
      } as unknown as AlgorithmService,
    });

    const result = await buildHandlers(deps).add(COMMAND);

    expect(result.results).toHaveLength(2);
    expect(result.results.map((r) => r.recipe)).toEqual(['binary.sha256', 'image.phash16']);
  });
});

describe('AssetHandlers.delete', () => {
  it('deletes the asset row by identity — hash/duplicate rows cascade via FK', async () => {
    const deps = buildDeps();
    const findByIdentitySpy = vi.spyOn(deps.assets, 'findByIdentity');
    const deleteByIdentitySpy = vi.spyOn(deps.assetWriter, 'deleteByIdentity');

    await buildHandlers(deps).delete(new DeleteAsset('project-1', new Identity('asset-1', null)));

    expect(findByIdentitySpy).toHaveBeenCalledWith('project-1', new Identity('asset-1', null));
    expect(deleteByIdentitySpy).toHaveBeenCalledWith('project-1', new Identity('asset-1', null));
  });

  it('deletes duplicate rows for every algorithm the asset was hashed under', async () => {
    const deps = buildDeps({
      assetHashes: {
        findOne: vi.fn(),
        findByAssetId: vi.fn().mockResolvedValue([existingHash('abc123', 0), { ...existingHash('x'), algorithmId: 2 }]),
        countExactDuplicateStats: vi.fn(),
      },
    });
    const deleteByAssetSpy = vi.spyOn(deps.assetHashDuplicateWriter, 'deleteByAsset');

    await buildHandlers(deps).delete(new DeleteAsset('project-1', new Identity('asset-1', null)));

    expect(deleteByAssetSpy).toHaveBeenCalledWith(ALGORITHM.id, ASSET.id);
    expect(deleteByAssetSpy).toHaveBeenCalledWith(2, ASSET.id);
    expect(deleteByAssetSpy).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when the asset does not exist', async () => {
    const deps = buildDeps({
      assets: {
        findByIdentity: vi.fn().mockResolvedValue(null),
        getByIdentity: vi.fn(),
        listRecipes: vi.fn(),
        countByProject: vi.fn(),
        listIdsWithHash: vi.fn().mockResolvedValue([]),
        countPerRecipe: vi.fn(),
        getActivitySummary: vi.fn(),
      },
    });
    const deleteByIdentitySpy = vi.spyOn(deps.assetWriter, 'deleteByIdentity');
    const findByAssetIdSpy = vi.spyOn(deps.assetHashes, 'findByAssetId');

    await buildHandlers(deps).delete(new DeleteAsset('project-1', new Identity('missing', null)));

    expect(findByAssetIdSpy).not.toHaveBeenCalled();
    expect(deleteByIdentitySpy).not.toHaveBeenCalled();
  });
});

describe('AssetHandlers.recomputeAsset', () => {
  it('delegates exact-comparison recipes to recomputeExact', async () => {
    const deps = buildDeps();
    const recomputeExactSpy = vi.spyOn(deps.assetHashDuplicateWriter, 'recomputeExact');
    const recomputeHammingSpy = vi.spyOn(deps.assetHashDuplicateWriter, 'recomputeHamming');

    await buildHandlers(deps).recomputeAsset(new RecomputeAsset('p1', 1, Comparison.EXACT, 'a1', null));

    expect(recomputeExactSpy).toHaveBeenCalledWith('p1', 1, 'a1');
    expect(recomputeHammingSpy).not.toHaveBeenCalled();
  });

  it('uses the given hammingThreshold when set', async () => {
    const deps = buildDeps();
    const recomputeHammingSpy = vi.spyOn(deps.assetHashDuplicateWriter, 'recomputeHamming');

    await buildHandlers(deps).recomputeAsset(new RecomputeAsset('p1', 1, Comparison.HAMMING, 'a1', 95));

    expect(recomputeHammingSpy).toHaveBeenCalledWith('p1', 1, 'a1', 95);
  });

  it('falls back to the config default when hammingThreshold is null', async () => {
    const deps = buildDeps();
    const recomputeHammingSpy = vi.spyOn(deps.assetHashDuplicateWriter, 'recomputeHamming');

    await buildHandlers(deps).recomputeAsset(new RecomputeAsset('p1', 1, Comparison.HAMMING, 'a1', null));

    expect(recomputeHammingSpy).toHaveBeenCalledWith('p1', 1, 'a1', 90);
  });

  it('throws for a comparison with no application-layer implementation yet', async () => {
    const deps = buildDeps();

    await expect(
      buildHandlers(deps).recomputeAsset(new RecomputeAsset('p1', 1, Comparison.COSINE, 'a1', null)),
    ).rejects.toThrow(/has no application-layer implementation yet/);
  });
});

describe('AssetHandlers.recomputeProject', () => {
  it('deletes existing rows first, then walks assets in batches dispatching RecomputeAsset per asset', async () => {
    const deps = buildDeps({
      assets: {
        findByIdentity: vi.fn(),
        getByIdentity: vi.fn(),
        listRecipes: vi.fn(),
        countByProject: vi.fn(),
        listIdsWithHash: vi
          .fn()
          .mockResolvedValueOnce(['a1', 'a2'])
          .mockResolvedValueOnce(['a3'])
          .mockResolvedValueOnce([]),
        countPerRecipe: vi.fn(),
        getActivitySummary: vi.fn(),
      },
    });
    const deleteByProjectSpy = vi.spyOn(deps.assetHashDuplicateWriter, 'deleteByProject');
    const dispatchSpy = vi.spyOn(deps.commandGateway, 'dispatch');
    const onBatch = vi.fn();

    const total = await buildHandlers(deps).recomputeProject(
      new RecomputeProject('p1', 1, Comparison.HAMMING, null, 2, onBatch),
    );

    expect(deleteByProjectSpy).toHaveBeenCalledWith('p1', 1);
    expect(dispatchSpy).toHaveBeenCalledTimes(3);
    expect(dispatchSpy).toHaveBeenNthCalledWith(1, new RecomputeAsset('p1', 1, Comparison.HAMMING, 'a1', null));
    expect(dispatchSpy).toHaveBeenNthCalledWith(2, new RecomputeAsset('p1', 1, Comparison.HAMMING, 'a2', null));
    expect(dispatchSpy).toHaveBeenNthCalledWith(3, new RecomputeAsset('p1', 1, Comparison.HAMMING, 'a3', null));
    expect(total).toBe(3);
  });

  it('advances the cursor to the last id of each batch', async () => {
    const listIdsWithHash = vi.fn().mockResolvedValueOnce(['a1', 'a2']).mockResolvedValueOnce([]);
    const deps = buildDeps({
      assets: {
        findByIdentity: vi.fn(),
        getByIdentity: vi.fn(),
        listRecipes: vi.fn(),
        countByProject: vi.fn(),
        listIdsWithHash,
        countPerRecipe: vi.fn(),
        getActivitySummary: vi.fn(),
      },
    });

    await buildHandlers(deps).recomputeProject(new RecomputeProject('p1', 1, Comparison.HAMMING, null, 2));

    expect(listIdsWithHash).toHaveBeenNthCalledWith(1, 'p1', 1, null, 2);
    expect(listIdsWithHash).toHaveBeenNthCalledWith(2, 'p1', 1, 'a2', 2);
  });

  it('stops after a partial (less-than-batchSize) batch without an extra query', async () => {
    const listIdsWithHash = vi.fn().mockResolvedValueOnce(['a1']);
    const deps = buildDeps({
      assets: {
        findByIdentity: vi.fn(),
        getByIdentity: vi.fn(),
        listRecipes: vi.fn(),
        countByProject: vi.fn(),
        listIdsWithHash,
        countPerRecipe: vi.fn(),
        getActivitySummary: vi.fn(),
      },
    });

    await buildHandlers(deps).recomputeProject(new RecomputeProject('p1', 1, Comparison.HAMMING, null, 2));

    expect(listIdsWithHash).toHaveBeenCalledTimes(1);
  });

  it('invokes onBatch with the cumulative processed count after each batch', async () => {
    const listIdsWithHash = vi.fn().mockResolvedValueOnce(['a1', 'a2']).mockResolvedValueOnce(['a3']);
    const deps = buildDeps({
      assets: {
        findByIdentity: vi.fn(),
        getByIdentity: vi.fn(),
        listRecipes: vi.fn(),
        countByProject: vi.fn(),
        listIdsWithHash,
        countPerRecipe: vi.fn(),
        getActivitySummary: vi.fn(),
      },
    });
    const onBatch = vi.fn();

    await buildHandlers(deps).recomputeProject(new RecomputeProject('p1', 1, Comparison.HAMMING, null, 2, onBatch));

    expect(onBatch).toHaveBeenNthCalledWith(1, 2);
    expect(onBatch).toHaveBeenNthCalledWith(2, 3);
  });

  it('does not invoke onBatch again for the trailing empty batch after a full batch', async () => {
    const listIdsWithHash = vi.fn().mockResolvedValueOnce(['a1', 'a2']).mockResolvedValueOnce([]);
    const deps = buildDeps({
      assets: {
        findByIdentity: vi.fn(),
        getByIdentity: vi.fn(),
        listRecipes: vi.fn(),
        countByProject: vi.fn(),
        listIdsWithHash,
        countPerRecipe: vi.fn(),
        getActivitySummary: vi.fn(),
      },
    });
    const onBatch = vi.fn();

    const total = await buildHandlers(deps).recomputeProject(
      new RecomputeProject('p1', 1, Comparison.HAMMING, null, 2, onBatch),
    );

    expect(total).toBe(2);
    expect(onBatch).toHaveBeenCalledTimes(1);
    expect(onBatch).toHaveBeenCalledWith(2);
  });

  it('returns 0 and dispatches nothing further when there are no assets to process', async () => {
    const deps = buildDeps();
    const dispatchSpy = vi.spyOn(deps.commandGateway, 'dispatch');

    const total = await buildHandlers(deps).recomputeProject(
      new RecomputeProject('p1', 1, Comparison.HAMMING, null, 10),
    );

    expect(total).toBe(0);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('supports exact-comparison recipes too (dispatches RecomputeAsset with the exact comparison)', async () => {
    const deps = buildDeps({
      assets: {
        findByIdentity: vi.fn(),
        getByIdentity: vi.fn(),
        listRecipes: vi.fn(),
        countByProject: vi.fn(),
        listIdsWithHash: vi.fn().mockResolvedValueOnce(['a1']).mockResolvedValueOnce([]),
        countPerRecipe: vi.fn(),
        getActivitySummary: vi.fn(),
      },
    });
    const dispatchSpy = vi.spyOn(deps.commandGateway, 'dispatch');

    await buildHandlers(deps).recomputeProject(new RecomputeProject('p1', 1, Comparison.EXACT, null, 10));

    expect(dispatchSpy).toHaveBeenCalledWith(new RecomputeAsset('p1', 1, Comparison.EXACT, 'a1', null));
  });
});

describe('AssetHandlers.asHandlers', () => {
  it('exposes add, delete, recomputeAsset and recomputeProject bound to the correct command classes', () => {
    const handlers = buildHandlers(buildDeps());
    const [add, del, recomputeAsset, recomputeProject] = handlers.asHandlers();

    expect(add?.commandClass).toBe(AddAsset);
    expect(del?.commandClass).toBe(DeleteAsset);
    expect(recomputeAsset?.commandClass).toBe(RecomputeAsset);
    expect(recomputeProject?.commandClass).toBe(RecomputeProject);
  });
});
