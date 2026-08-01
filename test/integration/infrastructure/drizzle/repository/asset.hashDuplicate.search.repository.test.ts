import { describe, it, expect, vi } from 'vitest';
import { DrizzleAssetHashDuplicateRepository } from '../../../../../src/infrastructure/drizzle/repository/asset.hashDuplicate.repository.js';
import { DrizzleClusterRepository } from '../../../../../src/infrastructure/drizzle/repository/cluster.repository.js';
import {
  DrizzleAssetHashDuplicateSearchRepository,
  createRankingAdapter,
  createMatchesAdapter,
} from '../../../../../src/infrastructure/drizzle/repository/asset.hashDuplicate.search.repository.js';
import { DrizzleAssetHashRepository } from '../../../../../src/infrastructure/drizzle/repository/asset.hash.repository.js';
import { DrizzleAssetRepository } from '../../../../../src/infrastructure/drizzle/repository/asset.repository.js';
import type { DbClient } from '../../../../../src/infrastructure/drizzle/client.js';
import { Identity } from '../../../../../src/domain/model/asset.model.js';
import { useTestDb } from '../../../../helpers/db.js';
import { makeProject, makeAsset, makeAlgorithm } from '../../../../helpers/fixtures.js';

// 64-bit (16 hex char) hashes with known Hamming distances from ZERO.
const ZERO = '0000000000000000';
const DIST_1 = '0000000000000001'; // 1 bit set -> distance 1, similarity 98.4
const DIST_4 = '000000000000000f'; // 4 bits set -> distance 4, similarity 93.8
const DIST_8 = '00000000000000ff'; // 8 bits set -> distance 8, similarity 87.5
const ALL_F = 'ffffffffffffffff'; // 64 bits set -> distance 64 from ZERO, similarity 0
const ALL_F_MINUS_1 = 'fffffffffffffffe'; // 63 bits set -> distance 1 from ALL_F, similarity 98.4

async function setup(db: DbClient): Promise<{
  project: Awaited<ReturnType<typeof makeProject>>;
  algorithm: Awaited<ReturnType<typeof makeAlgorithm>>;
  hashRepo: DrizzleAssetHashRepository;
  duplicates: DrizzleAssetHashDuplicateRepository;
  search: DrizzleAssetHashDuplicateSearchRepository;
}> {
  const project = await makeProject(db);
  const algorithm = await makeAlgorithm(db);
  const duplicates = new DrizzleAssetHashDuplicateRepository(db, new DrizzleClusterRepository(db));

  return {
    project,
    algorithm,
    hashRepo: new DrizzleAssetHashRepository(db),
    duplicates,
    search: new DrizzleAssetHashDuplicateSearchRepository(db, duplicates),
  };
}

