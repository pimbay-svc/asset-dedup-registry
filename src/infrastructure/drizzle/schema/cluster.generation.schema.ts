/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { pgTable, integer, uuid, primaryKey } from 'drizzle-orm/pg-core';
import { algorithmTable } from './algorithm.schema.js';
import { projectTable } from './project.schema.js';

export const clusterGenerationTable = pgTable(
  'cluster_generation',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projectTable.id, { onDelete: 'cascade' }),
    algorithmId: integer('algorithm_id')
      .notNull()
      .references(() => algorithmTable.id),
    generation: integer('generation').notNull().default(1),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.algorithmId] })],
);
