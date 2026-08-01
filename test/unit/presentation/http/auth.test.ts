import { describe, it, expect, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { requireScope } from '../../../../src/presentation/http/auth.js';
import { ApiScope } from '../../../../src/domain/model/apiClient.model.js';
import { sha256Hex } from '../../../../src/infrastructure/crypto/credentials.js';
import type { ApiClients } from '../../../../src/domain/repo/apiClient.repo.js';
import type { ApiClient } from '../../../../src/domain/model/model.js';
import { UnauthorizedError, ForbiddenError } from '../../../../src/domain/errors.js';

const RAW_KEY = 'test-raw-key';
const KEY_HASH = sha256Hex(RAW_KEY);

function buildRequest(authorization?: string): FastifyRequest {
  return { headers: { authorization } } as unknown as FastifyRequest;
}

function buildApiClients(record: ApiClient | null): ApiClients {
  return {
    findByKeyHash: vi
      .fn()
      .mockImplementation((keyHash: string) => Promise.resolve(keyHash === KEY_HASH ? record : null)),
    listByProject: vi.fn(),
    findByProjectAndName: vi.fn().mockResolvedValue(null),
  };
}

describe('requireScope', () => {
  it('rejects a missing Authorization header', async () => {
    const preHandler = requireScope(buildApiClients(null), ApiScope.ASSETS_READ);

    await expect(preHandler(buildRequest(undefined))).rejects.toThrow(UnauthorizedError);
  });

  it('rejects a header without the Bearer prefix', async () => {
    const preHandler = requireScope(buildApiClients(null), ApiScope.ASSETS_READ);

    await expect(preHandler(buildRequest(RAW_KEY))).rejects.toThrow('missing or malformed Authorization header');
  });

  it('rejects an empty API key after the Bearer prefix', async () => {
    const preHandler = requireScope(buildApiClients(null), ApiScope.ASSETS_READ);

    await expect(preHandler(buildRequest('Bearer    '))).rejects.toThrow('empty API key');
  });

  it('trims surrounding whitespace from the key before hashing it', async () => {
    const record: ApiClient = {
      id: 'client-1',
      projectId: 'project-1',
      name: 'test',
      keyHash: KEY_HASH,
      scopes: [ApiScope.ASSETS_READ],
      createdAt: new Date(),
      revokedAt: null,
    };
    const preHandler = requireScope(buildApiClients(record), ApiScope.ASSETS_READ);
    const request = buildRequest(`Bearer   ${RAW_KEY}  `);

    await preHandler(request);

    expect(request.apiClient).toBe(record);
  });

  it('rejects an unknown key', async () => {
    const preHandler = requireScope(buildApiClients(null), ApiScope.ASSETS_READ);

    await expect(preHandler(buildRequest(`Bearer ${RAW_KEY}`))).rejects.toThrow(UnauthorizedError);
  });

  it('rejects a valid key lacking the required scope', async () => {
    const record: ApiClient = {
      id: 'client-1',
      projectId: 'project-1',
      name: 'test',
      keyHash: KEY_HASH,
      scopes: [ApiScope.ASSETS_READ],
      createdAt: new Date(),
      revokedAt: null,
    };
    const preHandler = requireScope(buildApiClients(record), ApiScope.ASSETS_WRITE);

    await expect(preHandler(buildRequest(`Bearer ${RAW_KEY}`))).rejects.toThrow(ForbiddenError);
  });

  it('accepts a valid key with the required scope and attaches request context', async () => {
    const record: ApiClient = {
      id: 'client-1',
      projectId: 'project-1',
      name: 'test',
      keyHash: KEY_HASH,
      scopes: [ApiScope.ASSETS_WRITE],
      createdAt: new Date(),
      revokedAt: null,
    };
    const preHandler = requireScope(buildApiClients(record), ApiScope.ASSETS_WRITE);
    const request = buildRequest(`Bearer ${RAW_KEY}`);

    await preHandler(request);

    expect(request.apiClient).toBe(record);
    expect(request.projectId).toBe('project-1');
  });
});
