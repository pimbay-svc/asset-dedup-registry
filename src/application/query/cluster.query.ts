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

export interface ClustersQuery {
  projectId: string;
  algorithmId: number;
  minSimilarity: number;
  /** Pins this read to a specific cache snapshot — pass back an earlier page's `generation` so later
   * pages stay consistent even if a write lands in between. Omit for "whatever's current" (always true
   * for page 1). Throws once that generation ages out of retention. */
  generation?: number;
  id?: string;
  path?: string;
}

export interface DuplicateClusterAsset {
  identity: Identity;
  avgSimilarityToCluster: number;
}

export interface DuplicateCluster {
  clusterId: string;
  maxSimilarity: number;
  assets: DuplicateClusterAsset[];
}

/** `generation` alongside the page itself — round-trip it back as `ClustersQuery.generation` on the next
 * page's request to keep reading this exact snapshot. */
export interface ClustersPage {
  generation: number;
  page: Page<DuplicateCluster>;
}

export interface ClustersSearch {
  paginate(query: ClustersQuery, page: number, size: number): Promise<ClustersPage>;
}
