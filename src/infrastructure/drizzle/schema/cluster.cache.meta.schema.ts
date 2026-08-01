/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { pgTable, serial, integer, uuid, doublePrecision, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { algorithmTable } from './algorithm.schema.js';
import { projectTable } from './project.schema.js';

export const clusterCacheMetaTable = pgTable(
  'cluster_cache_meta',
  {
    id: serial('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projectTable.id, { onDelete: 'cascade' }),
    algorithmId: integer('algorithm_id')
      .notNull()
      .references(() => algorithmTable.id),
    threshold: doublePrecision('threshold').notNull(),
    generation: integer('generation').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('uniq_cluster_cache_meta').on(table.projectId, table.algorithmId, table.threshold, table.generation),
    // Supports the retention sweep's `computed_at < now() - retention` filter, scoped per project+algorithm.
    index('idx_cluster_cache_meta_retention').on(table.projectId, table.algorithmId, table.computedAt),
  ],
);
