/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { FastifyInstance } from 'fastify';
import type { Cradle } from '../../../infrastructure/container.js';
import { ApiScope } from '../../../domain/model/apiClient.model.js';
import { Identity } from '../../../domain/model/asset.model.js';
import { requireScope } from '../auth.js';
import { sendErrorResponse } from '../errorResponse.js';
import type { DuplicateMatch, AssetWithDuplicateCount } from '../../../application/query/asset.query.js';
import type { DuplicateCluster } from '../../../application/query/cluster.query.js';
import { mapPageToJson, mapIdentity, type IdentityDto } from '../mapping.js';
import { parsePage, parseOptionalLimit } from '../../parse.js';
import {
  matchesQuerySchema,
  clustersQuerySchema,
  rankingQuerySchema,
  matchesResponseSchema,
  clustersResponseSchema,
  rankingResponseSchema,
} from './schema/duplicate.schema.js';

interface PageQuery {
  page?: string;
  page_size?: string;
}

interface MatchesQuery extends PageQuery {
  id?: string;
  path?: string;
  recipe: string;
  threshold?: string;
}

interface ClustersQuery extends PageQuery {
  recipe: string;
  threshold?: string;
  generation?: string;
  id?: string;
  path?: string;
}

interface RankingQuery extends PageQuery {
  recipe: string;
  threshold?: string;
  match_limit?: string;
  id?: string;
  path?: string;
}

/** `parsePage` takes camelCase `pageSize`; HTTP query strings are snake_case `page_size` — bridges the two. */
function parseRoutePage(query: PageQuery): { page: number; size: number } {
  return parsePage({
    ...(query.page !== undefined && { page: query.page }),
    ...(query.page_size !== undefined && { pageSize: query.page_size }),
  });
}

export function registerDuplicatesRoutes(app: FastifyInstance, cradle: Cradle): void {
  /** Matches for a single asset — "which assets look like this one". */
  app.get<{ Querystring: MatchesQuery }>(
    '/duplicates/matches',
    {
      preHandler: requireScope(cradle.apiClients, ApiScope.ASSETS_READ),
      schema: {
        querystring: matchesQuerySchema,
        response: { 200: matchesResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const identity = new Identity(request.query.id ?? null, request.query.path ?? null);
        const { recipe } = request.query;
        const { algorithm, minSimilarity } = await cradle.scopeResolver.resolveDuplicateScope(
          request.projectId,
          recipe,
          request.query.threshold,
        );
        await cradle.assets.getByIdentity(request.projectId, identity);

        const routePage = parseRoutePage(request.query);
        const result = await cradle.assetHashDuplicatesSearch.paginateMatches(
          { projectId: request.projectId, algorithmId: algorithm.id, identity, minSimilarity },
          routePage.page,
          routePage.size,
        );

        return await reply.status(200).send(mapPageToJson(result, mapMatch));
      } catch (err) {
        return sendErrorResponse(request, reply, err);
      }
    },
  );

  /** Connected clusters of mutually-duplicate assets — transitive closure over the edge graph, computed
   * fresh for the requested `threshold` (or the project/config default) and cached until the next write
   * invalidates it. `threshold` can freely override the write-time default, since this is never served
   * from a table baked to a single threshold. */
  app.get<{ Querystring: ClustersQuery }>(
    '/duplicates/clusters',
    {
      preHandler: requireScope(cradle.apiClients, ApiScope.ASSETS_READ),
      schema: {
        querystring: clustersQuerySchema,
        response: { 200: clustersResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { algorithm, minSimilarity } = await cradle.scopeResolver.resolveDuplicateScope(
          request.projectId,
          request.query.recipe,
          request.query.threshold,
        );

        const routePage = parseRoutePage(request.query);
        const generation = parseOptionalLimit(request.query.generation, 'generation');
        const result = await cradle.clustersSearch.paginate(
          {
            projectId: request.projectId,
            algorithmId: algorithm.id,
            minSimilarity,
            ...(generation !== undefined && { generation }),
            ...(request.query.id !== undefined && { id: request.query.id }),
            ...(request.query.path !== undefined && { path: request.query.path }),
          },
          routePage.page,
          routePage.size,
        );

        return await reply
          .status(200)
          .send({ ...mapPageToJson(result.page, mapCluster), generation: result.generation });
      } catch (err) {
        return await sendErrorResponse(request, reply, err);
      }
    },
  );

  /** All assets in scope with at least one duplicate, ranked by duplicate count descending. */
  app.get<{ Querystring: RankingQuery }>(
    '/duplicates/ranking',
    {
      preHandler: requireScope(cradle.apiClients, ApiScope.ASSETS_READ),
      schema: {
        querystring: rankingQuerySchema,
        response: { 200: rankingResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { algorithm, minSimilarity } = await cradle.scopeResolver.resolveDuplicateScope(
          request.projectId,
          request.query.recipe,
          request.query.threshold,
        );
        const matchLimit = parseOptionalLimit(request.query.match_limit);

        const routePage = parseRoutePage(request.query);
        const result = await cradle.assetHashDuplicatesSearch.paginateRanking(
          {
            projectId: request.projectId,
            algorithmId: algorithm.id,
            minSimilarity,
            ...(matchLimit !== undefined && { matchLimit }),
            ...(request.query.id !== undefined && { id: request.query.id }),
            ...(request.query.path !== undefined && { path: request.query.path }),
          },
          routePage.page,
          routePage.size,
        );

        return await reply.status(200).send(mapPageToJson(result, mapRankedAsset));
      } catch (err) {
        return await sendErrorResponse(request, reply, err);
      }
    },
  );
}

function mapMatch(match: DuplicateMatch): { identity: IdentityDto; distance: number; similarity: number } {
  return { identity: mapIdentity(match.identity), distance: match.distance, similarity: match.similarity };
}

function mapCluster(cluster: DuplicateCluster): {
  cluster_id: string;
  max_similarity: number;
  assets: { identity: IdentityDto; avg_similarity_to_cluster: number }[];
} {
  return {
    cluster_id: cluster.clusterId,
    max_similarity: cluster.maxSimilarity,
    assets: cluster.assets.map((asset) => ({
      identity: mapIdentity(asset.identity),
      avg_similarity_to_cluster: asset.avgSimilarityToCluster,
    })),
  };
}

function mapRankedAsset(asset: AssetWithDuplicateCount): {
  identity: IdentityDto;
  duplicate_count: number;
  matches: { identity: IdentityDto; distance: number; similarity: number }[];
} {
  return {
    identity: mapIdentity(asset.identity),
    duplicate_count: asset.duplicateCount,
    matches: asset.matches.map(mapMatch),
  };
}
