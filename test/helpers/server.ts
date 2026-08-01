import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import type { DbClient } from '../../src/infrastructure/drizzle/client.js';
import type { Cradle } from '../../src/infrastructure/container.js';
import type { CoreHasher, CoreHashResult, CoreAlgorithm } from '../../src/domain/provider/hasher.provider.js';

// Repositories
import { DrizzleProjectRepository } from '../../src/infrastructure/drizzle/repository/project.repository.js';
import { DrizzleApiClientRepository } from '../../src/infrastructure/drizzle/repository/apiClient.repository.js';
import { DrizzleAlgorithmRepository } from '../../src/infrastructure/drizzle/repository/algorithm.repository.js';
import { DrizzleAssetRepository } from '../../src/infrastructure/drizzle/repository/asset.repository.js';
import { DrizzleAssetHashRepository } from '../../src/infrastructure/drizzle/repository/asset.hash.repository.js';
import { DrizzleAssetHashDuplicateRepository } from '../../src/infrastructure/drizzle/repository/asset.hashDuplicate.repository.js';
import { DrizzleAssetHashDuplicateSearchRepository } from '../../src/infrastructure/drizzle/repository/asset.hashDuplicate.search.repository.js';
import { DrizzleClusterRepository } from '../../src/infrastructure/drizzle/repository/cluster.repository.js';
import { DrizzleClusterSearchRepository } from '../../src/infrastructure/drizzle/repository/cluster.search.repository.js';

// Application services
import { AlgorithmService } from '../../src/application/service/algorithm.service.js';
import { ProjectStatsService } from '../../src/application/service/projectStats.service.js';
import { ScopeResolver } from '../../src/presentation/scopeResolver.js';
import { ProjectRateLimitCache } from '../../src/infrastructure/rateLimit/projectRateLimitCache.js';

// Command-side (CQRS)
import { CommandGateway } from '../../src/application/command.gateway.js';
import { ProjectHandlers } from '../../src/application/handler/project.handler.js';
import { ApiClientHandlers } from '../../src/application/handler/apiClient.handler.js';
import { AssetHandlers } from '../../src/application/handler/asset.handler.js';

import { buildHttpServer } from '../../src/presentation/http/server.js';
import type { Config } from '../../src/infrastructure/config/types.js';

const stubCoreClient: CoreHasher = {
  hash(): Promise<CoreHashResult[]> {
    throw new Error('[test] coreHasher.hash should not be called — pass opts.coreClient to buildTestServer');
  },
  listAlgorithms(): Promise<CoreAlgorithm[]> {
    throw new Error('[test] coreHasher.listAlgorithms should not be called — pass opts.coreClient to buildTestServer');
  },
};

const DEFAULT_CONFIG: Config = {
  core_base_url: 'http://core.test.invalid',
  core_timeout_ms: 5000,
  default_hamming_threshold: 90,
  default_rate_limit_per_minute: 300,
  database: { pool_size: 5 },
};

function buildRealCradle(db: DbClient, config: Config, coreHasher: CoreHasher): Cradle {
  const projectRepository = new DrizzleProjectRepository(db);
  const apiClientRepository = new DrizzleApiClientRepository(db);
  const algorithmRepository = new DrizzleAlgorithmRepository(db);
  const assetRepository = new DrizzleAssetRepository(db);
  const assetHashRepository = new DrizzleAssetHashRepository(db);
  const clusterRepository = new DrizzleClusterRepository(db);
  const clusterSearchRepository = new DrizzleClusterSearchRepository(db, clusterRepository);
  const assetHashDuplicateRepository = new DrizzleAssetHashDuplicateRepository(db, clusterRepository);
  const assetHashDuplicateSearchRepository = new DrizzleAssetHashDuplicateSearchRepository(
    db,
    assetHashDuplicateRepository,
  );

  const algorithmService = new AlgorithmService(algorithmRepository, algorithmRepository, coreHasher);
  const projectStatsService = new ProjectStatsService(
    projectRepository,
    algorithmRepository,
    assetRepository,
    assetHashRepository,
    assetHashDuplicateRepository,
    clusterRepository,
    config,
  );
  const scopeResolver = new ScopeResolver(projectRepository, algorithmRepository, config);
  const projectRateLimitCache = new ProjectRateLimitCache(projectRepository, config.default_rate_limit_per_minute);

  const commandGateway = new CommandGateway();
  const projectHandlers = new ProjectHandlers(projectRepository, projectRepository, projectRateLimitCache);
  const apiClientHandlers = new ApiClientHandlers(apiClientRepository, apiClientRepository);
  const assetHandlers = new AssetHandlers(
    coreHasher,
    algorithmService,
    projectRepository,
    assetRepository,
    assetRepository,
    assetHashRepository,
    assetHashRepository,
    assetHashDuplicateRepository,
    config,
    commandGateway,
  );

  commandGateway.registerAll([
    ...projectHandlers.asHandlers(),
    ...apiClientHandlers.asHandlers(),
    ...assetHandlers.asHandlers(),
  ]);

  return {
    env: {} as unknown as Cradle['env'],
    config,
    logger: pino({ level: 'silent' }),
    db,

    algorithmService,
    projectStatsService,
    scopeResolver,

    commandGateway,
    projectHandlers,
    apiClientHandlers,
    assetHandlers,

    coreHasher,
    projects: projectRepository,
    projectWriter: projectRepository,
    projectRateLimitCache,
    apiClients: apiClientRepository,
    apiClientWriter: apiClientRepository,
    algorithms: algorithmRepository,
    algorithmWriter: algorithmRepository,
    assets: assetRepository,
    assetWriter: assetRepository,
    assetHashes: assetHashRepository,
    assetHashWriter: assetHashRepository,
    assetHashDuplicates: assetHashDuplicateRepository,
    assetHashDuplicatesSearch: assetHashDuplicateSearchRepository,
    assetHashDuplicateWriter: assetHashDuplicateRepository,
    clusters: clusterRepository,
    clustersSearch: clusterSearchRepository,
  };
}

export interface BuildTestServerOptions {
  config?: Partial<Config>;
  coreClient?: CoreHasher;
}

export async function buildTestServer(db: DbClient, opts: BuildTestServerOptions = {}): Promise<FastifyInstance> {
  const config = { ...DEFAULT_CONFIG, ...opts.config };
  const server = await buildHttpServer(buildRealCradle(db, config, opts.coreClient ?? stubCoreClient));
  await server.ready();

  return server;
}
