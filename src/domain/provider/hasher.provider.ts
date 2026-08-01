/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { Comparison } from '../model/algorithm.model.js';
import type { MimeHint } from '../model/asset.model.js';

export interface CoreAlgorithm {
  recipe: string;
  comparison: Comparison;
}

export interface CoreHashResult {
  recipe: string;
  hashes: string[];
}

export interface CoreHasher {
  /** `recipes: null` asks core to run every pipeline configured for the resolved mime group — a project
   * always passes its own configured `recipes` list explicitly instead. */
  hash(mimeHint: MimeHint, fileContentBase64: string, recipes: string[] | null): Promise<CoreHashResult[]>;

  /** GET /algorithms — a pure function of core's config, used by AlgorithmService to seed `algorithm` rows. */
  listAlgorithms(): Promise<CoreAlgorithm[]>;
}
