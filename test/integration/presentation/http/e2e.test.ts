/** True end-to-end: real Fastify server, real Drizzle repositories, real Postgres (testcontainers).
 * Complements the fake-cradle route tests in route/*.test.ts, which isolate routing/auth/validation
 * without a database. */
import { describe, it, expect } from 'vitest';
import { buildTestServer } from '../../../helpers/server.js';
import { useTestDb } from '../../../helpers/db.js';
import { makeProject, makeApiClient } from '../../../helpers/fixtures.js';
import { ApiScope } from '../../../../src/domain/model/apiClient.model.js';
import { Comparison } from '../../../../src/domain/model/algorithm.model.js';
import { MimeHintType } from '../../../../src/domain/model/asset.model.js';
import type { CoreHasher, CoreHashResult, CoreAlgorithm } from '../../../../src/domain/provider/hasher.provider.js';

const MIME_HINT = { type: MimeHintType.MIME, value: 'image/jpeg' };
const RECIPE = 'image.phash16';

function stubHasher(hashSequence: string[], listAlgorithms: CoreAlgorithm[]): CoreHasher {
  let call = 0;

  return {
    hash: (): Promise<CoreHashResult[]> => {
      const hash = hashSequence[call] ?? hashSequence[hashSequence.length - 1] ?? '0000000000000000';
      call += 1;

      return Promise.resolve([{ recipe: RECIPE, hashes: [hash] }]);
    },
    listAlgorithms: () => Promise.resolve(listAlgorithms),
  };
}

describe('end-to-end: upsert an asset, then find it as a duplicate', () => {
  const { db } = useTestDb();

  it('upserts two similar assets via HTTP and finds them as duplicates of each other', async () => {
    const project = await makeProject(db(), { recipes: [RECIPE], hammingThreshold: null });
    const { rawKey } = await makeApiClient(db(), project.id, {
      scopes: [ApiScope.ASSETS_WRITE, ApiScope.ASSETS_READ],
    });
    const authHeader = { authorization: `Bearer ${rawKey}` };

    // asset-1 and asset-2 hash to values 1 bit apart -> should show up as duplicates.
    const app = await buildTestServer(db(), {
      coreClient: stubHasher(
        ['0000000000000000', '0000000000000001'],
        [{ recipe: RECIPE, comparison: Comparison.HAMMING }],
      ),
    });

    const first = await app.inject({
      method: 'POST',
      url: '/assets',
      headers: authHeader,
      payload: { identity: { id: 'asset-1' }, mime_hint: MIME_HINT, file_content: 'ZmFrZQ==' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      identity: { id: 'asset-1', path: null },
      results: [{ recipe: RECIPE, status: 'created' }],
    });

    const second = await app.inject({
      method: 'POST',
      url: '/assets',
      headers: authHeader,
      payload: { identity: { id: 'asset-2' }, mime_hint: MIME_HINT, file_content: 'ZmFrZQ==' },
    });
    expect(second.statusCode).toBe(200);

    const find = await app.inject({
      method: 'GET',
      url: `/duplicates/matches?id=asset-1&recipe=${RECIPE}&threshold=5`,
      headers: authHeader,
    });

    expect(find.statusCode).toBe(200);
    expect(find.json()).toMatchObject({
      data: [{ identity: { id: 'asset-2', path: null }, distance: 1 }],
      total_count: 1,
    });

    await app.close();
  });

  it('deletes an asset via HTTP; a subsequent duplicates lookup for it 404s', async () => {
    const project = await makeProject(db(), { recipes: [RECIPE], hammingThreshold: null });
    const { rawKey } = await makeApiClient(db(), project.id, {
      scopes: [ApiScope.ASSETS_WRITE, ApiScope.ASSETS_READ],
    });
    const authHeader = { authorization: `Bearer ${rawKey}` };
    const app = await buildTestServer(db(), {
      coreClient: stubHasher(['0000000000000000'], [{ recipe: RECIPE, comparison: Comparison.HAMMING }]),
    });

    await app.inject({
      method: 'POST',
      url: '/assets',
      headers: authHeader,
      payload: { identity: { id: 'asset-1' }, mime_hint: MIME_HINT, file_content: 'ZmFrZQ==' },
    });

    const del = await app.inject({
      method: 'DELETE',
      url: '/assets',
      headers: authHeader,
      payload: { identity: { id: 'asset-1' } },
    });
    expect(del.statusCode).toBe(204);

    const find = await app.inject({
      method: 'GET',
      url: `/duplicates/matches?id=asset-1&recipe=${RECIPE}`,
      headers: authHeader,
    });
    // The asset row itself is gone (cascade-deleted), so assets.getByIdentity's existence check fails.
    expect(find.statusCode).toBe(404);

    await app.close();
  });

  it('rejects an unauthenticated request against a real server + DB', async () => {
    const app = await buildTestServer(db());

    const response = await app.inject({
      method: 'GET',
      url: `/duplicates/matches?id=asset-1&recipe=${RECIPE}`,
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('reports GET /assets/recipes for a hashed asset', async () => {
    const project = await makeProject(db(), { recipes: [RECIPE], hammingThreshold: null });
    const { rawKey } = await makeApiClient(db(), project.id, {
      scopes: [ApiScope.ASSETS_WRITE, ApiScope.ASSETS_READ],
    });
    const authHeader = { authorization: `Bearer ${rawKey}` };
    const app = await buildTestServer(db(), {
      coreClient: stubHasher(['0000000000000000'], [{ recipe: RECIPE, comparison: Comparison.HAMMING }]),
    });

    await app.inject({
      method: 'POST',
      url: '/assets',
      headers: authHeader,
      payload: { identity: { id: 'asset-1' }, mime_hint: MIME_HINT, file_content: 'ZmFrZQ==' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/assets/recipes?id=asset-1',
      headers: authHeader,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ identity: { id: 'asset-1', path: null }, recipes: [RECIPE] });

    await app.close();
  });
});
