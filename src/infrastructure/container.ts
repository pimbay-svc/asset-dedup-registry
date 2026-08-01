/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { createContainer, asClass, asValue, InjectionMode } from 'awilix';
import type { AwilixContainer } from 'awilix';
import pino from 'pino';

import { createDbClient, closeDbClient, type DbClient } from './drizzle/client.js';
import { resolveDatabaseConfig } from './config/config.js';
import { CoreClient } from './core/coreClient.js';
import { createLoggerOptions } from './logger.js';
import type { Env } from './env/env.js';

import { DrizzleProjectRepository } from './drizzle/repository/project.repository.js';
import type { Projects } from '../domain/repo/project.repo.js';
import type { ProjectWriter } from '../application/writer/project.writer.js';
import { DrizzleApiClientRepository } from './drizzle/repository/apiClient.repository.js';
import type { ApiClients } from '../domain/repo/apiClient.repo.js';
import type { ApiClientWriter } from '../application/writer/apiClient.writer.js';
import { DrizzleAlgorithmRepository } from './drizzle/repository/algorithm.repository.js';
import type { Algorithms } from '../domain/repo/algorithm.repo.js';
import type { AlgorithmWriter } from '../application/writer/algorithm.writer.js';
import { DrizzleAssetRepository } from './drizzle/repository/asset.repository.js';
import type { Assets } from '../domain/repo/asset.repo.js';
import type { AssetWriter } from '../application/writer/asset.writer.js';
import { DrizzleAssetHashRepository } from './drizzle/repository/asset.hash.repository.js';
import type { AssetHashes } from '../domain/repo/asset.repo.js';
import type { AssetHashWriter, AssetHashDuplicateWriter } from '../application/writer/asset.writer.js';
import { DrizzleAssetHashDuplicateRepository } from './drizzle/repository/asset.hashDuplicate.repository.js';
import { DrizzleAssetHashDuplicateSearchRepository } from './drizzle/repository/asset.hashDuplicate.search.repository.js';
import { DrizzleClusterRepository } from './drizzle/repository/cluster.repository.js';
import { DrizzleClusterSearchRepository } from './drizzle/repository/cluster.search.repository.js';
import type { AssetHashDuplicates } from '../domain/repo/asset.repo.js';
import type { AssetHashDuplicatesSearch } from '../application/query/asset.query.js';
import type { Clusters } from '../domain/repo/cluster.repo.js';
import type { ClustersSearch } from '../application/query/cluster.query.js';
import type { CoreHasher } from '../domain/provider/hasher.provider.js';

import { AlgorithmService } from '../application/service/algorithm.service.js';
import { ProjectStatsService } from '../application/service/projectStats.service.js';
import { ScopeResolver } from '../presentation/scopeResolver.js';
import { ProjectRateLimitCache } from './rateLimit/projectRateLimitCache.js';

import { CommandGateway } from '../application/command.gateway.js';
import { ProjectHandlers } from '../application/handler/project.handler.js';
import { ApiClientHandlers } from '../application/handler/apiClient.handler.js';
import { AssetHandlers } from '../application/handler/asset.handler.js';

import type { Config } from './config/types.js';

export interface Cradle {
  env: Env;
  config: Config;
  logger: pino.Logger;
  db: DbClient;

  algorithmService: AlgorithmService;
  projectStatsService: ProjectStatsService;
  scopeResolver: ScopeResolver;

  commandGateway: CommandGateway;
  projectHandlers: ProjectHandlers;
  apiClientHandlers: ApiClientHandlers;
  assetHandlers: AssetHandlers;

  coreHasher: CoreHasher;
  projects: Projects;
  projectWriter: ProjectWriter;
  projectRateLimitCache: ProjectRateLimitCache;
  apiClients: ApiClients;
  apiClientWriter: ApiClientWriter;
  algorithms: Algorithms;
  algorithmWriter: AlgorithmWriter;
  assets: Assets;
  assetWriter: AssetWriter;
  assetHashes: AssetHashes;
  assetHashWriter: AssetHashWriter;
  assetHashDuplicates: AssetHashDuplicates;
  assetHashDuplicatesSearch: AssetHashDuplicatesSearch;
  assetHashDuplicateWriter: AssetHashDuplicateWriter;
  clusters: Clusters;
  clustersSearch: ClustersSearch;
}

export interface BuiltContainer {
  container: AwilixContainer<Cradle>;
  cleanup: () => Promise<void>;
}

export function buildContainer(env: Env, config: Config): BuiltContainer {
  const container = createContainer<Cradle>({ injectionMode: InjectionMode.CLASSIC });
  const logger = pino(createLoggerOptions(env));

  const dbConfig = resolveDatabaseConfig(config);
  const db = createDbClient(dbConfig, logger);

  const coreClient = new CoreClient(config.core_base_url, config.core_timeout_ms);

  const projectRepository = new DrizzleProjectRepository(db);
  const projectRateLimitCache = new ProjectRateLimitCache(projectRepository, config.default_rate_limit_per_minute);
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

  container.register({
    env: asValue(env),
    config: asValue(config),
    logger: asValue(logger),
    db: asValue(db),

    algorithmService: asClass(AlgorithmService).singleton(),
    projectStatsService: asClass(ProjectStatsService).singleton(),
    scopeResolver: asClass(ScopeResolver).singleton(),

    commandGateway: asClass(CommandGateway).singleton(),
    projectHandlers: asClass(ProjectHandlers).singleton(),
    apiClientHandlers: asClass(ApiClientHandlers).singleton(),
    assetHandlers: asClass(AssetHandlers).singleton(),

    coreHasher: asValue(coreClient),
    projects: asValue(projectRepository),
    projectWriter: asValue(projectRepository),
    projectRateLimitCache: asValue(projectRateLimitCache),
    apiClients: asValue(apiClientRepository),
    apiClientWriter: asValue(apiClientRepository),
    algorithms: asValue(algorithmRepository),
    algorithmWriter: asValue(algorithmRepository),
    assets: asValue(assetRepository),
    assetWriter: asValue(assetRepository),
    assetHashes: asValue(assetHashRepository),
    assetHashWriter: asValue(assetHashRepository),
    assetHashDuplicates: asValue(assetHashDuplicateRepository),
    assetHashDuplicatesSearch: asValue(assetHashDuplicateSearchRepository),
    assetHashDuplicateWriter: asValue(assetHashDuplicateRepository),
    clusters: asValue(clusterRepository),
    clustersSearch: asValue(clusterSearchRepository),
  });

  container.cradle.commandGateway.registerAll([
    ...container.cradle.projectHandlers.asHandlers(),
    ...container.cradle.apiClientHandlers.asHandlers(),
    ...container.cradle.assetHandlers.asHandlers(),
  ]);

  return { container, cleanup: () => closeDbClient(db) };
}
