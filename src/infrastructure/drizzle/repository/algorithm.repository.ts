/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { algorithmTable } from '../schema.js';
import type { Algorithms } from '../../../domain/repo/algorithm.repo.js';
import type { Algorithm } from '../../../domain/model/model.js';
import type { AlgorithmWriter, NewAlgorithmParams } from '../../../application/writer/algorithm.writer.js';

export class DrizzleAlgorithmRepository implements Algorithms, AlgorithmWriter {
  constructor(private readonly db: DbClient) {}

  async findByRecipe(recipe: string): Promise<Algorithm | null> {
    const [row] = await this.db.select().from(algorithmTable).where(eq(algorithmTable.recipe, recipe)).limit(1);

    return row ?? null;
  }

  async add(params: NewAlgorithmParams): Promise<Algorithm> {
    const [row] = await this.db.insert(algorithmTable).values(params).onConflictDoNothing().returning();

    if (row) {
      return row;
    }

    const existing = await this.findByRecipe(params.recipe);

    if (!existing) {
      throw new Error(`failed to resolve or create algorithm row for recipe "${params.recipe}"`);
    }

    return existing;
  }
}
