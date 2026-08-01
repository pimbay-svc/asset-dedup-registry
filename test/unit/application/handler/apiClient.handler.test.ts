import { describe, it, expect, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { ApiClientHandlers } from '../../../../src/application/handler/apiClient.handler.js';
import { CreateApiClient, RevokeApiClient } from '../../../../src/application/command/apiClient.command.js';
import { ApiScope } from '../../../../src/domain/model/apiClient.model.js';
import type { ApiClientWriter } from '../../../../src/application/writer/apiClient.writer.js';
import type { ApiClients } from '../../../../src/domain/repo/apiClient.repo.js';
import type { ApiClient } from '../../../../src/domain/model/model.js';
import { AlreadyExistsError } from '../../../../src/domain/errors.js';

const API_CLIENT: ApiClient = {
  id: 'client-1',
  projectId: 'project-1',
  name: 'test',
  keyHash: 'irrelevant-for-this-assertion',
  scopes: [ApiScope.ASSETS_READ],
  createdAt: new Date(),
  revokedAt: null,
};

function buildHandlers(overrides: { writer?: Partial<ApiClientWriter>; apiClients?: Partial<ApiClients> } = {}): {
  handlers: ApiClientHandlers;
  writer: ApiClientWriter;
  apiClients: ApiClients;
  createSpy: MockInstance;
  revokeSpy: MockInstance;
} {
  const writer: ApiClientWriter = {
    create: vi.fn().mockResolvedValue(API_CLIENT),
    revoke: vi.fn(),
    ...overrides.writer,
  };
  const apiClients: ApiClients = {
    findByKeyHash: vi.fn(),
    listByProject: vi.fn(),
    findByProjectAndName: vi.fn().mockResolvedValue(null),
    ...overrides.apiClients,
  };
  const createSpy = vi.spyOn(writer, 'create');
  const revokeSpy = vi.spyOn(writer, 'revoke');

  return { handlers: new ApiClientHandlers(writer, apiClients), writer, apiClients, createSpy, revokeSpy };
}

describe('ApiClientHandlers.create', () => {
  it('generates a raw key, hashes it, and delegates to the writer', async () => {
    const { handlers, createSpy } = buildHandlers();

    const result = await handlers.create(new CreateApiClient('project-1', 'test', [ApiScope.ASSETS_READ]));

    expect(result.apiClient).toBe(API_CLIENT);
    expect(result.rawKey).toMatch(/^[0-9a-f]{64}$/);
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project-1', name: 'test', scopes: [ApiScope.ASSETS_READ] }),
    );
  });

  it('generates a different raw key on each call', async () => {
    const { handlers } = buildHandlers();

    const first = await handlers.create(new CreateApiClient('project-1', 'a', []));
    const second = await handlers.create(new CreateApiClient('project-1', 'b', []));

    expect(first.rawKey).not.toBe(second.rawKey);
  });

  it('rejects when an active client with the same name already exists for the project', async () => {
    const { handlers } = buildHandlers({ apiClients: { findByProjectAndName: vi.fn().mockResolvedValue(API_CLIENT) } });

    await expect(handlers.create(new CreateApiClient('project-1', 'test', []))).rejects.toThrow(AlreadyExistsError);
  });
});

describe('ApiClientHandlers.revoke', () => {
  it('delegates to the writer with the command id', async () => {
    const { handlers, revokeSpy } = buildHandlers();

    await handlers.revoke(new RevokeApiClient('client-1'));

    expect(revokeSpy).toHaveBeenCalledWith('client-1');
  });
});

describe('ApiClientHandlers.asHandlers', () => {
  it('exposes create and revoke bound to the correct command classes', () => {
    const { handlers } = buildHandlers();

    const [create, revoke] = handlers.asHandlers();

    expect(create?.commandClass).toBe(CreateApiClient);
    expect(revoke?.commandClass).toBe(RevokeApiClient);
  });

  it('the returned handlers are usable independently of the instance (correctly bound)', async () => {
    const { handlers, createSpy } = buildHandlers();
    const [create] = handlers.asHandlers();

    if (!create) {
      throw new Error('expected a create handler');
    }
    await create.execute(new CreateApiClient('project-1', 'x', []));

    expect(createSpy).toHaveBeenCalled();
  });
});
