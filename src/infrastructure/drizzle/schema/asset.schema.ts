/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { pgTable, uuid, varchar, timestamp, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { projectTable } from './project.schema.js';

export const assetTable = pgTable(
  'asset',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projectTable.id, { onDelete: 'cascade' }),
    identityId: varchar('identity_id', { length: 128 }),
    identityPath: varchar('identity_path', { length: 512 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('uniq_asset_project_identity_id')
      .on(table.projectId, table.identityId)
      .where(sql`${table.identityId} IS NOT NULL`),
    uniqueIndex('uniq_asset_project_identity_path')
      .on(table.projectId, table.identityPath)
      .where(sql`${table.identityPath} IS NOT NULL`),
    check('chk_asset_identity_present', sql`${table.identityId} IS NOT NULL OR ${table.identityPath} IS NOT NULL`),
  ],
);
