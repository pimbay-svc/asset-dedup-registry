import { vi } from 'vitest';
import type { Cradle } from '../../src/infrastructure/container.js';

class FakeCommand {
  readonly _marker = true;
}

function buildFakeLogger(): Cradle['logger'] {
  const logger: Record<string, unknown> = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    level: 'silent',
  };

  logger.child = vi.fn().mockReturnValue(logger);

  return logger as unknown as Cradle['logger'];
}

export function buildFakeCradle(overrides: Partial<Cradle> = {}): Cradle {
  const base: Cradle = {
    env: {} as unknown as Cradle['env'],
    config: {
      core_base_url: 'http://core:3000',
      core_timeout_ms: 5000,
      default_hamming_threshold: 90,
      default_rate_limit_per_minute: 300,
      database: { pool_size: 5 },
    },
    logger: buildFakeLogger(),
    db: { execute: vi.fn().mockResolvedValue([]) } as unknown as Cradle['db'],

    algorithmService: { resolveAlgorithm: vi.fn() } as unknown as Cradle['algorithmService'],
    projectStatsService: {
      getOverview: vi.fn(),
      getSummary: vi.fn(),
    } as unknown as Cradle['projectStatsService'],
    scopeResolver: {
      resolveRecipeScope: vi.fn(),
      resolveDuplicateScope: vi.fn(),
    } as unknown as Cradle['scopeResolver'],

    commandGateway: {
      dispatch: vi.fn(),
      register: vi.fn(),
      registerAll: vi.fn(),
    } as unknown as Cradle['commandGateway'],
    projectHandlers: {
      create: vi.fn(),
      updateSettings: vi.fn(),
      delete: vi.fn(),
      asHandlers: vi.fn().mockReturnValue([{ commandClass: FakeCommand, execute: vi.fn() }]),
    } as unknown as Cradle['projectHandlers'],
    apiClientHandlers: {
      create: vi.fn(),
      revoke: vi.fn(),
      asHandlers: vi.fn().mockReturnValue([{ commandClass: FakeCommand, execute: vi.fn() }]),
    } as unknown as Cradle['apiClientHandlers'],
    assetHandlers: {
      add: vi.fn(),
      delete: vi.fn(),
      recomputeAsset: vi.fn(),
      recomputeProject: vi.fn(),
      asHandlers: vi.fn().mockReturnValue([{ commandClass: FakeCommand, execute: vi.fn() }]),
    } as unknown as Cradle['assetHandlers'],

    coreHasher: { hash: vi.fn(), listAlgorithms: vi.fn() },
    projects: {
      findById: vi.fn(),
      findBySlug: vi.fn(),
      getBySlug: vi.fn(),
      list: vi.fn(),
    },
    projectWriter: { create: vi.fn(), updateSettings: vi.fn(), deleteById: vi.fn() },
    projectRateLimitCache: {
      resolve: vi.fn().mockResolvedValue(300),
      invalidate: vi.fn(),
    } as unknown as Cradle['projectRateLimitCache'],
    apiClients: {
      findByKeyHash: vi.fn().mockResolvedValue(null),
      listByProject: vi.fn(),
      findByProjectAndName: vi.fn().mockResolvedValue(null),
    },
    apiClientWriter: { create: vi.fn(), revoke: vi.fn() },
    algorithms: { findByRecipe: vi.fn() },
    algorithmWriter: { add: vi.fn() },
    assets: {
      findByIdentity: vi.fn(),
      getByIdentity: vi.fn(),
      listRecipes: vi.fn(),
      countByProject: vi.fn(),
      listIdsWithHash: vi.fn(),
      countPerRecipe: vi.fn(),
      getActivitySummary: vi.fn(),
    },
    assetWriter: { create: vi.fn(), deleteByIdentity: vi.fn() },
    assetHashes: { findOne: vi.fn(), findByAssetId: vi.fn(), countExactDuplicateStats: vi.fn() },
    assetHashWriter: { replaceAll: vi.fn() },
    assetHashDuplicates: {
      findByProject: vi.fn(),
      findByAssets: vi.fn(),
      countPairsByProject: vi.fn(),
    },
    assetHashDuplicatesSearch: { paginateRanking: vi.fn(), paginateMatches: vi.fn() },
    assetHashDuplicateWriter: {
      recomputeExact: vi.fn(),
      recomputeHamming: vi.fn(),
      deleteByAsset: vi.fn(),
      deleteByProject: vi.fn(),
    },
    clusters: {
      computeStats: vi.fn(),
      countEdges: vi.fn(),
      ensureFresh: vi.fn(),
    },
    clustersSearch: { paginate: vi.fn() },
  };

  return { ...base, ...overrides };
}
