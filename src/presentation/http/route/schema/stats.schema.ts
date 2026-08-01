/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
export const statsResponseSchema = {
  type: 'object',
  properties: {
    project: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        name: { type: 'string' },
      },
    },
    total_assets: { type: 'number' },
    assets_per_recipe: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          recipe: { type: 'string' },
          asset_count: { type: 'number' },
        },
      },
    },
    duplicates_per_recipe: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          recipe: { type: 'string' },
          cluster_count: { type: ['number', 'null'] },
          edge_count: { type: ['number', 'null'] },
          assets_with_duplicate_count: { type: ['number', 'null'] },
          assets_with_duplicate_pct: { type: ['number', 'null'] },
          degraded: { type: 'boolean' },
        },
      },
    },
    last_asset_added_at: { type: ['string', 'null'] },
    assets_added_last_7d: { type: 'number' },
    assets_added_last_30d: { type: 'number' },
  },
} as const;
