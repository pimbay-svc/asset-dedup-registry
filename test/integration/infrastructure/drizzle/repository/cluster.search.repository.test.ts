import { describe, it, expect } from 'vitest';
import { DrizzleClusterRepository } from '../../../../../src/infrastructure/drizzle/repository/cluster.repository.js';
import { DrizzleClusterSearchRepository } from '../../../../../src/infrastructure/drizzle/repository/cluster.search.repository.js';
import { DrizzleAssetHashDuplicateRepository } from '../../../../../src/infrastructure/drizzle/repository/asset.hashDuplicate.repository.js';
import { DrizzleAssetHashRepository } from '../../../../../src/infrastructure/drizzle/repository/asset.hash.repository.js';
import { DrizzleAssetRepository } from '../../../../../src/infrastructure/drizzle/repository/asset.repository.js';
import type { DbClient } from '../../../../../src/infrastructure/drizzle/client.js';
import type { Clusters } from '../../../../../src/domain/repo/cluster.repo.js';
import { useTestDb } from '../../../../helpers/db.js';
import { makeProject, makeAsset, makeAlgorithm } from '../../../../helpers/fixtures.js';
import { ValidationError } from '../../../../../src/domain/errors.js';
import type { Asset } from '../../../../../src/domain/model/model.js';
import { Identity } from '../../../../../src/domain/model/asset.model.js';

// 64-bit (16 hex char) hashes with known Hamming distances from ZERO.
const ZERO = '0000000000000000';
const DIST_1 = '0000000000000001'; // 1 bit set -> distance 1, similarity 98.4
const DIST_8 = '00000000000000ff'; // 8 bits set -> distance 8, similarity 87.5

