/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { Algorithm } from '../model/model.js';

export interface Algorithms {
  findByRecipe(recipe: string): Promise<Algorithm | null>;
}
