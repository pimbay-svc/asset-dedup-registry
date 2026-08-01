/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { and, eq, gte, lt, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { DbClient } from '../client.js';
import { assetHashDuplicateTable, assetTable } from '../schema.js';
import type {
  AssetHashDuplicates,
  AssetHashDuplicateEdge,
  AssetHashDuplicateMatch,
} from '../../../domain/repo/asset.repo.js';
import { Identity } from '../../../domain/model/asset.model.js';
import type { ClusterWriter } from '../../../application/writer/cluster.writer.js';
import type { AssetHashDuplicateWriter } from '../../../application/writer/asset.writer.js';
import { identityCondition } from './asset.repository.js';

export class DrizzleAssetHashDuplicateRepository implements AssetHashDuplicates, AssetHashDuplicateWriter {
  /** `clusterWriter` is the one place this repository reaches into another's territory — every write below
   * must invalidate the cluster cache, but owning `cluster_generation` belongs to `DrizzleClusterRepository`. */
  constructor(
    private readonly db: DbClient,
    private readonly clusterWriter: ClusterWriter,
  ) {}

  /** One upserted row per matching asset per direction, written together (symmetric distance/similarity)
   * — lets every read join/group on `asset_id` alone, no UNION. */
  async recomputeExact(projectId: string, algorithmId: number, assetId: string): Promise<void> {
    await this.db.execute(sql`
      WITH new_hashes AS (
        SELECT hash FROM asset_hash WHERE asset_id = ${assetId} AND algorithm_id = ${algorithmId}
      ),
      matches AS (
        SELECT DISTINCT ah.asset_id AS other_asset_id
        FROM asset_hash ah
        JOIN asset a ON a.id = ah.asset_id
        JOIN new_hashes nh ON nh.hash = ah.hash
        WHERE a.project_id = ${projectId} AND ah.algorithm_id = ${algorithmId} AND ah.asset_id <> ${assetId}
      )
      INSERT INTO asset_hash_duplicate (algorithm_id, asset_id, other_asset_id, distance, similarity, computed_at)
      SELECT ${algorithmId}::integer, ${assetId}::uuid, other_asset_id, 0, 100, now() FROM matches
      UNION ALL
      SELECT ${algorithmId}::integer, other_asset_id, ${assetId}::uuid, 0, 100, now() FROM matches
      ON CONFLICT (algorithm_id, asset_id, other_asset_id)
      DO UPDATE SET distance = 0, similarity = 100, computed_at = EXCLUDED.computed_at
    `);

    await this.clusterWriter.bumpGeneration(projectId, algorithmId);
  }

  /** Hamming distance via bit_count()/XOR (PG14+); both directions written together, see {@link recomputeExact}. */
  async recomputeHamming(
    projectId: string,
    algorithmId: number,
    assetId: string,
    minSimilarity: number,
  ): Promise<void> {
    await this.db.execute(sql`
      WITH new_hashes AS (
        SELECT hash FROM asset_hash WHERE asset_id = ${assetId} AND algorithm_id = ${algorithmId}
      ),
      candidate_distances AS (
        SELECT ah.asset_id AS other_asset_id,
               length(nh.hash) * 4 AS bit_length,
               bit_count(('x' || nh.hash)::bit varying # ('x' || ah.hash)::bit varying) AS distance
        FROM asset_hash ah
        JOIN asset a ON a.id = ah.asset_id
        CROSS JOIN new_hashes nh
        WHERE a.project_id = ${projectId} AND ah.algorithm_id = ${algorithmId} AND ah.asset_id <> ${assetId}
      ),
      best AS (
        SELECT other_asset_id, MIN(distance) AS distance, MAX(bit_length) AS bit_length
        FROM candidate_distances
        GROUP BY other_asset_id
      ),
      scored AS (
        SELECT other_asset_id, distance, round((bit_length - distance)::numeric / bit_length * 100, 1) AS similarity
        FROM best
      ),
      qualifying AS (
        SELECT * FROM scored WHERE similarity >= ${minSimilarity}
      )
      INSERT INTO asset_hash_duplicate (algorithm_id, asset_id, other_asset_id, distance, similarity, computed_at)
      SELECT ${algorithmId}::integer, ${assetId}::uuid, other_asset_id, distance, similarity, now() FROM qualifying
      UNION ALL
      SELECT ${algorithmId}::integer, other_asset_id, ${assetId}::uuid, distance, similarity, now() FROM qualifying
      ON CONFLICT (algorithm_id, asset_id, other_asset_id)
      DO UPDATE SET distance = EXCLUDED.distance, similarity = EXCLUDED.similarity, computed_at = EXCLUDED.computed_at
    `);

    await this.clusterWriter.bumpGeneration(projectId, algorithmId);
  }

  /** Both directional rows reference `assetId`. Must run while its `asset` row still exists (see
   * {@link bumpGenerationForAsset}) — every current call site already calls this before removing the
   * asset, so this just makes that a hard requirement rather than an accident of call order. */
  async deleteByAsset(algorithmId: number, assetId: string): Promise<void> {
    await this.db
      .delete(assetHashDuplicateTable)
      .where(
        and(
          eq(assetHashDuplicateTable.algorithmId, algorithmId),
          or(eq(assetHashDuplicateTable.assetId, assetId), eq(assetHashDuplicateTable.otherAssetId, assetId)),
        ),
      );

    await this.clusterWriter.bumpGenerationForAsset(algorithmId, assetId);
  }

  /** Every row's own `asset_id` is in-project (matches never cross projects), so this alone is sufficient. */
  async deleteByProject(projectId: string, algorithmId: number): Promise<void> {
    await this.db.execute(sql`
      DELETE FROM asset_hash_duplicate d
      USING asset a
      WHERE a.id = d.asset_id AND a.project_id = ${projectId} AND d.algorithm_id = ${algorithmId}
    `);

    await this.clusterWriter.bumpGeneration(projectId, algorithmId);
  }

  /** Each edge is stored as two directional rows; `asset_id < other_asset_id` keeps this at one row per edge. */
  async findByProject(
    projectId: string,
    algorithmId: number,
    minSimilarity: number,
  ): Promise<AssetHashDuplicateEdge[]> {
    const assetA = alias(assetTable, 'asset_a');
    const assetB = alias(assetTable, 'asset_b');

    const rows = await this.db
      .select({
        aId: assetA.identityId,
        aPath: assetA.identityPath,
        bId: assetB.identityId,
        bPath: assetB.identityPath,
        distance: assetHashDuplicateTable.distance,
        similarity: assetHashDuplicateTable.similarity,
      })
      .from(assetHashDuplicateTable)
      .innerJoin(assetA, eq(assetA.id, assetHashDuplicateTable.assetId))
      .innerJoin(assetB, eq(assetB.id, assetHashDuplicateTable.otherAssetId))
      .where(
        and(
          eq(assetA.projectId, projectId),
          eq(assetHashDuplicateTable.algorithmId, algorithmId),
          gte(assetHashDuplicateTable.similarity, minSimilarity),
          lt(assetHashDuplicateTable.assetId, assetHashDuplicateTable.otherAssetId),
        ),
      );

    return rows.map((row) => ({
      identityA: new Identity(row.aId, row.aPath),
      identityB: new Identity(row.bId, row.bPath),
      distance: row.distance,
      similarity: row.similarity,
    }));
  }

  /** Batched lookup for one or more assets — no UNION, the requested asset is always the row's own `asset_id`. */
  async findByAssets(
    projectId: string,
    identities: Identity[],
    algorithmId: number,
    minSimilarity: number,
  ): Promise<AssetHashDuplicateMatch[]> {
    // Stryker disable next-line all: pure optimization, not correctness — `or()` on an empty array below
    // returns `undefined`, which would drop the filter entirely (matching everything) rather than nothing,
    // so this guard is also a correctness guard, not just a saved round-trip.
    if (identities.length === 0) {
      return [];
    }

    const self = alias(assetTable, 'asset_self');
    const other = alias(assetTable, 'asset_other');

    const rows = await this.db
      .select({
        selfId: self.identityId,
        selfPath: self.identityPath,
        otherId: other.identityId,
        otherPath: other.identityPath,
        distance: assetHashDuplicateTable.distance,
        similarity: assetHashDuplicateTable.similarity,
      })
      .from(assetHashDuplicateTable)
      .innerJoin(self, eq(self.id, assetHashDuplicateTable.assetId))
      .innerJoin(other, eq(other.id, assetHashDuplicateTable.otherAssetId))
      .where(
        and(
          eq(self.projectId, projectId),
          eq(assetHashDuplicateTable.algorithmId, algorithmId),
          gte(assetHashDuplicateTable.similarity, minSimilarity),
          or(...identities.map((identity) => identityCondition(self, identity))),
        ),
      );

    return rows.map((row) => ({
      identity: new Identity(row.selfId, row.selfPath),
      otherIdentity: new Identity(row.otherId, row.otherPath),
      distance: row.distance,
      similarity: row.similarity,
    }));
  }

  /** Same dedup filter as `findByProject` — counts each directional pair once. */
  async countPairsByProject(projectId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: sql<number>`count(*)::int`.as('value') })
      .from(assetHashDuplicateTable)
      .innerJoin(assetTable, eq(assetTable.id, assetHashDuplicateTable.assetId))
      .where(
        and(
          eq(assetTable.projectId, projectId),
          lt(assetHashDuplicateTable.assetId, assetHashDuplicateTable.otherAssetId),
        ),
      );

    /* v8 ignore next -- unreachable: COUNT(*) with no GROUP BY always returns exactly one row */
    return row?.value ?? 0;
  }
}
