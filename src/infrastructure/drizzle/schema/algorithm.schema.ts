/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { pgTable, serial, varchar, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { Comparison } from '../../../domain/model/algorithm.model.js';

export const algorithmTable = pgTable(
  'algorithm',
  {
    id: serial('id').primaryKey(),
    recipe: varchar('recipe', { length: 64 }).notNull().unique(),
    comparison: varchar('comparison', { length: 16 }).notNull().$type<Comparison>(),
  },
  (table) => [check('chk_algorithm_comparison', sql`${table.comparison} IN ('exact', 'hamming', 'cosine')`)],
);
