/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { Projects } from '../../domain/repo/project.repo.js';
import type { Algorithms } from '../../domain/repo/algorithm.repo.js';
import type { Assets, AssetHashes, AssetHashDuplicates } from '../../domain/repo/asset.repo.js';
import type { Clusters } from '../../domain/repo/cluster.repo.js';
import type { Project } from '../../domain/model/model.js';
import { Comparison } from '../../domain/model/algorithm.model.js';
import type { Config } from '../../infrastructure/config/types.js';
import { NotFoundError } from '../../domain/errors.js';

/** One row per project — the `stats projects` CLI's cross-project totals. */
export interface ProjectOverview {
  slug: string;
  name: string;
  assets: number;
  duplicatePairs: number;
}

export interface AssetsPerRecipeStat {
  recipe: string;
  assetCount: number;
}

export interface DuplicatesPerRecipeStat {
  recipe: string;
  clusterCount: number | null;
  edgeCount: number | null;
  assetsWithDuplicateCount: number | null;
  assetsWithDuplicatePct: number | null;
  degraded: boolean;
}

/** Backs `GET /stats` — see registry-stats-endpoint-spec.md. */
export interface ProjectStatsSummary {
  project: Pick<Project, 'slug' | 'name'>;
  totalAssets: number;
  assetsPerRecipe: AssetsPerRecipeStat[];
  duplicatesPerRecipe: DuplicatesPerRecipeStat[];
  lastAssetAddedAt: Date | null;
  assetsAddedLast7d: number;
  assetsAddedLast30d: number;
}

const DEGRADED_STAT: Omit<DuplicatesPerRecipeStat, 'recipe'> = {
  clusterCount: null,
  edgeCount: null,
  assetsWithDuplicateCount: null,
  assetsWithDuplicatePct: null,
  degraded: true,
};

/** Shared by `stats projects` (CLI) and `GET /stats` (HTTP) — one counting service, per spec. */
export class ProjectStatsService {
  constructor(
    private readonly projects: Projects,
    private readonly algorithms: Algorithms,
    private readonly assets: Assets,
    private readonly assetHashes: AssetHashes,
    private readonly assetHashDuplicates: AssetHashDuplicates,
    private readonly clusters: Clusters,
    private readonly config: Config,
  ) {}

  /** Project-wide totals — the row `stats projects` prints per project. */
  async getOverview(project: Project): Promise<ProjectOverview> {
    const [assetCount, duplicatePairs] = await Promise.all([
      this.assets.countByProject(project.id),
      this.assetHashDuplicates.countPairsByProject(project.id),
    ]);

    return { slug: project.slug, name: project.name, assets: assetCount, duplicatePairs };
  }

  /** Scoped, per-recipe breakdown for `GET /stats`. */
  async getSummary(projectId: string): Promise<ProjectStatsSummary> {
    const project = await this.projects.findById(projectId);

    if (!project) {
      throw NotFoundError.project(projectId);
    }

    const [totalAssets, countsByRecipe, activity] = await Promise.all([
      this.assets.countByProject(project.id),
      this.assets.countPerRecipe(project.id),
      this.assets.getActivitySummary(project.id),
    ]);

    const assetCountByRecipe = new Map(countsByRecipe.map((row) => [row.recipe, row.assetCount]));
    const assetsPerRecipe = project.recipes.map((recipe) => ({
      recipe,
      assetCount: assetCountByRecipe.get(recipe) ?? 0,
    }));

    const duplicatesPerRecipe = await Promise.all(
      assetsPerRecipe.map(({ recipe, assetCount }) => this.getDuplicateStatsForRecipe(project, recipe, assetCount)),
    );

    return {
      project: { slug: project.slug, name: project.name },
      totalAssets,
      assetsPerRecipe,
      duplicatesPerRecipe,
      lastAssetAddedAt: activity.lastAddedAt,
      assetsAddedLast7d: activity.addedLast7d,
      assetsAddedLast30d: activity.addedLast30d,
    };
  }

  private async getDuplicateStatsForRecipe(
    project: Project,
    recipe: string,
    assetCount: number,
  ): Promise<DuplicatesPerRecipeStat> {
    const algorithm = await this.algorithms.findByRecipe(recipe);

    // Configured but never hashed — nothing to report, not a failure.
    if (!algorithm) {
      return {
        recipe,
        clusterCount: 0,
        edgeCount: 0,
        assetsWithDuplicateCount: 0,
        assetsWithDuplicatePct: 0,
        degraded: false,
      };
    }

    if (algorithm.comparison === Comparison.EXACT) {
      const stats = await this.assetHashes.countExactDuplicateStats(project.id, algorithm.id);

      return this.buildStat(recipe, stats, assetCount);
    }

    if (algorithm.comparison === Comparison.HAMMING) {
      const minSimilarity = project.hammingThreshold ?? this.config.default_hamming_threshold;
      const stats = await this.clusters.computeStats(project.id, algorithm.id, minSimilarity);

      if (stats === null) {
        return { recipe, ...DEGRADED_STAT };
      }

      return this.buildStat(recipe, stats, assetCount);
    }

    // No implementation for this comparison (e.g. cosine) — degrade rather than fail the whole response.
    return { recipe, ...DEGRADED_STAT };
  }

  private buildStat(
    recipe: string,
    stats: { clusterCount: number; edgeCount: number; assetsWithDuplicateCount: number },
    assetCount: number,
  ): DuplicatesPerRecipeStat {
    const assetsWithDuplicatePct =
      assetCount > 0 ? Math.round((stats.assetsWithDuplicateCount / assetCount) * 10000) / 100 : 0;

    return {
      recipe,
      clusterCount: stats.clusterCount,
      edgeCount: stats.edgeCount,
      assetsWithDuplicateCount: stats.assetsWithDuplicateCount,
      assetsWithDuplicatePct,
      degraded: false,
    };
  }
}
