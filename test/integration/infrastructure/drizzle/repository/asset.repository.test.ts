import { describe, it, expect } from 'vitest';
import { DrizzleAssetRepository } from '../../../../../src/infrastructure/drizzle/repository/asset.repository.js';
import { DrizzleAssetHashRepository } from '../../../../../src/infrastructure/drizzle/repository/asset.hash.repository.js';
import { NotFoundError, AlreadyExistsError, ValidationError } from '../../../../../src/domain/errors.js';
import { Identity } from '../../../../../src/domain/model/asset.model.js';
import { useTestDb } from '../../../../helpers/db.js';
import { makeProject, makeAlgorithm } from '../../../../helpers/fixtures.js';

describe('DrizzleAssetRepository', () => {
  const { db } = useTestDb();

  describe('create', () => {
    it('creates a new asset row with id-only', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());

      const created = await repo.create({ projectId: project.id, identityId: 'a1', identityPath: null });

      expect(created.id).toBeDefined();
      expect(created.identity).toEqual(new Identity('a1', null));
    });

    it('creates a new asset row with path-only', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());

      const created = await repo.create({ projectId: project.id, identityId: null, identityPath: 'photos/1.jpg' });

      expect(created.identity).toEqual(new Identity(null, 'photos/1.jpg'));
    });

    it('creates a new asset row with both id and path', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());

      const created = await repo.create({ projectId: project.id, identityId: 'a1', identityPath: 'photos/1.jpg' });

      expect(created.identity).toEqual(new Identity('a1', 'photos/1.jpg'));
    });

    it('null on both fields at creation (nothing to keep) is rejected', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());

      await expect(repo.create({ projectId: project.id, identityId: null, identityPath: null })).rejects.toThrow(
        ValidationError,
      );
    });

    it('"" on both fields at creation is rejected the same as null', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());

      await expect(repo.create({ projectId: project.id, identityId: '', identityPath: '' })).rejects.toThrow(
        ValidationError,
      );
    });

    it('is idempotent when called again with the same id — no path change when path stays null', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());

      const first = await repo.create({ projectId: project.id, identityId: 'a1', identityPath: null });
      const second = await repo.create({ projectId: project.id, identityId: 'a1', identityPath: null });

      expect(second.id).toBe(first.id);
      expect(second.identity).toEqual(new Identity('a1', null));
    });

    it('null on a field keeps the previous value while the other field is replaced', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());
      const created = await repo.create({ projectId: project.id, identityId: 'a1', identityPath: 'photos/1.jpg' });

      const updated = await repo.create({ projectId: project.id, identityId: 'a1', identityPath: 'photos/2.jpg' });

      expect(updated.id).toBe(created.id);
      expect(updated.identity).toEqual(new Identity('a1', 'photos/2.jpg'));
    });

    it('"" clears a previously set field while null on the other keeps it', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());
      const created = await repo.create({ projectId: project.id, identityId: 'a1', identityPath: 'photos/1.jpg' });

      const updated = await repo.create({ projectId: project.id, identityId: 'a1', identityPath: '' });

      expect(updated.id).toBe(created.id);
      expect(updated.identity).toEqual(new Identity('a1', null));
    });

    it('rejects clearing the only field that made the identity valid', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());
      await repo.create({ projectId: project.id, identityId: 'a1', identityPath: null });

      await expect(repo.create({ projectId: project.id, identityId: '', identityPath: null })).rejects.toThrow(
        ValidationError,
      );
    });

    it('matches the previous row by path when only path is given, even if it also has an id', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());
      const created = await repo.create({ projectId: project.id, identityId: 'a1', identityPath: 'photos/1.jpg' });

      // No id given at all — must fall back to matching by path, and must not touch the existing id.
      const updated = await repo.create({ projectId: project.id, identityId: null, identityPath: 'photos/1.jpg' });

      expect(updated.id).toBe(created.id);
      expect(updated.identity).toEqual(new Identity('a1', 'photos/1.jpg'));
    });

    it('does not throw AlreadyExistsError when id and path both resolve to the same existing row', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());
      const created = await repo.create({ projectId: project.id, identityId: 'a1', identityPath: 'photos/1.jpg' });

      // Both `--id` and `--path` are given and both match — but the same row, not two different ones, so
      // this must be treated as a no-op re-affirmation, not a genuine id/path conflict.
      const updated = await repo.create({ projectId: project.id, identityId: 'a1', identityPath: 'photos/1.jpg' });

      expect(updated.id).toBe(created.id);
      expect(updated.identity).toEqual(new Identity('a1', 'photos/1.jpg'));
    });

    it('throws AlreadyExistsError when id matches one row and path matches a different row', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());
      await repo.create({ projectId: project.id, identityId: 'a1', identityPath: null });
      await repo.create({ projectId: project.id, identityId: null, identityPath: 'photos/1.jpg' });

      await expect(
        repo.create({ projectId: project.id, identityId: 'a1', identityPath: 'photos/1.jpg' }),
      ).rejects.toThrow(AlreadyExistsError);
    });

    it('the same identity in two different projects are distinct assets', async () => {
      const projectA = await makeProject(db());
      const projectB = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());

      const a = await repo.create({ projectId: projectA.id, identityId: 'shared-id', identityPath: null });
      const b = await repo.create({ projectId: projectB.id, identityId: 'shared-id', identityPath: null });

      expect(a.id).not.toBe(b.id);
    });
  });

  describe('findByIdentity / getByIdentity', () => {
    it('finds an existing asset by id, and returns null otherwise', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());
      await repo.create({ projectId: project.id, identityId: 'a1', identityPath: null });

      await expect(repo.findByIdentity(project.id, new Identity('a1', null))).resolves.not.toBeNull();
      await expect(repo.findByIdentity(project.id, new Identity('nope', null))).resolves.toBeNull();
    });

    it('finds an existing asset by path', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());
      await repo.create({ projectId: project.id, identityId: null, identityPath: 'photos/1.jpg' });

      await expect(repo.findByIdentity(project.id, new Identity(null, 'photos/1.jpg'))).resolves.not.toBeNull();
    });

    it('looks up by id only when both id and path are given — id takes priority over path', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());
      const created = await repo.create({ projectId: project.id, identityId: 'a1', identityPath: 'photos/1.jpg' });

      // A path that matches nothing, paired with a valid id, still finds the row — path is ignored once id is given.
      const found = await repo.findByIdentity(project.id, new Identity('a1', 'not-the-real-path'));

      expect(found?.id).toBe(created.id);
    });

    it('getByIdentity resolves to the asset when it exists', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());
      const created = await repo.create({ projectId: project.id, identityId: 'a1', identityPath: null });

      const found = await repo.getByIdentity(project.id, new Identity('a1', null));

      expect(found.id).toBe(created.id);
    });

    it('getByIdentity throws NotFoundError when the asset does not exist', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());

      await expect(repo.getByIdentity(project.id, new Identity('nope', null))).rejects.toThrow(NotFoundError);
    });
  });

  describe('deleteByIdentity', () => {
    it('removes the asset by id (idempotent on repeat)', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());
      await repo.create({ projectId: project.id, identityId: 'a1', identityPath: null });

      await repo.deleteByIdentity(project.id, new Identity('a1', null));

      await expect(repo.findByIdentity(project.id, new Identity('a1', null))).resolves.toBeNull();
      await expect(repo.deleteByIdentity(project.id, new Identity('a1', null))).resolves.toBeUndefined();
    });

    it('removes the asset by path', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());
      await repo.create({ projectId: project.id, identityId: null, identityPath: 'photos/1.jpg' });

      await repo.deleteByIdentity(project.id, new Identity(null, 'photos/1.jpg'));

      await expect(repo.findByIdentity(project.id, new Identity(null, 'photos/1.jpg'))).resolves.toBeNull();
    });
  });

  describe('other repository methods (unaffected by the identity split)', () => {
    it('countByProject counts only assets in that project', async () => {
      const projectA = await makeProject(db());
      const projectB = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());
      await repo.create({ projectId: projectA.id, identityId: 'a1', identityPath: null });
      await repo.create({ projectId: projectA.id, identityId: 'a2', identityPath: null });
      await repo.create({ projectId: projectB.id, identityId: 'b1', identityPath: null });

      await expect(repo.countByProject(projectA.id)).resolves.toBe(2);
      await expect(repo.countByProject(projectB.id)).resolves.toBe(1);
    });

    it('countByProject returns a real number, not driver bigint-as-string', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());
      await repo.create({ projectId: project.id, identityId: 'a1', identityPath: null });

      expect(typeof (await repo.countByProject(project.id))).toBe('number');
    });

    it('listRecipes returns the distinct recipes hashed for an asset, looked up by identity', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());
      const asset = await repo.create({ projectId: project.id, identityId: 'a1', identityPath: null });
      const algorithmA = await makeAlgorithm(db(), { recipe: 'binary.sha256' });
      const algorithmB = await makeAlgorithm(db(), { recipe: 'image.phash16' });
      const hashRepo = new DrizzleAssetHashRepository(db());
      await hashRepo.replaceAll(asset.id, algorithmA.id, ['h1']);
      await hashRepo.replaceAll(asset.id, algorithmB.id, ['h2']);

      const recipes = await repo.listRecipes(project.id, new Identity('a1', null));

      expect(recipes.sort()).toEqual(['binary.sha256', 'image.phash16']);
    });

    it('listIdsWithHash returns only assets that have a hash for the given algorithm, cursor-paginated', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());
      const algorithm = await makeAlgorithm(db());
      const other = await makeAlgorithm(db());
      const hashRepo = new DrizzleAssetHashRepository(db());

      const withHash = await repo.create({ projectId: project.id, identityId: 'has-hash', identityPath: null });
      await hashRepo.replaceAll(withHash.id, algorithm.id, ['h1']);
      const withOtherHash = await repo.create({
        projectId: project.id,
        identityId: 'has-other-hash',
        identityPath: null,
      });
      await hashRepo.replaceAll(withOtherHash.id, other.id, ['h2']);
      await repo.create({ projectId: project.id, identityId: 'no-hash', identityPath: null });

      const ids = await repo.listIdsWithHash(project.id, algorithm.id, null, 10);

      expect(ids).toEqual([withHash.id]);
    });

    it('listIdsWithHash scopes to the given project — another project with the same algorithm is excluded', async () => {
      const project = await makeProject(db());
      const otherProject = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());
      const algorithm = await makeAlgorithm(db());
      const hashRepo = new DrizzleAssetHashRepository(db());

      const mine = await repo.create({ projectId: project.id, identityId: 'mine', identityPath: null });
      await hashRepo.replaceAll(mine.id, algorithm.id, ['h1']);
      const theirs = await repo.create({ projectId: otherProject.id, identityId: 'theirs', identityPath: null });
      await hashRepo.replaceAll(theirs.id, algorithm.id, ['h2']);

      const ids = await repo.listIdsWithHash(project.id, algorithm.id, null, 10);

      expect(ids).toEqual([mine.id]);
    });

    it('listIdsWithHash respects the cursor and batch size for pagination', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());
      const algorithm = await makeAlgorithm(db());
      const hashRepo = new DrizzleAssetHashRepository(db());

      const assets = [];

      for (const identityId of ['a1', 'a2', 'a3']) {
        const asset = await repo.create({ projectId: project.id, identityId, identityPath: null });
        await hashRepo.replaceAll(asset.id, algorithm.id, ['h']);
        assets.push(asset);
      }

      const firstPage = await repo.listIdsWithHash(project.id, algorithm.id, null, 2);
      expect(firstPage).toHaveLength(2);

      const secondPage = await repo.listIdsWithHash(
        project.id,
        algorithm.id,
        firstPage[firstPage.length - 1] ?? null,
        2,
      );
      expect(secondPage.length).toBeGreaterThan(0);
      expect(new Set([...firstPage, ...secondPage]).size).toBe(firstPage.length + secondPage.length);
    });

    it('countPerRecipe returns distinct hashed-asset counts per recipe, omitting recipes with no hashes', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());
      const algorithmA = await makeAlgorithm(db(), { recipe: `binary.sha256-${project.id}` });
      const algorithmB = await makeAlgorithm(db(), { recipe: `image.phash16-${project.id}` });
      const hashRepo = new DrizzleAssetHashRepository(db());

      const assetA = await repo.create({ projectId: project.id, identityId: 'a', identityPath: null });
      await hashRepo.replaceAll(assetA.id, algorithmA.id, ['h1']);
      const assetB = await repo.create({ projectId: project.id, identityId: 'b', identityPath: null });
      await hashRepo.replaceAll(assetB.id, algorithmA.id, ['h2']);
      const assetC = await repo.create({ projectId: project.id, identityId: 'c', identityPath: null });
      await hashRepo.replaceAll(assetC.id, algorithmB.id, ['h1', 'h2', 'h3']); // multiple sequence rows, same asset

      const rows = await repo.countPerRecipe(project.id);

      expect(rows).toEqual(
        expect.arrayContaining([
          { recipe: algorithmA.recipe, assetCount: 2 },
          { recipe: algorithmB.recipe, assetCount: 1 }, // distinct assets, not distinct hash rows
        ]),
      );
      expect(rows).toHaveLength(2);
    });

    it('countPerRecipe returns an empty array for a project with no hashed assets', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());

      await expect(repo.countPerRecipe(project.id)).resolves.toEqual([]);
    });

    it('getActivitySummary reports null lastAddedAt and zero counts for a project with no assets', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());

      await expect(repo.getActivitySummary(project.id)).resolves.toEqual({
        lastAddedAt: null,
        addedLast7d: 0,
        addedLast30d: 0,
      });
    });

    it('getActivitySummary reports the latest createdAt and counts newly-added assets within 7d/30d', async () => {
      const project = await makeProject(db());
      const repo = new DrizzleAssetRepository(db());
      const asset = await repo.create({ projectId: project.id, identityId: 'recent', identityPath: null });
      const full = await repo.getByIdentity(project.id, asset.identity);

      const summary = await repo.getActivitySummary(project.id);

      expect(summary.lastAddedAt).toEqual(full.createdAt);
      expect(summary.addedLast7d).toBe(1);
      expect(summary.addedLast30d).toBe(1);
    });
  });
});
