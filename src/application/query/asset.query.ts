/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { Page } from '@pimbay/search-query';
import type { Identity } from '../../domain/model/asset.model.js';

export interface AssetHashDuplicateRankingQuery {
  projectId: string;
  algorithmId: number;
  minSimilarity: number;
  matchLimit?: number;
  id?: string;
  path?: string;
}

export interface AssetHashDuplicateMatchesQuery {
  projectId: string;
  algorithmId: number;
  identity: Identity;
  minSimilarity: number;
}

export interface AssetHashDuplicateCount {
  identity: Identity;
  duplicateCount: number;
}

export interface DuplicateMatch {
  identity: Identity;
  distance: number;
  similarity: number;
}

export interface AssetWithDuplicateCount {
  identity: Identity;
  duplicateCount: number;
  matches: DuplicateMatch[];
}

export interface AssetHashDuplicatesSearch {
  paginateRanking(
    query: AssetHashDuplicateRankingQuery,
    page: number,
    size: number,
  ): Promise<Page<AssetWithDuplicateCount>>;
  paginateMatches(query: AssetHashDuplicateMatchesQuery, page: number, size: number): Promise<Page<DuplicateMatch>>;
}