async function setup(db: DbClient): Promise<{
  projectId: string;
  algorithmId: number;
  hashes: DrizzleAssetHashRepository;
  duplicates: DrizzleAssetHashDuplicateRepository;
  search: DrizzleClusterSearchRepository;
}> {
  const project = await makeProject(db);
  const algorithm = await makeAlgorithm(db);
  const clusters = new DrizzleClusterRepository(db);
  const duplicates = new DrizzleAssetHashDuplicateRepository(db, clusters);

  return {
    projectId: project.id,
    algorithmId: algorithm.id,
    hashes: new DrizzleAssetHashRepository(db),
    duplicates,
    search: new DrizzleClusterSearchRepository(db, clusters),
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

describe('DrizzleClusterSearchRepository', () => {
  const { db } = useTestDb();

  describe('paginate', () => {
    it('returns an empty page when there are no qualifying edges', async () => {
      const { search, projectId, algorithmId } = await setup(db());

      const result = await search.paginate({ projectId, algorithmId, minSimilarity: 90 }, 1, 10);

      expect(result.page.getTotalCount()).toBe(0);
      expect(result.page.getData()).toEqual([]);
      expect(result.generation).toBeGreaterThanOrEqual(0);
    });

    it('returns one cluster with both members and their avg similarity', async () => {
      const { search, duplicates, hashes, projectId, algorithmId } = await setup(db());
      const a = await makeAsset(db(), projectId, 'a');
      const b = await makeAsset(db(), projectId, 'b');
      await connect(hashes, duplicates, projectId, algorithmId, a, b, 'shared');

      const result = await search.paginate({ projectId, algorithmId, minSimilarity: 90 }, 1, 10);

      expect(result.page.getTotalCount()).toBe(1);
      const cluster = result.page.getData()[0];
      expect(cluster?.maxSimilarity).toBe(100);
      expect(cluster?.assets).toEqual(
        expect.arrayContaining([
          { identity: new Identity('a', null), avgSimilarityToCluster: 100 },
          { identity: new Identity('b', null), avgSimilarityToCluster: 100 },
        ]),
      );
      expect(cluster?.assets).toHaveLength(2);
    });

    it('groups a multi-hop chain (A-B-C, no direct A-C edge) into one cluster of 3', async () => {
      const { search, duplicates, hashes, projectId, algorithmId } = await setup(db());
      const a = await makeAsset(db(), projectId, 'a');
      const b = await makeAsset(db(), projectId, 'b');
      const c = await makeAsset(db(), projectId, 'c');
      await connect(hashes, duplicates, projectId, algorithmId, a, b, 'shared-ab');
      await connect(hashes, duplicates, projectId, algorithmId, b, c, 'shared-bc');

      const result = await search.paginate({ projectId, algorithmId, minSimilarity: 90 }, 1, 10);

      expect(result.page.getTotalCount()).toBe(1);
      expect(result.page.getData()[0]?.assets).toHaveLength(3);
    });

    it('keeps two disconnected components as two separate clusters and paginates them', async () => {
      const { search, duplicates, hashes, projectId, algorithmId } = await setup(db());
      const a = await makeAsset(db(), projectId, 'a');
      const b = await makeAsset(db(), projectId, 'b');
      const c = await makeAsset(db(), projectId, 'c');
      const d = await makeAsset(db(), projectId, 'd');
      await connect(hashes, duplicates, projectId, algorithmId, a, b, 'shared-ab');
      await connect(hashes, duplicates, projectId, algorithmId, c, d, 'shared-cd');

      const fullResult = await search.paginate({ projectId, algorithmId, minSimilarity: 90 }, 1, 10);
      expect(fullResult.page.getTotalCount()).toBe(2);
      expect(fullResult.page.getData()).toHaveLength(2);

      const firstPage = await search.paginate({ projectId, algorithmId, minSimilarity: 90 }, 1, 1);
      expect(firstPage.page.getData()).toHaveLength(1);
      expect(firstPage.page.hasNextPage()).toBe(true);
    });

    it('computes per-cluster maxSimilarity from the strongest qualifying edge in it', async () => {
      const { search, duplicates, hashes, projectId, algorithmId } = await setup(db());
      const a = await makeAsset(db(), projectId, 'a');
      const b = await makeAsset(db(), projectId, 'b');
      const c = await makeAsset(db(), projectId, 'c');
      // a<->b at distance 1 (similarity 98.4), a<->c at distance 8 (similarity 87.5) — both qualify above 80.
      await hashes.replaceAll(a.id, algorithmId, [ZERO]);
      await hashes.replaceAll(b.id, algorithmId, [DIST_1]);
      await hashes.replaceAll(c.id, algorithmId, [DIST_8]);
      await duplicates.recomputeHamming(projectId, algorithmId, a.id, 80);

      const result = await search.paginate({ projectId, algorithmId, minSimilarity: 80 }, 1, 10);

      expect(result.page.getTotalCount()).toBe(1);
      expect(result.page.getData()[0]?.maxSimilarity).toBeCloseTo(98.4, 1);
    });

    it('filters to clusters containing a member with this exact id, without narrowing maxSimilarity or membership to just that member', async () => {
      const { search, duplicates, hashes, projectId, algorithmId } = await setup(db());
      const a = await makeAsset(db(), projectId, 'a');
      const b = await makeAsset(db(), projectId, 'b');
      const c = await makeAsset(db(), projectId, 'c');
      // a<->b at 98.4% (the cluster's true max), a<->c at 87.5% — c's *own* edges are all <= 87.5%, so a
      // filter that wrongly narrows the aggregate to just `c`'s edges would report ~87.5 here instead.
      await hashes.replaceAll(a.id, algorithmId, [ZERO]);
      await hashes.replaceAll(b.id, algorithmId, [DIST_1]);
      await hashes.replaceAll(c.id, algorithmId, [DIST_8]);
      await duplicates.recomputeHamming(projectId, algorithmId, a.id, 80);

      const result = await search.paginate({ projectId, algorithmId, minSimilarity: 80, id: 'c' }, 1, 10);

      expect(result.page.getTotalCount()).toBe(1);
      const cluster = result.page.getData()[0];
      expect(cluster?.maxSimilarity).toBeCloseTo(98.4, 1);
      expect(cluster?.assets.map((asset) => asset.identity.id).sort()).toEqual(['a', 'b', 'c']);
    });

    it('filters to clusters containing a member whose path matches `*term*`', async () => {
      const { search, duplicates, hashes, projectId, algorithmId } = await setup(db());
      const assetRepo = new DrizzleAssetRepository(db());
      const invoice = await assetRepo.create({
        projectId,
        identityId: null,
        identityPath: '/library/invoice-2024.pdf',
      });
      const other = await assetRepo.create({ projectId, identityId: null, identityPath: '/library/other.pdf' });
      const unrelated = await makeAsset(db(), projectId, 'unrelated');
      await hashes.replaceAll(invoice.id, algorithmId, [ZERO]);
      await hashes.replaceAll(other.id, algorithmId, [DIST_1]);
      await hashes.replaceAll(unrelated.id, algorithmId, [DIST_8]);
      await duplicates.recomputeHamming(projectId, algorithmId, invoice.id, 95);
      await duplicates.recomputeHamming(projectId, algorithmId, unrelated.id, 95);

      const result = await search.paginate({ projectId, algorithmId, minSimilarity: 80, path: '*invoice*' }, 1, 10);

      expect(result.page.getTotalCount()).toBe(1);
      expect(
        result.page
          .getData()[0]
          ?.assets.map((asset) => asset.identity.path)
          .sort(),
      ).toEqual(['/library/invoice-2024.pdf', '/library/other.pdf']);
    });

    it('returns an empty page when the id/path filter matches nothing', async () => {
      const { search, duplicates, hashes, projectId, algorithmId } = await setup(db());
      const a = await makeAsset(db(), projectId, 'a');
      const b = await makeAsset(db(), projectId, 'b');
      await connect(hashes, duplicates, projectId, algorithmId, a, b, 'shared');

      const result = await search.paginate({ projectId, algorithmId, minSimilarity: 90, id: 'nope' }, 1, 10);

      expect(result.page.getTotalCount()).toBe(0);
      expect(result.page.getData()).toEqual([]);
    });

    it('pins to an earlier generation via query.generation, ignoring later writes', async () => {
      const { search, duplicates, hashes, projectId, algorithmId } = await setup(db());
      const a = await makeAsset(db(), projectId, 'a');
      const b = await makeAsset(db(), projectId, 'b');
      const c = await makeAsset(db(), projectId, 'c');
      await connect(hashes, duplicates, projectId, algorithmId, a, b, 'shared-ab');

      const first = await search.paginate({ projectId, algorithmId, minSimilarity: 90 }, 1, 10);
      expect(first.page.getTotalCount()).toBe(1);

      await connect(hashes, duplicates, projectId, algorithmId, b, c, 'shared-bc');

      const pinned = await search.paginate(
        { projectId, algorithmId, minSimilarity: 90, generation: first.generation },
        1,
        10,
      );
      expect(pinned.page.getData()[0]?.assets).toHaveLength(2);

      const current = await search.paginate({ projectId, algorithmId, minSimilarity: 90 }, 1, 10);
      expect(current.page.getData()[0]?.assets).toHaveLength(3);
    });

    it('throws ValidationError.tooManyDuplicateEdges when the edge count exceeds the safety cap', async () => {
      const fakeClusters = {
        countEdges: () => Promise.resolve(200_001),
        computeStats: () => Promise.reject(new Error('should not be called')),
        ensureFresh: () => Promise.reject(new Error('should not be called')),
      } as unknown as Clusters;
      const search = new DrizzleClusterSearchRepository({} as DbClient, fakeClusters);

      await expect(search.paginate({ projectId: 'p1', algorithmId: 1, minSimilarity: 90 }, 1, 10)).rejects.toThrow(
        ValidationError,
      );
    });
  });
});
