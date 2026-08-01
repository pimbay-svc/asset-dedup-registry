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
import { requireScope } from '../auth.js';
import { sendErrorResponse } from '../errorResponse.js';
import type { ProjectStatsSummary } from '../../../application/service/projectStats.service.js';
import { statsResponseSchema } from './schema/stats.schema.js';

export function registerStatsRoutes(app: FastifyInstance, cradle: Cradle): void {
  app.get(
    '/stats',
    {
      preHandler: requireScope(cradle.apiClients, ApiScope.ASSETS_READ),
      schema: {
        response: { 200: statsResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const summary = await cradle.projectStatsService.getSummary(request.projectId);

        return await reply.status(200).send(mapSummary(summary));
      } catch (err) {
        return await sendErrorResponse(request, reply, err);
      }
    },
  );
}

function mapSummary(summary: ProjectStatsSummary): {
  project: { slug: string; name: string };
  total_assets: number;
  assets_per_recipe: { recipe: string; asset_count: number }[];
  duplicates_per_recipe: {
    recipe: string;
    cluster_count: number | null;
    edge_count: number | null;
    assets_with_duplicate_count: number | null;
    assets_with_duplicate_pct: number | null;
    degraded: boolean;
  }[];
  last_asset_added_at: string | null;
  assets_added_last_7d: number;
  assets_added_last_30d: number;
} {
  return {
    project: { slug: summary.project.slug, name: summary.project.name },
    total_assets: summary.totalAssets,
    assets_per_recipe: summary.assetsPerRecipe.map((row) => ({ recipe: row.recipe, asset_count: row.assetCount })),
    duplicates_per_recipe: summary.duplicatesPerRecipe.map((row) => ({
      recipe: row.recipe,
      cluster_count: row.clusterCount,
      edge_count: row.edgeCount,
      assets_with_duplicate_count: row.assetsWithDuplicateCount,
      assets_with_duplicate_pct: row.assetsWithDuplicatePct,
      degraded: row.degraded,
    })),
    last_asset_added_at: summary.lastAssetAddedAt?.toISOString() ?? null,
    assets_added_last_7d: summary.assetsAddedLast7d,
    assets_added_last_30d: summary.assetsAddedLast30d,
  };
}
