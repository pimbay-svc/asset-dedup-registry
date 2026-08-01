/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { sql } from 'drizzle-orm';
import type { DbClient, DbOrTx } from '../client.js';
import type { Clusters, DuplicateClusterStats, ResolvedClusterScope } from '../../../domain/repo/cluster.repo.js';
import type { ClusterWriter } from '../../../application/writer/cluster.writer.js';
import { ValidationError } from '../../../domain/errors.js';

/** Above this many qualifying edges, computing clusters risks high request latency — a conservative
 * stopgap (mirrors the old `MAX_GROUPS_EDGE_COUNT`), checked via a cheap `COUNT(*)` before any cluster
 * work starts. Exported so `ClustersSearchRepository.paginate` applies the identical cap. */
export const MAX_CLUSTER_EDGE_COUNT = 200_000;

/** Caps {@link DrizzleClusterRepository.recompute}'s label-propagation passes — bounds the graph's
 * *diameter*, not its size. Near-duplicate clusters are small-diameter by nature, so this should never be
 * hit in practice; it exists to fail loudly instead of looping forever on a pathological graph. */
const MAX_PROPAGATION_ITERATIONS = 64;

/** How long a superseded generation's `cluster_cache_meta`/`cluster_cache_asset` rows survive before
 * {@link DrizzleClusterRepository.bumpGeneration}/`bumpGenerationForAsset` delete them. Deliberately a
 * *delay*, not an instant purge: a paginated `/duplicates/clusters` read pins itself to one `generation`
 * across all its pages, and can still be in progress after an unrelated write bumps the generation — an
 * instant purge would delete the snapshot that read is still pinned to. */
export const CLUSTER_CACHE_RETENTION_MS = 60 * 60_000;

/** Matches `similarity`'s own storage precision (see asset.hashDuplicate.schema.ts) — rounding here means
 * two requests differing only below that precision always share one cache entry instead of fragmenting it. */
function roundThreshold(value: number): number {
  return Math.round(value * 10) / 10;
}

export class DrizzleClusterRepository implements Clusters, ClusterWriter {
  constructor(private readonly db: DbClient) {}

  // --- ClusterGenerationWriter — called by DrizzleAssetHashDuplicateRepository on every write ---
  // One repository calling into another, unusual for this codebase — the alternative is
  // DrizzleAssetHashDuplicateRepository reaching into cluster_generation's schema/SQL directly, spreading
  // "how cache invalidation works" across two files instead of owning it in the repo that reads that state.

  /** Bumps `cluster_generation` for this scope (upserting a fresh row at 1 if none exists), then sweeps
   * `cluster_cache_meta` rows older than {@link CLUSTER_CACHE_RETENTION_MS} — their `cluster_cache_asset`
   * rows cascade automatically. A retention sweep, not an invalidation: still-within-retention rows are
   * left alone on purpose (see that constant's doc). Unconditional even on a zero-edge recompute — cheaper
   * than detecting "did anything change". */
  async bumpGeneration(projectId: string, algorithmId: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO cluster_generation (project_id, algorithm_id, generation)
        VALUES (${projectId}::uuid, ${algorithmId}::integer, 1)
        ON CONFLICT (project_id, algorithm_id)
        DO UPDATE SET generation = cluster_generation.generation + 1
      `);

      await tx.execute(sql`
        DELETE FROM cluster_cache_meta
        WHERE project_id = ${projectId} AND algorithm_id = ${algorithmId}
          AND computed_at < now() - (${CLUSTER_CACHE_RETENTION_MS}::text || ' milliseconds')::interval
      `);
    });
  }

  /** Same as {@link bumpGeneration}, but for call sites that only have `assetId` (e.g. `deleteByAsset`) —
   * the asset row still exists at call time, so the project is derivable via a subquery. Sweeps the whole
   * derived project+algorithm, not just the touched asset, since cluster membership is a whole-graph
   * property. */
  async bumpGenerationForAsset(algorithmId: number, assetId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO cluster_generation (project_id, algorithm_id, generation)
        SELECT a.project_id, ${algorithmId}::integer, 1 FROM asset a WHERE a.id = ${assetId}::uuid
        ON CONFLICT (project_id, algorithm_id)
        DO UPDATE SET generation = cluster_generation.generation + 1
      `);

