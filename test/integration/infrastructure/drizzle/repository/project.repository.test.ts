import { describe, it, expect } from 'vitest';
import { DrizzleProjectRepository } from '../../../../../src/infrastructure/drizzle/repository/project.repository.js';
import { useTestDb } from '../../../../helpers/db.js';
import { makeProject } from '../../../../helpers/fixtures.js';
import { NotFoundError, AlreadyExistsError } from '../../../../../src/domain/errors.js';

describe('DrizzleProjectRepository', () => {
  const { db } = useTestDb();

  it('creates a project and finds it by id and slug', async () => {
    const repo = new DrizzleProjectRepository(db());

    const created = await repo.create({
      slug: 'demo',
      name: 'Demo',
      recipes: ['binary.sha256'],
      hammingThreshold: null,
    });

    expect(created.id).toBeDefined();
    await expect(repo.findById(created.id)).resolves.toEqual(created);
    await expect(repo.findBySlug('demo')).resolves.toEqual(created);
  });

  it('findById/findBySlug return null when not found', async () => {
    const repo = new DrizzleProjectRepository(db());

    await expect(repo.findBySlug('nope')).resolves.toBeNull();
    await expect(repo.findById('00000000-0000-0000-0000-000000000000')).resolves.toBeNull();
  });

  it('getBySlug throws NotFoundError when the project does not exist', async () => {
    const repo = new DrizzleProjectRepository(db());

    await expect(repo.getBySlug('nope')).rejects.toThrow(NotFoundError);
  });

  it('getBySlug returns the project when it exists', async () => {
    const created = await makeProject(db(), { slug: 'demo' });
    const repo = new DrizzleProjectRepository(db());

    await expect(repo.getBySlug('demo')).resolves.toEqual(created);
  });

  it('list returns all projects ordered by slug', async () => {
    await makeProject(db(), { slug: 'zeta' });
    await makeProject(db(), { slug: 'alpha' });
    const repo = new DrizzleProjectRepository(db());

    const projects = await repo.list();

    expect(projects.map((p) => p.slug)).toEqual(['alpha', 'zeta']);
  });

  it('rejects creating a project with a duplicate slug as AlreadyExistsError', async () => {
    await makeProject(db(), { slug: 'demo' });
    const repo = new DrizzleProjectRepository(db());

    await expect(
      repo.create({ slug: 'demo', name: 'Demo 2', recipes: ['binary.sha256'], hammingThreshold: null }),
    ).rejects.toThrow(AlreadyExistsError);
  });

  it('re-throws a non-unique-violation error as-is (e.g. slug exceeding the column length)', async () => {
    const repo = new DrizzleProjectRepository(db());

    await expect(
      repo.create({ slug: 'x'.repeat(100), name: 'Demo', recipes: ['binary.sha256'], hammingThreshold: null }),
    ).rejects.not.toBeInstanceOf(AlreadyExistsError);
  });

  it('updateSettings updates recipes and hammingThreshold', async () => {
    const created = await makeProject(db(), { slug: 'demo' });
    const repo = new DrizzleProjectRepository(db());

    const updated = await repo.updateSettings(created.id, {
      recipes: ['binary.sha256', 'image.phash16'],
      hammingThreshold: 95,
    });

    expect(updated.recipes).toEqual(['binary.sha256', 'image.phash16']);
    expect(updated.hammingThreshold).toBe(95);
  });

  it('updateSettings updates the name, leaving recipes/hammingThreshold untouched', async () => {
    const created = await makeProject(db(), { slug: 'demo', name: 'Old Name' });
    const repo = new DrizzleProjectRepository(db());

    const updated = await repo.updateSettings(created.id, { name: 'New Name' });

    expect(updated.name).toBe('New Name');
    expect(updated.recipes).toEqual(created.recipes);
    expect(updated.hammingThreshold).toBe(created.hammingThreshold);
  });

  it('updateSettings updates rateLimitPerMinute, leaving other fields untouched', async () => {
    const created = await makeProject(db(), { slug: 'demo' });
    const repo = new DrizzleProjectRepository(db());

    const updated = await repo.updateSettings(created.id, { rateLimitPerMinute: 50 });

    expect(updated.rateLimitPerMinute).toBe(50);
    expect(updated.recipes).toEqual(created.recipes);
    expect(updated.hammingThreshold).toBe(created.hammingThreshold);
  });

  it('updateSettings throws NotFoundError for a nonexistent id', async () => {
    const repo = new DrizzleProjectRepository(db());

    await expect(
      repo.updateSettings('00000000-0000-0000-0000-000000000000', { recipes: ['binary.sha256'] }),
    ).rejects.toThrow(NotFoundError);
  });

  it('deleteById removes the project (idempotent on repeat)', async () => {
    const created = await makeProject(db(), { slug: 'demo' });
    const repo = new DrizzleProjectRepository(db());

    await repo.deleteById(created.id);
    await expect(repo.findById(created.id)).resolves.toBeNull();
    await expect(repo.deleteById(created.id)).resolves.toBeUndefined();
  });
});
