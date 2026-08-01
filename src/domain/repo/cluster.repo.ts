/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */

/** Backs `GET /stats`' Hamming totals — same cluster cache as the paginated read, aggregated instead of paged. */
export interface DuplicateClusterStats {
  clusterCount: number;
  edgeCount: number;
  assetsWithDuplicateCount: number;
}

/** A resolved (or pinned) cache scope: the rounded threshold, its generation, and the `cluster_cache_meta.id`
 * to join `cluster_cache_asset` against. */
export interface ResolvedClusterScope {
  threshold: number;
  generation: number;
  metaId: number;
}

/**
 * Connected components ("clusters") of mutually-duplicate assets, computed on the fly from
 * `asset_hash_duplicate` per threshold and cached until it ages out of retention (see
 * `DrizzleClusterRepository`) — threshold profiling is always answered exactly, never from a table that only
 * reflects one threshold. Positional args mirror the sibling `AssetHashDuplicates.findByProject` signature;
 * the paginated query-side DTO (`ClustersQuery`) lives in `application/query/cluster.query.ts` instead.
 */
export interface Clusters {
  computeStats(projectId: string, algorithmId: number, minSimilarity: number): Promise<DuplicateClusterStats | null>;

  /** Qualifying edge count for this scope — the safety-cap check `computeStats` and
   * `ClustersSearchRepository.paginate` both run before computing anything, since they react to "over cap"
   * differently (`null` vs throw); this just answers the count. */
  countEdges(projectId: string, algorithmId: number, minSimilarity: number): Promise<number>;

  /**
   * Resolves (or verifies) which cache generation a caller should read, guaranteeing its data exists.
   * `pinnedGeneration` omitted: resolves to the current `cluster_generation`, recomputing (an additive
   * insert, never touching older generations) if uncached for this threshold. `pinnedGeneration` given:
   * verifies that generation still exists, so `ClustersSearchRepository.paginate` can keep reading later
   * pages of the same snapshot even if a write lands in between — throws `ValidationError.clusterGenerationExpired`
   * once it's aged out, telling the caller to restart pagination without a pin.
   */
  ensureFresh(
    projectId: string,
    algorithmId: number,
    minSimilarity: number,
    pinnedGeneration?: number,
  ): Promise<ResolvedClusterScope>;
}
