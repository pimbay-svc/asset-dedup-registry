import { describe, it, expect } from 'vitest';
import { DrizzleAssetHashDuplicateRepository } from '../../../../../src/infrastructure/drizzle/repository/asset.hashDuplicate.repository.js';
import { DrizzleClusterRepository } from '../../../../../src/infrastructure/drizzle/repository/cluster.repository.js';
import { DrizzleAssetHashRepository } from '../../../../../src/infrastructure/drizzle/repository/asset.hash.repository.js';
import type { DbClient } from '../../../../../src/infrastructure/drizzle/client.js';
import { Identity } from '../../../../../src/domain/model/asset.model.js';
import { useTestDb } from '../../../../helpers/db.js';
import { makeProject, makeAsset, makeAlgorithm } from '../../../../helpers/fixtures.js';

// 64-bit (16 hex char) hashes with known Hamming distances from ZERO.
const ZERO = '0000000000000000';
const DIST_1 = '0000000000000001'; // 1 bit set -> distance 1, similarity 98.4
const DIST_8 = '00000000000000ff'; // 8 bits set -> distance 8, similarity 87.5
const FAR = 'ffffffffffffffff'; // all bits set -> distance 64, similarity 0

async function setup(db: DbClient): Promise<{
  project: Awaited<ReturnType<typeof makeProject>>;
  algorithm: Awaited<ReturnType<typeof makeAlgorithm>>;
  hashRepo: DrizzleAssetHashRepository;
}> {
  const project = await makeProject(db);
  const algorithm = await makeAlgorithm(db);
  const hashRepo = new DrizzleAssetHashRepository(db);

  return { project, algorithm, hashRepo };
}

