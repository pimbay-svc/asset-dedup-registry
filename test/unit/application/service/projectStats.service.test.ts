import { describe, it, expect, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { ProjectStatsService } from '../../../../src/application/service/projectStats.service.js';
import { Comparison } from '../../../../src/domain/model/algorithm.model.js';
import { NotFoundError } from '../../../../src/domain/errors.js';
import type { Projects } from '../../../../src/domain/repo/project.repo.js';
import type { Algorithms } from '../../../../src/domain/repo/algorithm.repo.js';
import type { Assets, AssetHashes, AssetHashDuplicates } from '../../../../src/domain/repo/asset.repo.js';
import type { Clusters } from '../../../../src/domain/repo/cluster.repo.js';
import type { Config } from '../../../../src/infrastructure/config/types.js';
import type { Project, Algorithm } from '../../../../src/domain/model/model.js';

const CONFIG: Config = {
  core_base_url: 'http://core:3000',
  core_timeout_ms: 5000,
  default_hamming_threshold: 90,
  default_rate_limit_per_minute: 300,
  database: { pool_size: 5 },
};

function buildProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    slug: 'demo',
    name: 'Demo',
    recipes: ['binary.sha256', 'image.phash16'],
    hammingThreshold: null,
    rateLimitPerMinute: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildHarness(options: {
  project?: Project | null;
  algorithms?: Record<string, Algorithm | null>;
  countPerRecipe?: { recipe: string; assetCount: number }[];
  countByProject?: number;
  activitySummary?: { lastAddedAt: Date | null; addedLast7d: number; addedLast30d: number };
  countExactDuplicateStats?: { clusterCount: number; edgeCount: number; assetsWithDuplicateCount: number };
  computeStats?: { clusterCount: number; edgeCount: number; assetsWithDuplicateCount: number } | null;
  countPairsByProject?: number;
}): {
  service: ProjectStatsService;
  projects: Projects;
  algorithms: Algorithms;
  assets: Assets;
  assetHashes: AssetHashes;
  assetHashDuplicates: AssetHashDuplicates;
  clusters: Clusters;
  computeStatsSpy: MockInstance;
} {
  const projects: Projects = {
    findById: vi.fn().mockResolvedValue(options.project === undefined ? buildProject() : options.project),
    findBySlug: vi.fn(),
    getBySlug: vi.fn(),
    list: vi.fn(),
  };

  const algorithms: Algorithms = {
    findByRecipe: vi.fn((recipe: string) => Promise.resolve(options.algorithms?.[recipe] ?? null)),
  };

  const assets: Assets = {
    findByIdentity: vi.fn(),
    getByIdentity: vi.fn(),
    listRecipes: vi.fn(),
    countByProject: vi.fn().mockResolvedValue(options.countByProject ?? 0),
    listIdsWithHash: vi.fn(),
    countPerRecipe: vi.fn().mockResolvedValue(options.countPerRecipe ?? []),
    getActivitySummary: vi
      .fn()
      .mockResolvedValue(options.activitySummary ?? { lastAddedAt: null, addedLast7d: 0, addedLast30d: 0 }),
  };

  const assetHashes: AssetHashes = {
    findOne: vi.fn(),
    findByAssetId: vi.fn(),
    countExactDuplicateStats: vi
      .fn()
      .mockResolvedValue(
        options.countExactDuplicateStats ?? { clusterCount: 0, edgeCount: 0, assetsWithDuplicateCount: 0 },
      ),
  };

  const assetHashDuplicates: AssetHashDuplicates = {
    findByProject: vi.fn(),
    findByAssets: vi.fn(),
    countPairsByProject: vi.fn().mockResolvedValue(options.countPairsByProject ?? 0),
  };

  const clusters = {
    computeStats: vi.fn().mockResolvedValue(options.computeStats ?? null),
    countEdges: vi.fn(),
    ensureFresh: vi.fn(),
  } as unknown as Clusters;
  const computeStatsSpy = vi.spyOn(clusters, 'computeStats');

  const service = new ProjectStatsService(
    projects,
    algorithms,
    assets,
    assetHashes,
    assetHashDuplicates,
    clusters,
    CONFIG,
  );

  return {
    service,
    projects,
    algorithms,
    assets,
    assetHashes,
    assetHashDuplicates,
    clusters,
    computeStatsSpy,
  };
}

describe('ProjectStatsService.getOverview', () => {
  it('returns project-wide asset and duplicate-pair totals', async () => {
    const { service } = buildHarness({ countByProject: 12, countPairsByProject: 3 });
    const project = buildProject();

    const result = await service.getOverview(project);

    expect(result).toEqual({ slug: project.slug, name: project.name, assets: 12, duplicatePairs: 3 });
  });
});

describe('ProjectStatsService.getSummary', () => {
  it('throws NotFoundError when the project does not exist', async () => {
    const { service } = buildHarness({ project: null });

    await expect(service.getSummary('missing')).rejects.toThrow(NotFoundError);
  });

  it('zero-fills a configured recipe that has never been hashed', async () => {
    const { service } = buildHarness({
      countPerRecipe: [{ recipe: 'binary.sha256', assetCount: 5 }],
      algorithms: {}, // no algorithm resolved for either recipe
    });

    const summary = await service.getSummary('project-1');

    expect(summary.assetsPerRecipe).toEqual([
      { recipe: 'binary.sha256', assetCount: 5 },
      { recipe: 'image.phash16', assetCount: 0 },
    ]);
    expect(summary.duplicatesPerRecipe).toEqual([
      {
        recipe: 'binary.sha256',
        clusterCount: 0,
        edgeCount: 0,
        assetsWithDuplicateCount: 0,
        assetsWithDuplicatePct: 0,
        degraded: false,
      },
      {
        recipe: 'image.phash16',
        clusterCount: 0,
        edgeCount: 0,
        assetsWithDuplicateCount: 0,
        assetsWithDuplicatePct: 0,
        degraded: false,
      },
    ]);
  });

  it('computes EXACT-recipe duplicate stats from asset_hash-derived counts', async () => {
    const { service } = buildHarness({
      countPerRecipe: [{ recipe: 'binary.sha256', assetCount: 100 }],
      algorithms: { 'binary.sha256': { id: 1, recipe: 'binary.sha256', comparison: Comparison.EXACT } },
      countExactDuplicateStats: { clusterCount: 3, edgeCount: 10, assetsWithDuplicateCount: 12 },
    });

    const summary = await service.getSummary('project-1');
    const stat = summary.duplicatesPerRecipe.find((row) => row.recipe === 'binary.sha256');

    expect(stat).toEqual({
      recipe: 'binary.sha256',
      clusterCount: 3,
      edgeCount: 10,
      assetsWithDuplicateCount: 12,
      assetsWithDuplicatePct: 12,
      degraded: false,
    });
  });

  it('reports a 0% pct (not NaN/divide-by-zero) when the recipe has an algorithm but zero counted assets', async () => {
    const { service } = buildHarness({
      countPerRecipe: [{ recipe: 'binary.sha256', assetCount: 0 }],
      algorithms: { 'binary.sha256': { id: 1, recipe: 'binary.sha256', comparison: Comparison.EXACT } },
      countExactDuplicateStats: { clusterCount: 0, edgeCount: 0, assetsWithDuplicateCount: 0 },
    });

    const summary = await service.getSummary('project-1');
    const stat = summary.duplicatesPerRecipe.find((row) => row.recipe === 'binary.sha256');

    expect(stat?.assetsWithDuplicatePct).toBe(0);
  });

  it('computes HAMMING-recipe duplicate stats via the cluster cache, using project.hammingThreshold as fallback', async () => {
    const { service, computeStatsSpy } = buildHarness({
      countPerRecipe: [{ recipe: 'image.phash16', assetCount: 200 }],
      algorithms: { 'image.phash16': { id: 2, recipe: 'image.phash16', comparison: Comparison.HAMMING } },
      computeStats: { clusterCount: 4, edgeCount: 20, assetsWithDuplicateCount: 40 },
    });

    const summary = await service.getSummary('project-1');
    const stat = summary.duplicatesPerRecipe.find((row) => row.recipe === 'image.phash16');

    expect(stat).toEqual({
      recipe: 'image.phash16',
      clusterCount: 4,
      edgeCount: 20,
      assetsWithDuplicateCount: 40,
      assetsWithDuplicatePct: 20,
      degraded: false,
    });
    // config.default_hamming_threshold fallback, project.hammingThreshold is null
    expect(computeStatsSpy).toHaveBeenCalledWith('project-1', 2, 90);
  });

  it('marks a HAMMING recipe degraded once the edge graph exceeds the safety cap', async () => {
    const { service } = buildHarness({
      countPerRecipe: [{ recipe: 'image.phash16', assetCount: 200 }],
      algorithms: { 'image.phash16': { id: 2, recipe: 'image.phash16', comparison: Comparison.HAMMING } },
      computeStats: null,
    });

    const summary = await service.getSummary('project-1');
    const stat = summary.duplicatesPerRecipe.find((row) => row.recipe === 'image.phash16');

    expect(stat).toEqual({
      recipe: 'image.phash16',
      clusterCount: null,
      edgeCount: null,
      assetsWithDuplicateCount: null,
      assetsWithDuplicatePct: null,
      degraded: true,
    });
  });

  it('degrades gracefully for a comparison with no application-layer implementation', async () => {
    const { service, computeStatsSpy } = buildHarness({
      project: buildProject({ recipes: ['vector.clip'] }),
      countPerRecipe: [{ recipe: 'vector.clip', assetCount: 10 }],
      algorithms: { 'vector.clip': { id: 3, recipe: 'vector.clip', comparison: Comparison.COSINE } },
      // Deliberately non-degraded/non-null: if COSINE were ever mis-routed into the HAMMING branch, this
      // would surface as a real (wrong) stat instead of the correct hardcoded degraded fallback.
      computeStats: { clusterCount: 99, edgeCount: 99, assetsWithDuplicateCount: 99 },
    });

    const summary = await service.getSummary('project-1');
    const stat = summary.duplicatesPerRecipe.find((row) => row.recipe === 'vector.clip');

    expect(stat?.degraded).toBe(true);
    expect(stat?.clusterCount).toBeNull();
    expect(computeStatsSpy).not.toHaveBeenCalled();
  });

  it('reports total assets and activity summary alongside per-recipe breakdowns', async () => {
    const lastAddedAt = new Date('2026-08-05T14:32:00Z');
    const { service } = buildHarness({
      countByProject: 1204,
      activitySummary: { lastAddedAt, addedLast7d: 41, addedLast30d: 213 },
    });

    const summary = await service.getSummary('project-1');

    expect(summary.totalAssets).toBe(1204);
    expect(summary.lastAssetAddedAt).toBe(lastAddedAt);
    expect(summary.assetsAddedLast7d).toBe(41);
    expect(summary.assetsAddedLast30d).toBe(213);
    expect(summary.project).toEqual({ slug: 'demo', name: 'Demo' });
  });

  it('uses project.hammingThreshold over the config default when set', async () => {
    const { service, computeStatsSpy } = buildHarness({
      project: buildProject({ hammingThreshold: 75, recipes: ['image.phash16'] }),
      algorithms: { 'image.phash16': { id: 2, recipe: 'image.phash16', comparison: Comparison.HAMMING } },
      computeStats: { clusterCount: 0, edgeCount: 0, assetsWithDuplicateCount: 0 },
    });

    await service.getSummary('project-1');

    expect(computeStatsSpy).toHaveBeenCalledWith('project-1', 2, 75);
  });
});
