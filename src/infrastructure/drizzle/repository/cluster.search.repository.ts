/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { and, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { clusterCacheAssetTable, assetTable, assetHashDuplicateTable } from '../schema.js';
import { paginatePage, mapPage, createSearchTermsConfig } from '@pimbay/search-query';
import { DrizzleSimpleAdapter, buildSearchTermsConditionFromString } from '@pimbay/search-query-drizzle';
import type { Clusters } from '../../../domain/repo/cluster.repo.js';
import { Identity } from '../../../domain/model/asset.model.js';
import type {
  ClustersSearch,
  ClustersQuery,
  ClustersPage,
  DuplicateCluster,
  DuplicateClusterAsset,
} from '../../../application/query/cluster.query.js';
import { ValidationError } from '../../../domain/errors.js';
import { MAX_CLUSTER_EDGE_COUNT } from './cluster.repository.js';

interface ClusterSummaryRow {
  clusterId: string;
  maxSimilarity: number;
}

const SEARCH_TERMS_CONFIG = createSearchTermsConfig({ anywhere: true });

interface RawClusterMemberRow {
  clusterId: string;
  identityId: string | null;
  identityPath: string | null;
  avgSimilarity: number;
}

export class DrizzleClusterSearchRepository implements ClustersSearch {
  constructor(
    private readonly db: DbClient,
    private readonly clusters: Clusters,
  ) {}

  async paginate(query: ClustersQuery, page: number, size: number): Promise<ClustersPage> {
    const edgeCount = await this.clusters.countEdges(query.projectId, query.algorithmId, query.minSimilarity);

    // Stryker disable next-line EqualityOperator: same rationale as cluster.repository.ts — only
    // observable exactly at 200,000 real edges, impractical to set up in a test.
    if (edgeCount > MAX_CLUSTER_EDGE_COUNT) {
      throw ValidationError.tooManyDuplicateEdges(edgeCount);
    }

    // ensureFresh both resolves (recomputing if stale) which snapshot to read AND hands back its
    // cluster_cache_meta.id — every query below filters on that single id, not threshold/generation
    // separately, so this stays pinned to exactly that snapshot regardless of writes landing afterward.
    const { threshold, generation, metaId } = await this.clusters.ensureFresh(
      query.projectId,
      query.algorithmId,
      query.minSimilarity,
      query.generation,
    );

    const matchingClusterIds = await this.resolveMatchingClusterIds(metaId, query);
    const summaryPage = await paginatePage(
      this.createClusterSummaryAdapter(metaId, threshold, matchingClusterIds),
      page,
      size,
    );
    const membersByCluster = await this.loadMembers(metaId, threshold, summaryPage.getData());

    return { generation, page: mapPage(summaryPage, (row) => buildCluster(row, membersByCluster)) };
  }

  /** `id`/`path` filter which *clusters* qualify (contain at least one matching member), not which rows
   * feed `createClusterSummaryAdapter`'s `max_similarity` aggregate — so this resolves matching cluster ids
   * up front via its own join, rather than filtering `assetTable` directly into that aggregate query, which
   * would wrongly narrow `max_similarity` to just the matching member's own edges. `undefined` means no
   * filter was requested at all (every cluster qualifies); an empty array means one was, but nothing matched. */
  private async resolveMatchingClusterIds(metaId: number, query: ClustersQuery): Promise<string[] | undefined> {
    // Stryker disable next-line all: pure optimization, not correctness — skipping this saves a round trip
    // when no filter was requested, but the query below would resolve to the exact same cluster ids anyway:
    // `cluster_cache_asset.asset_id` cascades on asset delete, so an unfiltered join can never return a
    // dangling row the unfiltered scope in `createClusterSummaryAdapter` wouldn't already include.
    if (query.id === undefined && query.path === undefined) {
      return undefined;
    }

    const filter = and(
      query.id === undefined ? undefined : eq(assetTable.identityId, query.id),
      query.path === undefined
        ? undefined
        : buildSearchTermsConditionFromString(assetTable.identityPath, query.path, SEARCH_TERMS_CONFIG),
    );

    const rows = await this.db
      .selectDistinct({ clusterId: clusterCacheAssetTable.clusterId })
      .from(clusterCacheAssetTable)
      .innerJoin(assetTable, eq(assetTable.id, clusterCacheAssetTable.assetId))
      .where(and(eq(clusterCacheAssetTable.clusterCacheMetaId, metaId), filter));

    return rows.map((row) => row.clusterId);
  }

  /** `cs.cluster_cache_meta_id` in the join condition (not just WHERE) keeps this to exactly the
   * qualifying edges for this one pinned snapshot — same shape as `createRankingAdapter`. */
  private createClusterSummaryAdapter(
    metaId: number,
    threshold: number,
    matchingClusterIds?: string[],
  ): DrizzleSimpleAdapter<{ count: number }, ClusterSummaryRow> {
    const scope: SQL | undefined = and(
      eq(clusterCacheAssetTable.clusterCacheMetaId, metaId),
      matchingClusterIds === undefined ? undefined : inArray(clusterCacheAssetTable.clusterId, matchingClusterIds),
    );

    return new DrizzleSimpleAdapter(
      () =>
        this.db
          .select({ count: sql<number>`count(distinct ${clusterCacheAssetTable.clusterId})::int`.as('count') })
          .from(clusterCacheAssetTable)
          .$dynamic()
          .where(scope),
      (row) => row.count,
      () =>
        this.db
          .select({
            clusterId: clusterCacheAssetTable.clusterId,
            maxSimilarity: sql<number>`max(${assetHashDuplicateTable.similarity})`.as('max_similarity'),
          })
          .from(clusterCacheAssetTable)
          .innerJoin(
            assetHashDuplicateTable,
            and(
              eq(assetHashDuplicateTable.assetId, clusterCacheAssetTable.assetId),
              gte(assetHashDuplicateTable.similarity, threshold),
            ),
          )
          .$dynamic()
          .where(scope)
          .groupBy(clusterCacheAssetTable.clusterId)
          .orderBy(sql`max_similarity desc`, clusterCacheAssetTable.clusterId),
    );
  }

  /** Per-member avg-similarity-to-cluster, scoped to just the requested page's cluster ids — mirrors
   * `loadMatches` in asset.hashDuplicate.search.repository.ts. */
  private async loadMembers(
    metaId: number,
    threshold: number,
    clusters: readonly ClusterSummaryRow[],
  ): Promise<Map<string, DuplicateClusterAsset[]>> {
    const membersByCluster = new Map<string, DuplicateClusterAsset[]>();

    // Stryker disable next-line all: pure optimization, not correctness — drizzle's `inArray(col, [])`
    // below already generates an always-false condition, so skipping straight to the empty map here only
    // saves a wasted round-trip; the query would return the same empty result either way.
    if (clusters.length === 0) {
      return membersByCluster;
    }

    const clusterIds = clusters.map((cluster) => cluster.clusterId);

    const rows: RawClusterMemberRow[] = await this.db
      .select({
        clusterId: clusterCacheAssetTable.clusterId,
        identityId: assetTable.identityId,
        identityPath: assetTable.identityPath,
        avgSimilarity: sql<number>`avg(${assetHashDuplicateTable.similarity})`.as('avg_similarity'),
      })
      .from(clusterCacheAssetTable)
      .innerJoin(assetTable, eq(assetTable.id, clusterCacheAssetTable.assetId))
      .innerJoin(
        assetHashDuplicateTable,
        and(
          eq(assetHashDuplicateTable.assetId, clusterCacheAssetTable.assetId),
          gte(assetHashDuplicateTable.similarity, threshold),
        ),
      )
      .where(
        and(
          eq(clusterCacheAssetTable.clusterCacheMetaId, metaId),
          inArray(clusterCacheAssetTable.clusterId, clusterIds),
        ),
      )
      // Grouped by the asset's own primary key, not the identity columns directly — Postgres' functional-
      // dependency rule then allows selecting identity_id/identity_path ungrouped (see the analogous note
      // on createRankingAdapter in asset.hashDuplicate.search.repository.ts).
      .groupBy(clusterCacheAssetTable.clusterId, assetTable.id);

    for (const row of rows) {
      const list = membersByCluster.get(row.clusterId) ?? [];
      list.push({
        identity: new Identity(row.identityId, row.identityPath),
        avgSimilarityToCluster: Math.round(row.avgSimilarity * 10) / 10,
      });
      membersByCluster.set(row.clusterId, list);
    }

    return membersByCluster;
  }
}

function buildCluster(
  summary: ClusterSummaryRow,
  membersByCluster: Map<string, DuplicateClusterAsset[]>,
): DuplicateCluster {
  return {
    clusterId: summary.clusterId,
    maxSimilarity: summary.maxSimilarity,
    /* v8 ignore next -- unreachable: every clusterId here came from loadMembers' own scope, so it always
       has an entry */
    assets: membersByCluster.get(summary.clusterId) ?? [],
  };
}
