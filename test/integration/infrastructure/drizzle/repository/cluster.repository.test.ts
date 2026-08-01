import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  DrizzleClusterRepository,
  MAX_CLUSTER_EDGE_COUNT,
} from '../../../../../src/infrastructure/drizzle/repository/cluster.repository.js';
import { DrizzleAssetHashDuplicateRepository } from '../../../../../src/infrastructure/drizzle/repository/asset.hashDuplicate.repository.js';
import { DrizzleAssetHashRepository } from '../../../../../src/infrastructure/drizzle/repository/asset.hash.repository.js';
import type { DbClient } from '../../../../../src/infrastructure/drizzle/client.js';
import { useTestDb } from '../../../../helpers/db.js';
import { makeProject, makeAsset, makeAlgorithm } from '../../../../helpers/fixtures.js';
import { ValidationError } from '../../../../../src/domain/errors.js';
import type { Asset } from '../../../../../src/domain/model/model.js';

async function setup(db: DbClient): Promise<{
  projectId: string;
  algorithmId: number;
  clusters: DrizzleClusterRepository;
  duplicates: DrizzleAssetHashDuplicateRepository;
  hashes: DrizzleAssetHashRepository;
}> {
  const project = await makeProject(db);
  const algorithm = await makeAlgorithm(db);
  const clusters = new DrizzleClusterRepository(db);

  return {
    projectId: project.id,
    algorithmId: algorithm.id,
    clusters,
    duplicates: new DrizzleAssetHashDuplicateRepository(db, clusters),
    hashes: new DrizzleAssetHashRepository(db),
  };
}

/** Gives `a` and `b` a shared hash and recomputes both — an exact-comparison edge is always similarity 100. */
async function connect(
  hashes: DrizzleAssetHashRepository,
  duplicates: DrizzleAssetHashDuplicateRepository,
  projectId: string,
  algorithmId: number,
  a: Asset,
  b: Asset,
  sharedHash: string,
): Promise<void> {
  await hashes.replaceAll(a.id, algorithmId, [sharedHash]);
  await hashes.replaceAll(b.id, algorithmId, [sharedHash]);
  await duplicates.recomputeExact(projectId, algorithmId, a.id);
  await duplicates.recomputeExact(projectId, algorithmId, b.id);
}

