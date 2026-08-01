/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { pgTable, uuid, varchar, timestamp, numeric, text, integer } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const projectTable = pgTable('project', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  slug: varchar('slug', { length: 64 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  recipes: text('recipes').array().notNull(),
  hammingThreshold: numeric('hamming_threshold', { precision: 5, scale: 2, mode: 'number' }),
  rateLimitPerMinute: integer('rate_limit_per_minute'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});
