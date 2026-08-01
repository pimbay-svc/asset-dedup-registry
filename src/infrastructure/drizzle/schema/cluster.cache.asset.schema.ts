/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { pgTable, integer, uuid, primaryKey, index, foreignKey } from 'drizzle-orm/pg-core';
import { assetTable } from './asset.schema.js';
import { clusterCacheMetaTable } from './cluster.cache.meta.schema.js';

export const clusterCacheAssetTable = pgTable(
  'cluster_cache_asset',
  {
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assetTable.id, { onDelete: 'cascade' }),
    clusterCacheMetaId: integer('cluster_cache_meta_id').notNull(),
    clusterId: uuid('cluster_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.assetId, table.clusterCacheMetaId] }),
    index('cluster_cache_asset_cluster_cache_meta_id_lookup_fk').on(table.clusterCacheMetaId, table.clusterId),
    foreignKey({
      name: 'cluster_cache_asset_meta_id_fk',
      columns: [table.clusterCacheMetaId],
      foreignColumns: [clusterCacheMetaTable.id],
    }).onDelete('cascade'),
  ],
);
