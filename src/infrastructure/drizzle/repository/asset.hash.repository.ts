/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { assetHashTable } from '../schema.js';
import type { AssetHashes, ExactDuplicateStats } from '../../../domain/repo/asset.repo.js';
import type { AssetHash } from '../../../domain/model/model.js';
import type { AssetHashWriter } from '../../../application/writer/asset.writer.js';

export class DrizzleAssetHashRepository implements AssetHashes, AssetHashWriter {
  constructor(private readonly db: DbClient) {}

  async findOne(assetId: string, algorithmId: number, sequenceIndex: number): Promise<AssetHash | null> {
    const [row] = await this.db
      .select()
      .from(assetHashTable)
      .where(
        and(
          eq(assetHashTable.assetId, assetId),
          eq(assetHashTable.algorithmId, algorithmId),
          eq(assetHashTable.sequenceIndex, sequenceIndex),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  async findByAssetId(assetId: string): Promise<AssetHash[]> {
    return this.db.select().from(assetHashTable).where(eq(assetHashTable.assetId, assetId));
  }

  /** Exact-match counts via `GROUP BY hash` — cheaper than hamming's union-find, no transitive edges to chase. */
  async countExactDuplicateStats(projectId: string, algorithmId: number): Promise<ExactDuplicateStats> {
    const [row] = await this.db.execute<{
      cluster_count: number;
      edge_count: number;
      assets_with_duplicate_count: number;
    }>(sql`
      WITH grouped AS (
        SELECT ah.hash, COUNT(DISTINCT ah.asset_id) AS n
        FROM asset_hash ah
        JOIN asset a ON a.id = ah.asset_id
        WHERE a.project_id = ${projectId} AND ah.algorithm_id = ${algorithmId}
        GROUP BY ah.hash
        HAVING COUNT(DISTINCT ah.asset_id) > 1
      )
      SELECT
        COUNT(*)::int AS cluster_count,
        COALESCE(SUM(n * (n - 1) / 2), 0)::int AS edge_count,
        COALESCE(SUM(n), 0)::int AS assets_with_duplicate_count
      FROM grouped
    `);

    /* v8 ignore next 5 -- unreachable: COUNT(*)/COALESCE(SUM(...)) with no GROUP BY always returns exactly one row */
    return {
      clusterCount: row?.cluster_count ?? 0,
      edgeCount: row?.edge_count ?? 0,
      assetsWithDuplicateCount: row?.assets_with_duplicate_count ?? 0,
    };
  }

  async replaceAll(assetId: string, algorithmId: number, hashes: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(assetHashTable)
        .where(and(eq(assetHashTable.assetId, assetId), eq(assetHashTable.algorithmId, algorithmId)));

      if (hashes.length === 0) {
        return;
      }

      await tx.insert(assetHashTable).values(
        hashes.map((hash, sequenceIndex) => ({
          assetId,
          algorithmId,
          sequenceIndex,
          hash,
        })),
      );
    });
  }
}