describe('DrizzleAssetHashDuplicateRepository', () => {
  const { db } = useTestDb();

  describe('recomputeExact', () => {
    it('creates a distance-0/similarity-100 row for assets sharing a hash', async () => {
      const { project, algorithm, hashRepo } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      await hashRepo.replaceAll(a.id, algorithm.id, ['shared-hash']);
      await hashRepo.replaceAll(b.id, algorithm.id, ['shared-hash']);
      const repo = new DrizzleAssetHashDuplicateRepository(db(), new DrizzleClusterRepository(db()));

      await repo.recomputeExact(project.id, algorithm.id, a.id);

      const matches = await repo.findByAssets(project.id, [new Identity('a', null)], algorithm.id, 0);
      expect(matches).toEqual([
        { identity: new Identity('a', null), otherIdentity: new Identity('b', null), distance: 0, similarity: 100 },
      ]);
    });

    it('does not match assets with no shared hash', async () => {
      const { project, algorithm, hashRepo } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      await hashRepo.replaceAll(a.id, algorithm.id, ['hash-a']);
      await hashRepo.replaceAll(b.id, algorithm.id, ['hash-b']);
      const repo = new DrizzleAssetHashDuplicateRepository(db(), new DrizzleClusterRepository(db()));

      await repo.recomputeExact(project.id, algorithm.id, a.id);

      await expect(repo.findByAssets(project.id, [new Identity('a', null)], algorithm.id, 0)).resolves.toEqual([]);
    });
  });

  describe('recomputeHamming', () => {
    it('stores the minimum distance and its derived similarity when above the threshold', async () => {
      const { project, algorithm, hashRepo } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [DIST_1]);
      const repo = new DrizzleAssetHashDuplicateRepository(db(), new DrizzleClusterRepository(db()));

      await repo.recomputeHamming(project.id, algorithm.id, a.id, 90);

      const matches = await repo.findByAssets(project.id, [new Identity('a', null)], algorithm.id, 0);
      expect(matches).toEqual([
        { identity: new Identity('a', null), otherIdentity: new Identity('b', null), distance: 1, similarity: 98.4 },
      ]);
    });

    it('does not store a pair below the similarity threshold', async () => {
      const { project, algorithm, hashRepo } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [FAR]);
      const repo = new DrizzleAssetHashDuplicateRepository(db(), new DrizzleClusterRepository(db()));

      await repo.recomputeHamming(project.id, algorithm.id, a.id, 90);

      await expect(repo.findByAssets(project.id, [new Identity('a', null)], algorithm.id, 0)).resolves.toEqual([]);
    });

    it('upserts — a second recompute updates distance/similarity in place', async () => {
      const { project, algorithm, hashRepo } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [DIST_1]);
      const repo = new DrizzleAssetHashDuplicateRepository(db(), new DrizzleClusterRepository(db()));
      await repo.recomputeHamming(project.id, algorithm.id, a.id, 0);

      await hashRepo.replaceAll(b.id, algorithm.id, [DIST_8]);
      await repo.recomputeHamming(project.id, algorithm.id, a.id, 0);

      const matches = await repo.findByAssets(project.id, [new Identity('a', null)], algorithm.id, 0);
      expect(matches).toEqual([
        { identity: new Identity('a', null), otherIdentity: new Identity('b', null), distance: 8, similarity: 87.5 },
      ]);
    });

    it('keeps the minimum distance across multiple hashes (multi-frame) per candidate', async () => {
      const { project, algorithm, hashRepo } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO, DIST_8]);
      await hashRepo.replaceAll(b.id, algorithm.id, [DIST_1]);
      const repo = new DrizzleAssetHashDuplicateRepository(db(), new DrizzleClusterRepository(db()));

      await repo.recomputeHamming(project.id, algorithm.id, a.id, 0);

      const matches = await repo.findByAssets(project.id, [new Identity('a', null)], algorithm.id, 0);
      expect(matches[0]?.distance).toBe(1); // ZERO vs DIST_1, the closer of the two frame comparisons
    });
  });

  describe('deleteByAsset', () => {
    it('removes rows touching the asset from either side, scoped to the algorithm', async () => {
      const { project, algorithm, hashRepo } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [DIST_1]);
      const repo = new DrizzleAssetHashDuplicateRepository(db(), new DrizzleClusterRepository(db()));
      await repo.recomputeHamming(project.id, algorithm.id, a.id, 0);

      await repo.deleteByAsset(algorithm.id, a.id);

      await expect(
        repo.findByAssets(project.id, [new Identity('a', null), new Identity('b', null)], algorithm.id, 0),
      ).resolves.toEqual([]);
    });
  });

  describe('deleteByProject', () => {
    it('clears all rows for (project, algorithm) without touching other algorithms', async () => {
      const project = await makeProject(db());
      const algorithm = await makeAlgorithm(db());
      const otherAlgorithm = await makeAlgorithm(db());
      const hashRepo = new DrizzleAssetHashRepository(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [DIST_1]);
      await hashRepo.replaceAll(a.id, otherAlgorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, otherAlgorithm.id, [DIST_1]);
      const repo = new DrizzleAssetHashDuplicateRepository(db(), new DrizzleClusterRepository(db()));
      await repo.recomputeHamming(project.id, algorithm.id, a.id, 0);
      await repo.recomputeHamming(project.id, otherAlgorithm.id, a.id, 0);

      await repo.deleteByProject(project.id, algorithm.id);

      await expect(repo.findByAssets(project.id, [new Identity('a', null)], algorithm.id, 0)).resolves.toEqual([]);
      await expect(
        repo.findByAssets(project.id, [new Identity('a', null)], otherAlgorithm.id, 0),
      ).resolves.toHaveLength(1);
    });
  });

  describe('findByProject', () => {
    it('returns one row per edge with both identities resolved, scoped to the project', async () => {
      const { project, algorithm, hashRepo } = await setup(db());
      const otherProject = await makeProject(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      const outside = await makeAsset(db(), otherProject.id, 'outside');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [DIST_1]);
      await hashRepo.replaceAll(outside.id, algorithm.id, [ZERO]);
      const repo = new DrizzleAssetHashDuplicateRepository(db(), new DrizzleClusterRepository(db()));
      await repo.recomputeHamming(project.id, algorithm.id, a.id, 0);

      const edges = await repo.findByProject(project.id, algorithm.id, 0);

      expect(edges).toHaveLength(1);
      const edge = edges[0];
      expect([edge?.identityA.id, edge?.identityB.id].sort()).toEqual(['a', 'b']);
      expect(edge?.distance).toBe(1);
      expect(edge?.similarity).toBe(98.4);
    });

    it('filters by minSimilarity', async () => {
      const { project, algorithm, hashRepo } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [DIST_8]);
      const repo = new DrizzleAssetHashDuplicateRepository(db(), new DrizzleClusterRepository(db()));
      await repo.recomputeHamming(project.id, algorithm.id, a.id, 0);

      await expect(repo.findByProject(project.id, algorithm.id, 90)).resolves.toEqual([]);
      await expect(repo.findByProject(project.id, algorithm.id, 80)).resolves.toHaveLength(1);
    });
  });

  describe('findByAssets', () => {
    it('returns matches for multiple requested identities in a single call, regardless of which side they are stored on', async () => {
      const { project, algorithm, hashRepo } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      const c = await makeAsset(db(), project.id, 'c');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [DIST_1]);
      await hashRepo.replaceAll(c.id, algorithm.id, [DIST_1]);
      const repo = new DrizzleAssetHashDuplicateRepository(db(), new DrizzleClusterRepository(db()));
      await repo.recomputeHamming(project.id, algorithm.id, a.id, 0);
      await repo.recomputeHamming(project.id, algorithm.id, b.id, 0);

      const matches = await repo.findByAssets(
        project.id,
        [new Identity('a', null), new Identity('b', null)],
        algorithm.id,
        0,
      );

      expect(matches.map((m) => `${m.identity.id ?? ''}->${m.otherIdentity.id ?? ''}`).sort()).toEqual(
        ['a->b', 'a->c', 'b->a', 'b->c'].sort(),
      );
    });

    it('returns an empty array for an empty identities list without querying', async () => {
      const { project, algorithm } = await setup(db());
      const repo = new DrizzleAssetHashDuplicateRepository(db(), new DrizzleClusterRepository(db()));

      await expect(repo.findByAssets(project.id, [], algorithm.id, 0)).resolves.toEqual([]);
    });
  });

  describe('countPairsByProject', () => {
    it('counts distinct pairs once, not the doubled directional row count', async () => {
      const { project, algorithm, hashRepo } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      const c = await makeAsset(db(), project.id, 'c');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [DIST_1]);
      await hashRepo.replaceAll(c.id, algorithm.id, [DIST_1]);
      const repo = new DrizzleAssetHashDuplicateRepository(db(), new DrizzleClusterRepository(db()));
      // a<->b, a<->c: 2 pairs, 4 directional rows in storage.
      await repo.recomputeHamming(project.id, algorithm.id, a.id, 0);

      await expect(repo.countPairsByProject(project.id)).resolves.toBe(2);
    });

    it('sums pairs across every algorithm in the project', async () => {
      const project = await makeProject(db());
      const algorithmA = await makeAlgorithm(db());
      const algorithmB = await makeAlgorithm(db());
      const hashRepo = new DrizzleAssetHashRepository(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      await hashRepo.replaceAll(a.id, algorithmA.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithmA.id, [DIST_1]);
      await hashRepo.replaceAll(a.id, algorithmB.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithmB.id, [DIST_1]);
      const repo = new DrizzleAssetHashDuplicateRepository(db(), new DrizzleClusterRepository(db()));
      await repo.recomputeHamming(project.id, algorithmA.id, a.id, 0);
      await repo.recomputeHamming(project.id, algorithmB.id, a.id, 0);

      await expect(repo.countPairsByProject(project.id)).resolves.toBe(2);
    });

    it('does not count pairs from other projects', async () => {
      const { project, algorithm, hashRepo } = await setup(db());
      const otherProject = await makeProject(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      const outsideA = await makeAsset(db(), otherProject.id, 'outside-a');
      const outsideB = await makeAsset(db(), otherProject.id, 'outside-b');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [DIST_1]);
      await hashRepo.replaceAll(outsideA.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(outsideB.id, algorithm.id, [DIST_1]);
      const repo = new DrizzleAssetHashDuplicateRepository(db(), new DrizzleClusterRepository(db()));
      await repo.recomputeHamming(project.id, algorithm.id, a.id, 0);
      await repo.recomputeHamming(otherProject.id, algorithm.id, outsideA.id, 0);

      await expect(repo.countPairsByProject(project.id)).resolves.toBe(1);
    });

    it('returns zero for a project with no duplicates', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetHashDuplicateRepository(db(), new DrizzleClusterRepository(db()));

      await expect(repo.countPairsByProject(project.id)).resolves.toBe(0);
    });

    it('returns a real number, not driver bigint-as-string', async () => {
      const { project, algorithm, hashRepo } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [DIST_1]);
      const repo = new DrizzleAssetHashDuplicateRepository(db(), new DrizzleClusterRepository(db()));
      await repo.recomputeHamming(project.id, algorithm.id, a.id, 0);

      expect(typeof (await repo.countPairsByProject(project.id))).toBe('number');
    });
  });
});