describe('DrizzleAssetHashDuplicateSearchRepository', () => {
  const { db } = useTestDb();

  describe('paginate', () => {
    it('counts and ranks assets by duplicate count, descending, tie-broken by identity', async () => {
      const { project, algorithm, hashRepo, duplicates, search } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      const c = await makeAsset(db(), project.id, 'c');
      // a<->b, a<->c: a has 2 duplicates, b and c have 1 each.
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [DIST_1]);
      await hashRepo.replaceAll(c.id, algorithm.id, [DIST_1]);
      await duplicates.recomputeHamming(project.id, algorithm.id, a.id, 0);

      const result = await search.paginateRanking(
        { projectId: project.id, algorithmId: algorithm.id, minSimilarity: 0 },
        1,
        10,
      );

      expect(result.getTotalCount()).toBe(3);
      expect(result.getData()[0]?.identity.id).toBe('a');
      expect(result.getData()[0]?.duplicateCount).toBe(2);
      expect(
        result
          .getData()
          .slice(1)
          .map((r) => r.identity.id),
      ).toEqual(['b', 'c']);
    });

    it('returns totalCount and duplicateCount as real numbers, not driver bigint-as-string', async () => {
      const { project, algorithm, hashRepo, duplicates, search } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [DIST_1]);
      await duplicates.recomputeHamming(project.id, algorithm.id, a.id, 0);

      const result = await search.paginateRanking(
        { projectId: project.id, algorithmId: algorithm.id, minSimilarity: 0 },
        1,
        10,
      );

      expect(typeof result.getTotalCount()).toBe('number');
      expect(typeof result.getData()[0]?.duplicateCount).toBe('number');
    });

    it('fills in matches per asset via one batched findByAssets call, sorted by descending similarity', async () => {
      const { project, algorithm, hashRepo, duplicates, search } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [DIST_1]);
      await duplicates.recomputeHamming(project.id, algorithm.id, a.id, 0);

      const result = await search.paginateRanking(
        { projectId: project.id, algorithmId: algorithm.id, minSimilarity: 0 },
        1,
        10,
      );

      const a1 = result.getData().find((row) => row.identity.id === 'a');
      expect(a1?.matches).toEqual([{ identity: new Identity('b', null), distance: 1, similarity: 98.4 }]);
    });

    it("sorts an asset's matches by descending similarity when it has more than one", async () => {
      const { project, algorithm, hashRepo, duplicates, search } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      const c = await makeAsset(db(), project.id, 'c');
      const d = await makeAsset(db(), project.id, 'd');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [DIST_8]); // weakest match, similarity ~87.5
      await hashRepo.replaceAll(c.id, algorithm.id, [DIST_1]); // strongest match, similarity ~98.4
      await hashRepo.replaceAll(d.id, algorithm.id, [DIST_4]); // middle match, similarity ~93.8
      await duplicates.recomputeHamming(project.id, algorithm.id, a.id, 0);

      const result = await search.paginateRanking(
        { projectId: project.id, algorithmId: algorithm.id, minSimilarity: 0 },
        1,
        10,
      );

      const a1 = result.getData().find((row) => row.identity.id === 'a');
      const similarities = a1?.matches.map((m) => m.similarity) ?? [];
      // Checked as a monotonic (non-increasing) sequence rather than a hardcoded order, so this doesn't
      // depend on whatever incidental row order Postgres happens to return before the sort runs — a
      // same-direction (ascending or coincidentally-matching) result from a broken comparator would fail
      // this for at least one adjacent pair among 3 distinct values.
      for (let i = 0; i < similarities.length - 1; i += 1) {
        expect(similarities[i]).toBeGreaterThanOrEqual(similarities[i + 1] ?? 0);
      }
      expect(a1?.matches.map((m) => m.identity.id)).toEqual(['c', 'd', 'b']);
    });

    it('caps matches per asset at matchLimit', async () => {
      const { project, algorithm, hashRepo, duplicates, search } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      const c = await makeAsset(db(), project.id, 'c');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [DIST_1]);
      await hashRepo.replaceAll(c.id, algorithm.id, [DIST_1]);
      await duplicates.recomputeHamming(project.id, algorithm.id, a.id, 0);

      const result = await search.paginateRanking(
        { projectId: project.id, algorithmId: algorithm.id, minSimilarity: 0, matchLimit: 1 },
        1,
        10,
      );

      const a1 = result.getData().find((row) => row.identity.id === 'a');
      expect(a1?.matches).toHaveLength(1);
    });

    it('paginates via Page, exposing hasNextPage()/hasPreviousPage()', async () => {
      const { project, algorithm, hashRepo, duplicates, search } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [DIST_1]);
      await duplicates.recomputeHamming(project.id, algorithm.id, a.id, 0);
      const query = { projectId: project.id, algorithmId: algorithm.id, minSimilarity: 0 };

      const page1 = await search.paginateRanking(query, 1, 1);
      const page2 = await search.paginateRanking(query, 2, 1);

      expect(page1.getData()).toHaveLength(1);
      expect(page1.hasNextPage()).toBe(true);
      expect(page1.hasPreviousPage()).toBe(false);
      expect(page2.getData()).toHaveLength(1);
      expect(page2.hasNextPage()).toBe(false);
      expect(page2.hasPreviousPage()).toBe(true);
      expect(page1.getData()[0]?.identity.id).not.toBe(page2.getData()[0]?.identity.id);
    });

    it('returns the canonical empty result when nothing matches, without calling findByAssets', async () => {
      const { project, algorithm, search, duplicates } = await setup(db());
      const findByAssetsSpy = vi.spyOn(duplicates, 'findByAssets');

      const result = await search.paginateRanking(
        { projectId: project.id, algorithmId: algorithm.id, minSimilarity: 0 },
        1,
        10,
      );

      expect(result.getData()).toEqual([]);
      expect(result.getTotalCount()).toBe(0);
      expect(findByAssetsSpy).not.toHaveBeenCalled();
    });

    it('filters by minSimilarity', async () => {
      const { project, algorithm, hashRepo, duplicates, search } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [DIST_1]);
      await duplicates.recomputeHamming(project.id, algorithm.id, a.id, 0);

      const strict = await search.paginateRanking(
        { projectId: project.id, algorithmId: algorithm.id, minSimilarity: 99 },
        1,
        10,
      );
      const lenient = await search.paginateRanking(
        { projectId: project.id, algorithmId: algorithm.id, minSimilarity: 90 },
        1,
        10,
      );

      expect(strict.getTotalCount()).toBe(0);
      expect(lenient.getTotalCount()).toBe(2);
    });

    it('attaches matches correctly when the ranked asset is identified by path rather than id', async () => {
      const { project, algorithm, hashRepo, duplicates, search } = await setup(db());
      // `a` has no --id, only a path — exercises the identityKey() `id ?? ''` fallback branch,
      // since every other fixture in this file uses an id-based identity.
      const a = await new DrizzleAssetRepository(db()).create({
        projectId: project.id,
        identityId: null,
        identityPath: '/library/a.jpg',
      });
      const b = await makeAsset(db(), project.id, 'b');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [DIST_1]);
      await duplicates.recomputeHamming(project.id, algorithm.id, a.id, 0);

      const result = await search.paginateRanking(
        { projectId: project.id, algorithmId: algorithm.id, minSimilarity: 0 },
        1,
        10,
      );

      const forA = result.getData().find((row) => row.identity.path === '/library/a.jpg');
      expect(forA?.identity.id).toBeNull();
      expect(forA?.matches).toEqual([{ identity: new Identity('b', null), distance: 1, similarity: 98.4 }]);
    });

    it('keeps matches separate for two different path-only assets, not just id-based ones', async () => {
      const { project, algorithm, hashRepo, duplicates, search } = await setup(db());
      const assetRepo = new DrizzleAssetRepository(db());
      // Two path-only assets — exercises the identityKey() `path ?? ''` fallback branch across two
      // *different* real paths. A bad fallback that discards the real path value (rather than defaulting
      // only when path is null) would collapse both onto the same map key and merge their matches.
      const a = await assetRepo.create({ projectId: project.id, identityId: null, identityPath: '/library/a.jpg' });
      const a2 = await assetRepo.create({
        projectId: project.id,
        identityId: null,
        identityPath: '/library/a2.jpg',
      });
      const x = await makeAsset(db(), project.id, 'x');
      const y = await makeAsset(db(), project.id, 'y');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(x.id, algorithm.id, [DIST_1]);
      await hashRepo.replaceAll(a2.id, algorithm.id, [ALL_F]);
      await hashRepo.replaceAll(y.id, algorithm.id, [ALL_F_MINUS_1]);
      // minSimilarity 50 at recompute time keeps only the intended a-x and a2-y pairs (each ~98.4%
      // similar) — every cross pair (a-a2, a-y, x-a2, x-y) is well under 5% similar and gets dropped.
      await duplicates.recomputeHamming(project.id, algorithm.id, a.id, 50);
      await duplicates.recomputeHamming(project.id, algorithm.id, a2.id, 50);

      const result = await search.paginateRanking(
        { projectId: project.id, algorithmId: algorithm.id, minSimilarity: 0 },
        1,
        10,
      );

      const forA = result.getData().find((row) => row.identity.path === '/library/a.jpg');
      const forA2 = result.getData().find((row) => row.identity.path === '/library/a2.jpg');
      expect(forA?.matches).toEqual([{ identity: new Identity('x', null), distance: 1, similarity: 98.4 }]);
      expect(forA2?.matches).toEqual([{ identity: new Identity('y', null), distance: 1, similarity: 98.4 }]);
    });

    it('filters by exact identity id when `id` is given', async () => {
      const { project, algorithm, hashRepo, duplicates, search } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [DIST_1]);
      await duplicates.recomputeHamming(project.id, algorithm.id, a.id, 0);

      const result = await search.paginateRanking(
        { projectId: project.id, algorithmId: algorithm.id, minSimilarity: 0, id: 'a' },
        1,
        10,
      );

      expect(result.getTotalCount()).toBe(1);
      expect(result.getData()[0]?.identity.id).toBe('a');
    });

    it('filters by identity path via `*term*` search-query syntax when `path` is given', async () => {
      const { project, algorithm, hashRepo, duplicates, search } = await setup(db());
      const assetRepo = new DrizzleAssetRepository(db());
      const invoice = await assetRepo.create({
        projectId: project.id,
        identityId: null,
        identityPath: '/library/invoice-2024.pdf',
      });
      const photo = await assetRepo.create({
        projectId: project.id,
        identityId: null,
        identityPath: '/library/photo.jpg',
      });
      await hashRepo.replaceAll(invoice.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(photo.id, algorithm.id, [DIST_1]);
      await duplicates.recomputeHamming(project.id, algorithm.id, invoice.id, 0);

      const result = await search.paginateRanking(
        { projectId: project.id, algorithmId: algorithm.id, minSimilarity: 0, path: '*invoice*' },
        1,
        10,
      );

      expect(result.getTotalCount()).toBe(1);
      expect(result.getData()[0]?.identity.path).toBe('/library/invoice-2024.pdf');
    });
  });

  // `paginate()` only ever drives the adapter through `count()`/`pageView()` (page.size is
  // never null here), so `head()`/`all()` — required by the `HeadableAdapter`/`AllAdapter`
  // contracts, used by other callers such as admin tooling — are exercised directly against
  // the adapter. The adapter only ranks/counts (no matches) — matches are assembled one level up.
  describe('createRankingAdapter', () => {
    it('all() returns every ranked asset (no matches — adapter only ranks/counts)', async () => {
      const { project, algorithm, hashRepo, duplicates } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      const c = await makeAsset(db(), project.id, 'c');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [DIST_1]);
      await hashRepo.replaceAll(c.id, algorithm.id, [DIST_1]);
      await duplicates.recomputeHamming(project.id, algorithm.id, a.id, 0);
      const adapter = createRankingAdapter(db(), {
        projectId: project.id,
        algorithmId: algorithm.id,
        minSimilarity: 0,
      });

      const rows = await adapter.all();

      expect(rows).toHaveLength(3);
      expect(rows[0]).toEqual({ identityId: 'a', identityPath: null, duplicateCount: 2 });
    });

    it('head(size) applies the limit', async () => {
      const { project, algorithm, hashRepo, duplicates } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [DIST_1]);
      await duplicates.recomputeHamming(project.id, algorithm.id, a.id, 0);
      const adapter = createRankingAdapter(db(), {
        projectId: project.id,
        algorithmId: algorithm.id,
        minSimilarity: 0,
      });

      await expect(adapter.head(1)).resolves.toHaveLength(1);
    });

    it('all() returns an empty array when nothing matches', async () => {
      const { project, algorithm } = await setup(db());
      const adapter = createRankingAdapter(db(), {
        projectId: project.id,
        algorithmId: algorithm.id,
        minSimilarity: 0,
      });

      await expect(adapter.all()).resolves.toEqual([]);
    });
  });

  describe('paginateMatches', () => {
    it("returns one asset's matches, sorted by descending similarity", async () => {
      const { project, algorithm, hashRepo, duplicates, search } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      const c = await makeAsset(db(), project.id, 'c');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(c.id, algorithm.id, [DIST_1]);
      await duplicates.recomputeExact(project.id, algorithm.id, a.id);
      await duplicates.recomputeHamming(project.id, algorithm.id, a.id, 0);

      const result = await search.paginateMatches(
        { projectId: project.id, algorithmId: algorithm.id, identity: new Identity('a', null), minSimilarity: 0 },
        1,
        10,
      );

      expect(result.getTotalCount()).toBe(2);
      expect(result.getData().map((m) => m.identity.id)).toEqual(['b', 'c']); // b: 100% exact, c: 98.4% hamming
    });

    it('scopes to the requested asset only', async () => {
      const { project, algorithm, hashRepo, duplicates, search } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      const c = await makeAsset(db(), project.id, 'c');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [DIST_1]);
      await hashRepo.replaceAll(c.id, algorithm.id, [DIST_1]);
      await duplicates.recomputeHamming(project.id, algorithm.id, a.id, 0);

      const forA = await search.paginateMatches(
        { projectId: project.id, algorithmId: algorithm.id, identity: new Identity('a', null), minSimilarity: 0 },
        1,
        10,
      );
      const forB = await search.paginateMatches(
        { projectId: project.id, algorithmId: algorithm.id, identity: new Identity('b', null), minSimilarity: 0 },
        1,
        10,
      );

      expect(forA.getTotalCount()).toBe(2); // a<->b, a<->c
      expect(forB.getTotalCount()).toBe(1); // b<->a only (b<->c was never computed)
    });

    it('paginates via Page', async () => {
      const { project, algorithm, hashRepo, duplicates, search } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      const c = await makeAsset(db(), project.id, 'c');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(c.id, algorithm.id, [ZERO]);
      await duplicates.recomputeExact(project.id, algorithm.id, a.id);
      const query = {
        projectId: project.id,
        algorithmId: algorithm.id,
        identity: new Identity('a', null),
        minSimilarity: 0,
      };

      const page1 = await search.paginateMatches(query, 1, 1);

      expect(page1.getData()).toHaveLength(1);
      expect(page1.getTotalCount()).toBe(2);
      expect(page1.hasNextPage()).toBe(true);
      expect(page1.hasPreviousPage()).toBe(false);
    });

    it('returns the canonical empty result when the asset has no matches', async () => {
      const { project, algorithm, search } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');

      const result = await search.paginateMatches(
        {
          projectId: project.id,
          algorithmId: algorithm.id,
          identity: new Identity(a.identityId, a.identityPath),
          minSimilarity: 0,
        },
        1,
        10,
      );

      expect(result.getData()).toEqual([]);
      expect(result.getTotalCount()).toBe(0);
    });

    it('filters by minSimilarity', async () => {
      const { project, algorithm, hashRepo, duplicates, search } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [DIST_1]);
      await duplicates.recomputeHamming(project.id, algorithm.id, a.id, 0);
      const base = { projectId: project.id, algorithmId: algorithm.id, identity: new Identity('a', null) };

      const strict = await search.paginateMatches({ ...base, minSimilarity: 99 }, 1, 10);
      const lenient = await search.paginateMatches({ ...base, minSimilarity: 90 }, 1, 10);

      expect(strict.getTotalCount()).toBe(0);
      expect(lenient.getTotalCount()).toBe(1);
    });
  });

  // Same rationale as `createRankingAdapter` above — `head()`/`all()` aren't reached by
  // `paginateMatches()` (page.size is never null here), so they're tested directly.
  describe('createMatchesAdapter', () => {
    it('all() returns every match', async () => {
      const { project, algorithm, hashRepo, duplicates } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      const c = await makeAsset(db(), project.id, 'c');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [DIST_1]);
      await hashRepo.replaceAll(c.id, algorithm.id, [DIST_1]);
      await duplicates.recomputeHamming(project.id, algorithm.id, a.id, 0);
      const adapter = createMatchesAdapter(db(), {
        projectId: project.id,
        algorithmId: algorithm.id,
        identity: new Identity('a', null),
        minSimilarity: 0,
      });

      await expect(adapter.all()).resolves.toHaveLength(2);
    });

    it('head(size) applies the limit', async () => {
      const { project, algorithm, hashRepo, duplicates } = await setup(db());
      const a = await makeAsset(db(), project.id, 'a');
      const b = await makeAsset(db(), project.id, 'b');
      const c = await makeAsset(db(), project.id, 'c');
      await hashRepo.replaceAll(a.id, algorithm.id, [ZERO]);
      await hashRepo.replaceAll(b.id, algorithm.id, [DIST_1]);
      await hashRepo.replaceAll(c.id, algorithm.id, [DIST_1]);
      await duplicates.recomputeHamming(project.id, algorithm.id, a.id, 0);
      const adapter = createMatchesAdapter(db(), {
        projectId: project.id,
        algorithmId: algorithm.id,
        identity: new Identity('a', null),
        minSimilarity: 0,
      });

      await expect(adapter.head(1)).resolves.toHaveLength(1);
    });

    it('all() returns an empty array when nothing matches', async () => {
      const { project, algorithm } = await setup(db());
      const adapter = createMatchesAdapter(db(), {
        projectId: project.id,
        algorithmId: algorithm.id,
        identity: new Identity('a', null),
        minSimilarity: 0,
      });

      await expect(adapter.all()).resolves.toEqual([]);
    });
  });
});
