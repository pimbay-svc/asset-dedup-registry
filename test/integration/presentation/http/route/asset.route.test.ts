import { describe, it, expect, vi } from 'vitest';
import { buildHttpServer } from '../../../../../src/presentation/http/server.js';
import { buildFakeCradle } from '../../../../helpers/fakeCradle.js';
import { ApiScope } from '../../../../../src/domain/model/apiClient.model.js';
import { sha256Hex } from '../../../../../src/infrastructure/crypto/credentials.js';
import { AssetAddStatus } from '../../../../../src/domain/model/asset.model.js';
import { MimeHintType } from '../../../../../src/domain/model/asset.model.js';
import { CoreUnavailableError, NotFoundError } from '../../../../../src/domain/errors.js';
import type { ApiClient } from '../../../../../src/domain/model/model.js';
import { Identity } from '../../../../../src/domain/model/asset.model.js';

const RAW_KEY = 'test-raw-key';
const MIME_HINT = { type: MimeHintType.MIME, value: 'image/jpeg' };

function authorizedApiClient(scopes: ApiScope[]): ApiClient {
  return {
    id: 'client-1',
    projectId: 'project-1',
    name: 'test',
    keyHash: sha256Hex(RAW_KEY),
    scopes,
    createdAt: new Date(),
    revokedAt: null,
  };
}

