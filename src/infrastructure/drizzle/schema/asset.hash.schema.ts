/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { pgTable, serial, uuid, integer, varchar, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { assetTable } from './asset.schema.js';
import { algorithmTable } from './algorithm.schema.js';

export const assetHashTable = pgTable(
  'asset_hash',
  {
    id: serial('id').primaryKey(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assetTable.id, { onDelete: 'cascade' }),
    algorithmId: integer('algorithm_id')
      .notNull()
      .references(() => algorithmTable.id),
    sequenceIndex: integer('sequence_index').notNull().default(0),
    hash: varchar('hash', { length: 512 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('uniq_asset_hash_asset_algorithm_sequence').on(table.assetId, table.algorithmId, table.sequenceIndex),
    index('idx_asset_hash_algorithm').on(table.algorithmId),
  ],
);
