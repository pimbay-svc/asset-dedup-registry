import { describe, it, expect } from 'vitest';
import { DrizzleAssetHashRepository } from '../../../../../src/infrastructure/drizzle/repository/asset.hash.repository.js';
import { useTestDb } from '../../../../helpers/db.js';
import { makeProject, makeAsset, makeAlgorithm } from '../../../../helpers/fixtures.js';

describe('DrizzleAssetHashRepository', () => {
  const { db } = useTestDb();

  it('replaceAll inserts hashes for an asset+algorithm, sequence-indexed', async () => {
    const project = await makeProject(db());
    const asset = await makeAsset(db(), project.id);
    const algorithm = await makeAlgorithm(db());
    const repo = new DrizzleAssetHashRepository(db());

    await repo.replaceAll(asset.id, algorithm.id, ['hash-0', 'hash-1']);

    const first = await repo.findOne(asset.id, algorithm.id, 0);
    const second = await repo.findOne(asset.id, algorithm.id, 1);

    expect(first?.hash).toBe('hash-0');
    expect(second?.hash).toBe('hash-1');
  });

  it('findOne returns null when nothing matches', async () => {
    const project = await makeProject(db());
    const asset = await makeAsset(db(), project.id);
    const algorithm = await makeAlgorithm(db());
    const repo = new DrizzleAssetHashRepository(db());

    await expect(repo.findOne(asset.id, algorithm.id, 0)).resolves.toBeNull();
  });

  it('replaceAll on the same (asset, algorithm) fully replaces the previous hashes', async () => {
    const project = await makeProject(db());
    const asset = await makeAsset(db(), project.id);
    const algorithm = await makeAlgorithm(db());
    const repo = new DrizzleAssetHashRepository(db());

    await repo.replaceAll(asset.id, algorithm.id, ['old-0', 'old-1', 'old-2']);
    await repo.replaceAll(asset.id, algorithm.id, ['new-0']);

    const all = await repo.findByAssetId(asset.id);
    expect(all).toHaveLength(1);
    expect(all[0]?.hash).toBe('new-0');
  });

  it('replaceAll with an empty array clears existing hashes', async () => {
    const project = await makeProject(db());
    const asset = await makeAsset(db(), project.id);
    const algorithm = await makeAlgorithm(db());
    const repo = new DrizzleAssetHashRepository(db());

    await repo.replaceAll(asset.id, algorithm.id, ['hash-0']);
    await repo.replaceAll(asset.id, algorithm.id, []);

    await expect(repo.findByAssetId(asset.id)).resolves.toEqual([]);
  });

  it('findByAssetId returns hashes across multiple algorithms for the asset', async () => {
    const project = await makeProject(db());
    const asset = await makeAsset(db(), project.id);
    const algorithmA = await makeAlgorithm(db());
    const algorithmB = await makeAlgorithm(db());
    const repo = new DrizzleAssetHashRepository(db());

    await repo.replaceAll(asset.id, algorithmA.id, ['hash-a']);
    await repo.replaceAll(asset.id, algorithmB.id, ['hash-b']);

    const all = await repo.findByAssetId(asset.id);
    expect(all.map((h) => h.hash).sort()).toEqual(['hash-a', 'hash-b']);
  });

  it('does not affect hashes belonging to a different asset', async () => {
    const project = await makeProject(db());
    const assetA = await makeAsset(db(), project.id, 'asset-a');
    const assetB = await makeAsset(db(), project.id, 'asset-b');
    const algorithm = await makeAlgorithm(db());
    const repo = new DrizzleAssetHashRepository(db());

    await repo.replaceAll(assetA.id, algorithm.id, ['hash-a']);
    await repo.replaceAll(assetB.id, algorithm.id, ['hash-b']);
    await repo.replaceAll(assetA.id, algorithm.id, []);

    await expect(repo.findByAssetId(assetA.id)).resolves.toEqual([]);
    await expect(repo.findByAssetId(assetB.id)).resolves.toHaveLength(1);
  });

  describe('countExactDuplicateStats', () => {
    it('returns zeroed stats when no hash is shared by more than one asset', async () => {
      const project = await makeProject(db());
      const algorithm = await makeAlgorithm(db());
      const repo = new DrizzleAssetHashRepository(db());
      const asset = await makeAsset(db(), project.id);
      await repo.replaceAll(asset.id, algorithm.id, ['unique-hash']);

      await expect(repo.countExactDuplicateStats(project.id, algorithm.id)).resolves.toEqual({
        clusterCount: 0,
        edgeCount: 0,
        assetsWithDuplicateCount: 0,
      });
    });

    it('groups assets sharing an identical hash into one group, edges = complete-graph pairs', async () => {
      const project = await makeProject(db());
      const algorithm = await makeAlgorithm(db());
      const repo = new DrizzleAssetHashRepository(db());

      // 3 assets share one hash (a 3-clique: 3 edges), 2 assets share another (1 edge).
      for (const identity of ['a', 'b', 'c']) {
        const asset = await makeAsset(db(), project.id, identity);
        await repo.replaceAll(asset.id, algorithm.id, ['shared-1']);
      }
      for (const identity of ['d', 'e']) {
        const asset = await makeAsset(db(), project.id, identity);
        await repo.replaceAll(asset.id, algorithm.id, ['shared-2']);
      }
      const lone = await makeAsset(db(), project.id, 'f');
      await repo.replaceAll(lone.id, algorithm.id, ['unique-hash']);

      const stats = await repo.countExactDuplicateStats(project.id, algorithm.id);

      expect(stats).toEqual({ clusterCount: 2, edgeCount: 4, assetsWithDuplicateCount: 5 });
    });

    it('scopes by project and algorithm — a shared hash in another project/algorithm does not count', async () => {
      const project = await makeProject(db());
      const otherProject = await makeProject(db());
      const algorithm = await makeAlgorithm(db());
      const otherAlgorithm = await makeAlgorithm(db());
      const repo = new DrizzleAssetHashRepository(db());

      const asset = await makeAsset(db(), project.id, 'a');
      await repo.replaceAll(asset.id, algorithm.id, ['shared']);
      const otherProjectAsset = await makeAsset(db(), otherProject.id, 'b');
      await repo.replaceAll(otherProjectAsset.id, algorithm.id, ['shared']);
      const otherAlgorithmAsset = await makeAsset(db(), project.id, 'c');
      await repo.replaceAll(otherAlgorithmAsset.id, otherAlgorithm.id, ['shared']);

      await expect(repo.countExactDuplicateStats(project.id, algorithm.id)).resolves.toEqual({
        clusterCount: 0,
        edgeCount: 0,
        assetsWithDuplicateCount: 0,
      });
    });
  });
});