describe('DrizzleClusterRepository', () => {
  const { db } = useTestDb();

  describe('countEdges', () => {
    it('returns 0 when there are no duplicate rows', async () => {
      const { clusters, projectId, algorithmId } = await setup(db());

      await expect(clusters.countEdges(projectId, algorithmId, 90)).resolves.toBe(0);
    });

    it('counts each undirected pair once', async () => {
      const { clusters, duplicates, hashes, projectId, algorithmId } = await setup(db());
      const a = await makeAsset(db(), projectId, 'a');
      const b = await makeAsset(db(), projectId, 'b');

      await connect(hashes, duplicates, projectId, algorithmId, a, b, 'shared');

      await expect(clusters.countEdges(projectId, algorithmId, 90)).resolves.toBe(1);
    });

    it('excludes edges below the given similarity threshold', async () => {
      const { clusters, duplicates, hashes, projectId, algorithmId } = await setup(db());
      const a = await makeAsset(db(), projectId, 'a');
      const b = await makeAsset(db(), projectId, 'b');

      await connect(hashes, duplicates, projectId, algorithmId, a, b, 'shared');

      // exact matches are always similarity=100, so a threshold above that excludes them
      await expect(clusters.countEdges(projectId, algorithmId, 100.1)).resolves.toBe(0);
    });
  });

  describe('bumpGeneration / bumpGenerationForAsset', () => {
    it('starts a scope at generation 1 on first bump', async () => {
      const { clusters, projectId, algorithmId } = await setup(db());

      await clusters.bumpGeneration(projectId, algorithmId);

      const { generation } = await clusters.ensureFresh(projectId, algorithmId, 90);
      expect(generation).toBe(1);
    });

    it('increments the generation on each subsequent bump', async () => {
      const { clusters, projectId, algorithmId } = await setup(db());

      await clusters.bumpGeneration(projectId, algorithmId);
      await clusters.bumpGeneration(projectId, algorithmId);
      await clusters.bumpGeneration(projectId, algorithmId);

      const { generation } = await clusters.ensureFresh(projectId, algorithmId, 90);
      expect(generation).toBe(3);
    });

    it('bumpGenerationForAsset resolves the project from the asset row and bumps the same scope', async () => {
      const { clusters, projectId, algorithmId } = await setup(db());
      const a = await makeAsset(db(), projectId, 'a');

      await clusters.bumpGenerationForAsset(algorithmId, a.id);

      const { generation } = await clusters.ensureFresh(projectId, algorithmId, 90);
      expect(generation).toBe(1);
    });

    it('bumpGenerationForAsset sweeps out cache entries past the retention window, keeping fresh ones', async () => {
      const { clusters, projectId, algorithmId } = await setup(db());
      const a = await makeAsset(db(), projectId, 'a');

      const stale = await clusters.ensureFresh(projectId, algorithmId, 90);
      const fresh = await clusters.ensureFresh(projectId, algorithmId, 95);
      await db().execute(
        sql`UPDATE cluster_cache_meta SET computed_at = now() - interval '2 hours' WHERE id = ${stale.metaId}`,
      );

      await clusters.bumpGenerationForAsset(algorithmId, a.id);

      const rows = await db().execute<{ id: number }>(
        sql`SELECT id FROM cluster_cache_meta WHERE project_id = ${projectId} AND algorithm_id = ${algorithmId}`,
      );
      const remainingIds = rows.map((r) => r.id);
      expect(remainingIds).not.toContain(stale.metaId);
      expect(remainingIds).toContain(fresh.metaId);
    });

    it('a write (recomputeExact) bumps the generation as a side effect', async () => {
      const { clusters, duplicates, hashes, projectId, algorithmId } = await setup(db());
      const a = await makeAsset(db(), projectId, 'a');
      const b = await makeAsset(db(), projectId, 'b');

      const before = await clusters.ensureFresh(projectId, algorithmId, 90);
      await connect(hashes, duplicates, projectId, algorithmId, a, b, 'shared');
      const after = await clusters.ensureFresh(projectId, algorithmId, 90);

      expect(after.generation).toBeGreaterThan(before.generation);
    });
  });

  describe('ensureFresh', () => {
    it('reuses the same cache entry (metaId) on repeat calls when nothing has changed', async () => {
      const { clusters, duplicates, hashes, projectId, algorithmId } = await setup(db());
      const a = await makeAsset(db(), projectId, 'a');
      const b = await makeAsset(db(), projectId, 'b');
      await connect(hashes, duplicates, projectId, algorithmId, a, b, 'shared');

      const first = await clusters.ensureFresh(projectId, algorithmId, 90);
      const second = await clusters.ensureFresh(projectId, algorithmId, 90);

      expect(second.metaId).toBe(first.metaId);
      expect(second.generation).toBe(first.generation);
    });

    it('recomputes into a new cache entry after a write bumps the generation', async () => {
      const { clusters, duplicates, hashes, projectId, algorithmId } = await setup(db());
      const a = await makeAsset(db(), projectId, 'a');
      const b = await makeAsset(db(), projectId, 'b');
      const c = await makeAsset(db(), projectId, 'c');
      await connect(hashes, duplicates, projectId, algorithmId, a, b, 'shared-ab');
      const first = await clusters.ensureFresh(projectId, algorithmId, 90);

      await connect(hashes, duplicates, projectId, algorithmId, b, c, 'shared-bc');
      const second = await clusters.ensureFresh(projectId, algorithmId, 90);

      expect(second.generation).toBeGreaterThan(first.generation);
      expect(second.metaId).not.toBe(first.metaId);
    });

    it('a different threshold for the same generation gets its own cache entry', async () => {
      const { clusters, duplicates, hashes, projectId, algorithmId } = await setup(db());
      const a = await makeAsset(db(), projectId, 'a');
      const b = await makeAsset(db(), projectId, 'b');
      await connect(hashes, duplicates, projectId, algorithmId, a, b, 'shared');

      const at90 = await clusters.ensureFresh(projectId, algorithmId, 90);
      const at95 = await clusters.ensureFresh(projectId, algorithmId, 95);

      expect(at95.metaId).not.toBe(at90.metaId);
      expect(at95.generation).toBe(at90.generation);
    });

    it('reuses an existing cache entry when pinned to its generation', async () => {
      const { clusters, duplicates, hashes, projectId, algorithmId } = await setup(db());
      const a = await makeAsset(db(), projectId, 'a');
      const b = await makeAsset(db(), projectId, 'b');
      await connect(hashes, duplicates, projectId, algorithmId, a, b, 'shared');
      const first = await clusters.ensureFresh(projectId, algorithmId, 90);

      const pinned = await clusters.ensureFresh(projectId, algorithmId, 90, first.generation);

      expect(pinned.metaId).toBe(first.metaId);
      expect(pinned.generation).toBe(first.generation);
    });

    it('throws ValidationError when pinned to a generation that was never computed', async () => {
      const { clusters, projectId, algorithmId } = await setup(db());

      await expect(clusters.ensureFresh(projectId, algorithmId, 90, 999)).rejects.toThrow(ValidationError);
      await expect(clusters.ensureFresh(projectId, algorithmId, 90, 999)).rejects.toThrow(/no longer available/);
    });
  });

  describe('computeStats', () => {
    it('returns zeroed stats when there are no qualifying edges', async () => {
      const { clusters, projectId, algorithmId } = await setup(db());

      await expect(clusters.computeStats(projectId, algorithmId, 90)).resolves.toEqual({
        clusterCount: 0,
        edgeCount: 0,
        assetsWithDuplicateCount: 0,
      });
    });

    it('groups two directly-connected assets into one cluster', async () => {
      const { clusters, duplicates, hashes, projectId, algorithmId } = await setup(db());
      const a = await makeAsset(db(), projectId, 'a');
      const b = await makeAsset(db(), projectId, 'b');
      await connect(hashes, duplicates, projectId, algorithmId, a, b, 'shared');

      await expect(clusters.computeStats(projectId, algorithmId, 90)).resolves.toEqual({
        clusterCount: 1,
        edgeCount: 1,
        assetsWithDuplicateCount: 2,
      });
    });

    it('propagates cluster membership across more than one hop (A-B-C, no direct A-C edge)', async () => {
      const { clusters, duplicates, hashes, projectId, algorithmId } = await setup(db());
      const a = await makeAsset(db(), projectId, 'a');
      const b = await makeAsset(db(), projectId, 'b');
      const c = await makeAsset(db(), projectId, 'c');
      await connect(hashes, duplicates, projectId, algorithmId, a, b, 'shared-ab');
      await connect(hashes, duplicates, projectId, algorithmId, b, c, 'shared-bc');

      const stats = await clusters.computeStats(projectId, algorithmId, 90);

      expect(stats?.clusterCount).toBe(1);
      expect(stats?.assetsWithDuplicateCount).toBe(3);
    });

    it('keeps two disconnected components as two separate clusters', async () => {
      const { clusters, duplicates, hashes, projectId, algorithmId } = await setup(db());
      const a = await makeAsset(db(), projectId, 'a');
      const b = await makeAsset(db(), projectId, 'b');
      const c = await makeAsset(db(), projectId, 'c');
      const d = await makeAsset(db(), projectId, 'd');
      await connect(hashes, duplicates, projectId, algorithmId, a, b, 'shared-ab');
      await connect(hashes, duplicates, projectId, algorithmId, c, d, 'shared-cd');

      const stats = await clusters.computeStats(projectId, algorithmId, 90);

      expect(stats?.clusterCount).toBe(2);
      expect(stats?.assetsWithDuplicateCount).toBe(4);
    });

    it('does not count a singleton asset with no qualifying edge', async () => {
      const { clusters, duplicates, hashes, projectId, algorithmId } = await setup(db());
      const a = await makeAsset(db(), projectId, 'a');
      const b = await makeAsset(db(), projectId, 'b');
      await makeAsset(db(), projectId, 'lonely');
      await connect(hashes, duplicates, projectId, algorithmId, a, b, 'shared');

      const stats = await clusters.computeStats(projectId, algorithmId, 90);

      expect(stats?.assetsWithDuplicateCount).toBe(2);
    });
  });

  describe('computeStats — over the edge-count safety cap', () => {
    it('returns null without attempting to compute clusters', async () => {
      const fakeDb = {
        execute: () => Promise.resolve([{ value: MAX_CLUSTER_EDGE_COUNT + 1 }]),
      } as unknown as DbClient;
      const clusters = new DrizzleClusterRepository(fakeDb);

      await expect(clusters.computeStats('project-1', 1, 90)).resolves.toBeNull();
    });
  });
});
