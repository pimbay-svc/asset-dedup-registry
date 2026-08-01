/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
export const Comparison = {
  EXACT: 'exact',
  HAMMING: 'hamming',
  COSINE: 'cosine',
} as const;
export type Comparison = (typeof Comparison)[keyof typeof Comparison];