      await tx.execute(sql`
        DELETE FROM cluster_cache_meta
        WHERE algorithm_id = ${algorithmId}
          AND project_id = (SELECT a.project_id FROM asset a WHERE a.id = ${assetId}::uuid)
          AND computed_at < now() - (${CLUSTER_CACHE_RETENTION_MS}::text || ' milliseconds')::interval
      `);
    });
  }

  async computeStats(
    projectId: string,
    algorithmId: number,
    minSimilarity: number,
  ): Promise<DuplicateClusterStats | null> {
    const edgeCount = await this.countEdges(projectId, algorithmId, minSimilarity);

    // Stryker disable next-line EqualityOperator: the >/>= boundary is only observable exactly at
    // 200,000 real edges, which isn't practical to set up in a test (200k rows) or fake convincingly
    // without stubbing out the whole transaction/insert chain.
    if (edgeCount > MAX_CLUSTER_EDGE_COUNT) {
      return null;
    }

    const { metaId } = await this.ensureFresh(projectId, algorithmId, minSimilarity);

    const [row] = await this.db.execute<{ cluster_count: number; assets_with_duplicate_count: number }>(sql`
      SELECT
        COUNT(DISTINCT cluster_id)::int AS cluster_count,
        COUNT(*)::int AS assets_with_duplicate_count
      FROM cluster_cache_asset
      WHERE cluster_cache_meta_id = ${metaId}
    `);

    /* v8 ignore next 5 -- unreachable: COUNT(*) with no GROUP BY always returns exactly one row */
    return {
      clusterCount: row?.cluster_count ?? 0,
      edgeCount,
      assetsWithDuplicateCount: row?.assets_with_duplicate_count ?? 0,
    };
  }

  /** Same directional-storage dedup as the old `findByProject`/`countPairsByProject`. Rounds internally so
   * every caller (this class's own `computeStats`, and `ClustersSearchRepository.paginate`) gets an
   * identical count without duplicating {@link roundThreshold}. Independent of `generation`/`metaId` — it
   * counts live edges in `asset_hash_duplicate`, not anything in the cache. */
  async countEdges(projectId: string, algorithmId: number, minSimilarity: number): Promise<number> {
    const threshold = roundThreshold(minSimilarity);

    const [row] = await this.db.execute<{ value: number }>(sql`
      SELECT count(*)::int AS value
      FROM asset_hash_duplicate d
      JOIN asset a ON a.id = d.asset_id
      WHERE a.project_id = ${projectId} AND d.algorithm_id = ${algorithmId}
        AND d.similarity >= ${threshold} AND d.asset_id < d.other_asset_id
    `);

    /* v8 ignore next -- unreachable: COUNT(*) with no GROUP BY always returns exactly one row */
    return row?.value ?? 0;
  }

  async ensureFresh(
    projectId: string,
    algorithmId: number,
    minSimilarity: number,
    pinnedGeneration?: number,
  ): Promise<ResolvedClusterScope> {
    const threshold = roundThreshold(minSimilarity);

    if (pinnedGeneration !== undefined) {
      const metaId = await this.findMetaId(projectId, algorithmId, threshold, pinnedGeneration);

      if (metaId === null) {
        throw ValidationError.clusterGenerationExpired(pinnedGeneration);
      }

      return { threshold, generation: pinnedGeneration, metaId };
    }

    const currentGeneration = await this.getCurrentGeneration(projectId, algorithmId);
    const existingMetaId = await this.findMetaId(projectId, algorithmId, threshold, currentGeneration);
    const metaId = existingMetaId ?? (await this.recompute(projectId, algorithmId, threshold, currentGeneration));

    return { threshold, generation: currentGeneration, metaId };
  }

  /** `null`/no row reads as generation 0 — "this scope has never had a qualifying edge written". */
  private async getCurrentGeneration(projectId: string, algorithmId: number): Promise<number> {
    const [row] = await this.db.execute<{ generation: number }>(sql`
      SELECT generation FROM cluster_generation WHERE project_id = ${projectId} AND algorithm_id = ${algorithmId}
    `);

    return row?.generation ?? 0;
  }

  private async findMetaId(
    projectId: string,
    algorithmId: number,
    threshold: number,
    generation: number,
  ): Promise<number | null> {
    const [row] = await this.db.execute<{ id: number }>(sql`
      SELECT id FROM cluster_cache_meta
      WHERE project_id = ${projectId} AND algorithm_id = ${algorithmId} AND threshold = ${threshold}
        AND generation = ${generation}
    `);

    return row?.id ?? null;
  }

  /**
   * Adds one generation's worth of rows — purely additive, never touches an existing generation's rows
   * (the retention sweep's job, on a timer). Runs in one transaction so concurrent readers see this
   * generation fully present or not at all. Returns the new (or, if another request raced to compute the
   * same generation first, the existing) `cluster_cache_meta.id`.
   *
   * Algorithm: seed every asset with >=1 qualifying edge with its own id as label, then repeatedly pull in
   * the minimum label among each asset's neighbors until a pass changes nothing — standard min-propagation
   * connected components, converging to the true per-component minimum in at most `diameter` passes.
   */
  private async recompute(
    projectId: string,
    algorithmId: number,
    threshold: number,
    generation: number,
  ): Promise<number> {
    return this.db.transaction(async (tx) => {
      // The meta row must exist before any cluster_cache_asset row can reference it (FK). `DO UPDATE SET
      // computed_at = computed_at` is a true no-op, only there so `RETURNING id` gives back a row whether
      // this insert won the race or a concurrent one did.
      const [metaRow] = await tx.execute<{ id: number }>(sql`
        INSERT INTO cluster_cache_meta (project_id, algorithm_id, threshold, generation, computed_at)
        VALUES (${projectId}, ${algorithmId}, ${threshold}, ${generation}, now())
        ON CONFLICT (project_id, algorithm_id, threshold, generation)
        DO UPDATE SET computed_at = cluster_cache_meta.computed_at
        RETURNING id
      `);

      /* v8 ignore next 3 -- unreachable: the upsert above always affects exactly one row and RETURNING
         always reflects it, insert or conflict-update alike */
      if (!metaRow) {
        // Stryker disable next-line all: unreachable — Postgres guarantees an insert/upsert returns
        // exactly one row; kept as a defensive invariant check, not a path any test can trigger honestly.
        throw new Error('unreachable: cluster_cache_meta upsert did not return a row');
      }

      const metaId = metaRow.id;

      await tx.execute(sql`
        INSERT INTO cluster_cache_asset (asset_id, cluster_cache_meta_id, cluster_id)
        SELECT DISTINCT d.asset_id, ${metaId}::integer, d.asset_id
        FROM asset_hash_duplicate d
        JOIN asset a ON a.id = d.asset_id
        WHERE a.project_id = ${projectId} AND d.algorithm_id = ${algorithmId} AND d.similarity >= ${threshold}
        ON CONFLICT (asset_id, cluster_cache_meta_id) DO NOTHING
      `);

      await this.propagateLabels(tx, projectId, algorithmId, threshold, metaId);

      return metaId;
    });
  }

  private async propagateLabels(
    tx: DbOrTx,
    projectId: string,
    algorithmId: number,
    threshold: number,
    metaId: number,
  ): Promise<void> {
    // Stryker disable next-line AssignmentOperator,EqualityOperator: only observable once propagation needs
    // close to MAX_PROPAGATION_ITERATIONS passes — a pathological chain length already accepted as
    // impractical to construct in a test. Normal-diameter graphs exit via `changed.length === 0` first.
    for (let iteration = 0; iteration < MAX_PROPAGATION_ITERATIONS; iteration += 1) {
      // MIN() has no uuid aggregate in Postgres — cast to text (ordering matches uuid's own hex encoding)
      // to aggregate, then cast back so the WHERE comparison stays uuid <-> uuid.
      const changed = await tx.execute<{ asset_id: string }>(sql`
        UPDATE cluster_cache_asset cs
        SET cluster_id = sub.min_label
        FROM (
          SELECT cs1.asset_id AS asset_id, MIN(cs2.cluster_id::text)::uuid AS min_label
          FROM asset_hash_duplicate d
          JOIN asset a ON a.id = d.asset_id
          JOIN cluster_cache_asset cs1 ON cs1.asset_id = d.asset_id AND cs1.cluster_cache_meta_id = ${metaId}
          JOIN cluster_cache_asset cs2 ON cs2.asset_id = d.other_asset_id AND cs2.cluster_cache_meta_id = ${metaId}
          WHERE a.project_id = ${projectId} AND d.algorithm_id = ${algorithmId} AND d.similarity >= ${threshold}
          GROUP BY cs1.asset_id
        ) sub
        WHERE cs.asset_id = sub.asset_id AND cs.cluster_cache_meta_id = ${metaId}
          AND sub.min_label < cs.cluster_id
        RETURNING cs.asset_id
      `);

      if (changed.length === 0) {
        return;
      }
    }

    /* v8 ignore next 3 -- defensive: near-duplicate graphs are small-diameter in practice, see the class doc */
    throw ValidationError.clusterComputationDidNotConverge(algorithmId, threshold);
  }
}
