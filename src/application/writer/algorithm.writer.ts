/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { Algorithm } from '../../domain/model/model.js';
import type { Comparison } from '../../domain/model/algorithm.model.js';

export interface NewAlgorithmParams {
  recipe: string;
  comparison: Comparison;
}

export interface AlgorithmWriter {
  add(params: NewAlgorithmParams): Promise<Algorithm>;
}
