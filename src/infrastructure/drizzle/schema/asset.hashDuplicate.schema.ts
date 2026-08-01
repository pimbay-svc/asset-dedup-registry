/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { pgTable, serial, integer, doublePrecision, uuid, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { algorithmTable } from './algorithm.schema.js';
import { assetTable } from './asset.schema.js';

export const assetHashDuplicateTable = pgTable(
  'asset_hash_duplicate',
  {
    id: serial('id').primaryKey(),
    algorithmId: integer('algorithm_id')
      .notNull()
      .references(() => algorithmTable.id),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assetTable.id, { onDelete: 'cascade' }),
    otherAssetId: uuid('other_asset_id')
      .notNull()
      .references(() => assetTable.id, { onDelete: 'cascade' }),
    // Hamming distance (0 for exact-match recipes), lower = more similar.
    distance: integer('distance').notNull(),
    // Similarity % (0-100, one decimal), computed from distance and hash bit length at recompute time.
    similarity: doublePrecision('similarity').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('uniq_hash_duplicate_pair').on(table.algorithmId, table.assetId, table.otherAssetId),
    index('idx_hash_duplicate_asset').on(table.algorithmId, table.assetId, table.similarity),
  ],
);
