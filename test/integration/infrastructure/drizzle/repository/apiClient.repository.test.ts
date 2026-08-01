import { describe, it, expect } from 'vitest';
import { DrizzleApiClientRepository } from '../../../../../src/infrastructure/drizzle/repository/apiClient.repository.js';
import { ApiScope } from '../../../../../src/domain/model/apiClient.model.js';
import { useTestDb } from '../../../../helpers/db.js';
import { makeProject, makeApiClient } from '../../../../helpers/fixtures.js';
import { NotFoundError, AlreadyExistsError } from '../../../../../src/domain/errors.js';

describe('DrizzleApiClientRepository', () => {
  const { db } = useTestDb();

  it('creates a client and finds it by key hash', async () => {
    const project = await makeProject(db());
    const repo = new DrizzleApiClientRepository(db());

    const created = await repo.create({
      projectId: project.id,
      name: 'ci',
      keyHash: 'hash-1',
      scopes: [ApiScope.ASSETS_READ],
    });

    await expect(repo.findByKeyHash('hash-1')).resolves.toEqual(created);
  });

  it('findByKeyHash returns null for an unknown key', async () => {
    const repo = new DrizzleApiClientRepository(db());

    await expect(repo.findByKeyHash('unknown')).resolves.toBeNull();
  });

  it('findByKeyHash does not return a revoked client', async () => {
    const project = await makeProject(db());
    const { apiClient } = await makeApiClient(db(), project.id);
    const repo = new DrizzleApiClientRepository(db());

    await repo.revoke(apiClient.id);

    await expect(repo.findByKeyHash(apiClient.keyHash)).resolves.toBeNull();
  });

  it('listByProject returns clients for the project ordered by creation time', async () => {
    const project = await makeProject(db());
    const repo = new DrizzleApiClientRepository(db());
    await repo.create({ projectId: project.id, name: 'first', keyHash: 'hash-1', scopes: [] });
    await repo.create({ projectId: project.id, name: 'second', keyHash: 'hash-2', scopes: [] });

    const clients = await repo.listByProject(project.id);

    expect(clients.map((c) => c.name)).toEqual(['first', 'second']);
  });

  it('listByProject excludes clients from other projects', async () => {
    const project = await makeProject(db());
    const otherProject = await makeProject(db());
    await makeApiClient(db(), project.id);
    await makeApiClient(db(), otherProject.id);
    const repo = new DrizzleApiClientRepository(db());

    const clients = await repo.listByProject(project.id);

    expect(clients).toHaveLength(1);
    expect(clients[0]?.projectId).toBe(project.id);
  });

  it('findByProjectAndName finds an active client by name', async () => {
    const project = await makeProject(db());
    const { apiClient } = await makeApiClient(db(), project.id, { name: 'ci' });
    const repo = new DrizzleApiClientRepository(db());

    await expect(repo.findByProjectAndName(project.id, 'ci')).resolves.toEqual(apiClient);
  });

  it('findByProjectAndName does not return a revoked client', async () => {
    const project = await makeProject(db());
    const { apiClient } = await makeApiClient(db(), project.id, { name: 'ci' });
    const repo = new DrizzleApiClientRepository(db());
    await repo.revoke(apiClient.id);

    await expect(repo.findByProjectAndName(project.id, 'ci')).resolves.toBeNull();
  });

  it('rejects creating a second active client with the same name in the same project', async () => {
    const project = await makeProject(db());
    const repo = new DrizzleApiClientRepository(db());
    await repo.create({ projectId: project.id, name: 'ci', keyHash: 'hash-1', scopes: [] });

    await expect(repo.create({ projectId: project.id, name: 'ci', keyHash: 'hash-2', scopes: [] })).rejects.toThrow(
      AlreadyExistsError,
    );
  });

  it('allows re-issuing a name after the original client was revoked', async () => {
    const project = await makeProject(db());
    const repo = new DrizzleApiClientRepository(db());
    const first = await repo.create({ projectId: project.id, name: 'ci', keyHash: 'hash-1', scopes: [] });
    await repo.revoke(first.id);

    await expect(
      repo.create({ projectId: project.id, name: 'ci', keyHash: 'hash-2', scopes: [] }),
    ).resolves.toBeDefined();
  });

  it('re-throws a non-unique-violation error as-is (e.g. a foreign key violation)', async () => {
    const repo = new DrizzleApiClientRepository(db());

    await expect(
      repo.create({
        projectId: '00000000-0000-0000-0000-000000000000',
        name: 'ci',
        keyHash: 'hash-1',
        scopes: [],
      }),
    ).rejects.not.toBeInstanceOf(AlreadyExistsError);
  });

  it('revoke throws NotFoundError for a nonexistent client', async () => {
    const repo = new DrizzleApiClientRepository(db());

    await expect(repo.revoke('00000000-0000-0000-0000-000000000000')).rejects.toThrow(NotFoundError);
  });

  it('revoke throws NotFoundError when the client is already revoked', async () => {
    const project = await makeProject(db());
    const { apiClient } = await makeApiClient(db(), project.id);
    const repo = new DrizzleApiClientRepository(db());
    await repo.revoke(apiClient.id);

    await expect(repo.revoke(apiClient.id)).rejects.toThrow(NotFoundError);
  });
});