describe('POST /assets', () => {
  it('rejects a request without a bearer token', async () => {
    const app = await buildHttpServer(buildFakeCradle());

    const response = await app.inject({
      method: 'POST',
      url: '/assets',
      payload: { identity: { id: 'a1' }, mime_hint: MIME_HINT, file_content: 'ZmFrZQ==' },
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('rejects a token lacking the assets:write scope', async () => {
    const cradle = buildFakeCradle();
    (cradle.apiClients.findByKeyHash as ReturnType<typeof vi.fn>).mockResolvedValue(
      authorizedApiClient([ApiScope.ASSETS_READ]),
    );
    const app = await buildHttpServer(cradle);

    const response = await app.inject({
      method: 'POST',
      url: '/assets',
      headers: { authorization: `Bearer ${RAW_KEY}` },
      payload: { identity: { id: 'a1' }, mime_hint: MIME_HINT, file_content: 'ZmFrZQ==' },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('rejects a body missing a required field', async () => {
    const cradle = buildFakeCradle();
    (cradle.apiClients.findByKeyHash as ReturnType<typeof vi.fn>).mockResolvedValue(
      authorizedApiClient([ApiScope.ASSETS_WRITE]),
    );
    const app = await buildHttpServer(cradle);

    const response = await app.inject({
      method: 'POST',
      url: '/assets',
      headers: { authorization: `Bearer ${RAW_KEY}` },
      payload: { mime_hint: MIME_HINT, file_content: 'ZmFrZQ==' },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('rejects a body with an invalid mime_hint.type', async () => {
    const cradle = buildFakeCradle();
    (cradle.apiClients.findByKeyHash as ReturnType<typeof vi.fn>).mockResolvedValue(
      authorizedApiClient([ApiScope.ASSETS_WRITE]),
    );
    const app = await buildHttpServer(cradle);

    const response = await app.inject({
      method: 'POST',
      url: '/assets',
      headers: { authorization: `Bearer ${RAW_KEY}` },
      payload: { identity: { id: 'a1' }, mime_hint: { type: 'bogus', value: 'x' }, file_content: 'ZmFrZQ==' },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('dispatches AddAsset and returns the multi-recipe result on success', async () => {
    const cradle = buildFakeCradle();
    (cradle.apiClients.findByKeyHash as ReturnType<typeof vi.fn>).mockResolvedValue(
      authorizedApiClient([ApiScope.ASSETS_WRITE]),
    );
    (cradle.commandGateway.dispatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      identity: new Identity('a1', null),
      results: [{ recipe: 'binary.sha256', hashes: ['abc123'], status: AssetAddStatus.CREATED }],
    });
    const app = await buildHttpServer(cradle);

    const response = await app.inject({
      method: 'POST',
      url: '/assets',
      headers: { authorization: `Bearer ${RAW_KEY}` },
      payload: { identity: { id: 'a1' }, mime_hint: MIME_HINT, file_content: 'ZmFrZQ==' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      identity: { id: 'a1', path: null },
      results: [{ recipe: 'binary.sha256', hashes: ['abc123'], status: 'created' }],
    });
    await app.close();
  });

  it('maps a domain error thrown by the handler to the correct status code', async () => {
    const cradle = buildFakeCradle();
    (cradle.apiClients.findByKeyHash as ReturnType<typeof vi.fn>).mockResolvedValue(
      authorizedApiClient([ApiScope.ASSETS_WRITE]),
    );
    (cradle.commandGateway.dispatch as ReturnType<typeof vi.fn>).mockRejectedValue(
      CoreUnavailableError.emptyHashResponse(),
    );
    const app = await buildHttpServer(cradle);

    const response = await app.inject({
      method: 'POST',
      url: '/assets',
      headers: { authorization: `Bearer ${RAW_KEY}` },
      payload: { identity: { id: 'a1' }, mime_hint: MIME_HINT, file_content: 'ZmFrZQ==' },
    });

    expect(response.statusCode).toBe(502);
    await app.close();
  });

  it('dispatches AddAsset with a path-only identity when id is omitted', async () => {
    const cradle = buildFakeCradle();
    (cradle.apiClients.findByKeyHash as ReturnType<typeof vi.fn>).mockResolvedValue(
      authorizedApiClient([ApiScope.ASSETS_WRITE]),
    );
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue({
      identity: new Identity(null, '/library/a.jpg'),
      results: [{ recipe: 'binary.sha256', hashes: ['abc123'], status: AssetAddStatus.CREATED }],
    });
    const app = await buildHttpServer(cradle);

    const response = await app.inject({
      method: 'POST',
      url: '/assets',
      headers: { authorization: `Bearer ${RAW_KEY}` },
      payload: { identity: { path: '/library/a.jpg' }, mime_hint: MIME_HINT, file_content: 'ZmFrZQ==' },
    });

    expect(response.statusCode).toBe(200);
    const dispatched = dispatchSpy.mock.calls[0]?.[0] as { identityId: string | null; identityPath: string | null };
    expect(dispatched.identityId).toBeNull();
    expect(dispatched.identityPath).toBe('/library/a.jpg');
    await app.close();
  });
});

describe('DELETE /assets', () => {
  it('dispatches DeleteAsset and returns 204', async () => {
    const cradle = buildFakeCradle();
    (cradle.apiClients.findByKeyHash as ReturnType<typeof vi.fn>).mockResolvedValue(
      authorizedApiClient([ApiScope.ASSETS_WRITE]),
    );
    (cradle.commandGateway.dispatch as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const app = await buildHttpServer(cradle);

    const response = await app.inject({
      method: 'DELETE',
      url: '/assets',
      headers: { authorization: `Bearer ${RAW_KEY}` },
      payload: { identity: { id: 'a1' } },
    });

    expect(response.statusCode).toBe(204);
    await app.close();
  });

  it('maps a domain error thrown by the handler to the correct status code', async () => {
    const cradle = buildFakeCradle();
    (cradle.apiClients.findByKeyHash as ReturnType<typeof vi.fn>).mockResolvedValue(
      authorizedApiClient([ApiScope.ASSETS_WRITE]),
    );
    (cradle.commandGateway.dispatch as ReturnType<typeof vi.fn>).mockRejectedValue(
      NotFoundError.asset(new Identity('a1', null)),
    );
    const app = await buildHttpServer(cradle);

    const response = await app.inject({
      method: 'DELETE',
      url: '/assets',
      headers: { authorization: `Bearer ${RAW_KEY}` },
      payload: { identity: { id: 'a1' } },
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('rejects a body missing identity', async () => {
    const cradle = buildFakeCradle();
    (cradle.apiClients.findByKeyHash as ReturnType<typeof vi.fn>).mockResolvedValue(
      authorizedApiClient([ApiScope.ASSETS_WRITE]),
    );
    const app = await buildHttpServer(cradle);

    const response = await app.inject({
      method: 'DELETE',
      url: '/assets',
      headers: { authorization: `Bearer ${RAW_KEY}` },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('dispatches DeleteAsset with a path-only identity when id is omitted', async () => {
    const cradle = buildFakeCradle();
    (cradle.apiClients.findByKeyHash as ReturnType<typeof vi.fn>).mockResolvedValue(
      authorizedApiClient([ApiScope.ASSETS_WRITE]),
    );
    const dispatchSpy = vi.spyOn(cradle.commandGateway, 'dispatch').mockResolvedValue(undefined);
    const app = await buildHttpServer(cradle);

    const response = await app.inject({
      method: 'DELETE',
      url: '/assets',
      headers: { authorization: `Bearer ${RAW_KEY}` },
      payload: { identity: { path: '/library/a.jpg' } },
    });

    expect(response.statusCode).toBe(204);
    const dispatched = dispatchSpy.mock.calls[0]?.[0] as { identity: Identity };
    expect(dispatched.identity).toEqual(new Identity(null, '/library/a.jpg'));
    await app.close();
  });
});

describe('GET /assets/recipes', () => {
  it('returns the recipes list for the asset', async () => {
    const cradle = buildFakeCradle();
    (cradle.apiClients.findByKeyHash as ReturnType<typeof vi.fn>).mockResolvedValue(
      authorizedApiClient([ApiScope.ASSETS_READ]),
    );
    (cradle.assets.listRecipes as ReturnType<typeof vi.fn>).mockResolvedValue(['binary.sha256', 'image.phash16']);
    const app = await buildHttpServer(cradle);

    const response = await app.inject({
      method: 'GET',
      url: '/assets/recipes?id=a1',
      headers: { authorization: `Bearer ${RAW_KEY}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      identity: { id: 'a1', path: null },
      recipes: ['binary.sha256', 'image.phash16'],
    });
    await app.close();
  });

  it('rejects a token lacking the assets:read scope', async () => {
    const cradle = buildFakeCradle();
    (cradle.apiClients.findByKeyHash as ReturnType<typeof vi.fn>).mockResolvedValue(
      authorizedApiClient([ApiScope.ASSETS_WRITE]),
    );
    const app = await buildHttpServer(cradle);

    const response = await app.inject({
      method: 'GET',
      url: '/assets/recipes?id=a1',
      headers: { authorization: `Bearer ${RAW_KEY}` },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('maps an unexpected error to a 500', async () => {
    const cradle = buildFakeCradle();
    (cradle.apiClients.findByKeyHash as ReturnType<typeof vi.fn>).mockResolvedValue(
      authorizedApiClient([ApiScope.ASSETS_READ]),
    );
    (cradle.assets.listRecipes as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'));
    const app = await buildHttpServer(cradle);

    const response = await app.inject({
      method: 'GET',
      url: '/assets/recipes?id=a1',
      headers: { authorization: `Bearer ${RAW_KEY}` },
    });

    expect(response.statusCode).toBe(500);
    await app.close();
  });

  it('resolves recipes for a path-only identity when id is omitted', async () => {
    const cradle = buildFakeCradle();
    (cradle.apiClients.findByKeyHash as ReturnType<typeof vi.fn>).mockResolvedValue(
      authorizedApiClient([ApiScope.ASSETS_READ]),
    );
    const listRecipesSpy = vi.spyOn(cradle.assets, 'listRecipes').mockResolvedValue(['binary.sha256']);
    const app = await buildHttpServer(cradle);

    const response = await app.inject({
      method: 'GET',
      url: '/assets/recipes?path=%2Flibrary%2Fa.jpg',
      headers: { authorization: `Bearer ${RAW_KEY}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      identity: { id: null, path: '/library/a.jpg' },
      recipes: ['binary.sha256'],
    });
    expect(listRecipesSpy).toHaveBeenCalledWith('project-1', new Identity(null, '/library/a.jpg'));
    await app.close();
  });
});
