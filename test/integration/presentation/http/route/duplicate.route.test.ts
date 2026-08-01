import { describe, it, expect, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { buildHttpServer } from '../../../../../src/presentation/http/server.js';
import { buildFakeCradle } from '../../../../helpers/fakeCradle.js';
import { ApiScope } from '../../../../../src/domain/model/apiClient.model.js';
import { Comparison } from '../../../../../src/domain/model/algorithm.model.js';
import { sha256Hex } from '../../../../../src/infrastructure/crypto/credentials.js';
import { NotFoundError } from '../../../../../src/domain/errors.js';
import type { ApiClient, Project, Algorithm } from '../../../../../src/domain/model/model.js';
import { Identity } from '../../../../../src/domain/model/asset.model.js';
import { buildPage } from '../../../../helpers/page.js';

const RAW_KEY = 'test-raw-key';

function authorizedApiClient(): ApiClient {
  return {
    id: 'client-1',
    projectId: 'project-1',
    name: 'test',
    keyHash: sha256Hex(RAW_KEY),
    scopes: [ApiScope.ASSETS_READ],
    createdAt: new Date(),
    revokedAt: null,
  };
}

const PROJECT: Project = {
  id: 'project-1',
  slug: 'demo',
  name: 'Demo',
  recipes: ['image.phash16'],
  hammingThreshold: null,
  rateLimitPerMinute: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const ALGORITHM: Algorithm = { id: 1, recipe: 'image.phash16', comparison: Comparison.HAMMING };

async function buildAuthorizedApp(cradle = buildFakeCradle()): Promise<{
  app: Awaited<ReturnType<typeof buildHttpServer>>;
  cradle: ReturnType<typeof buildFakeCradle>;
  resolveDuplicateScopeSpy: MockInstance;
  getByIdentitySpy: MockInstance;
}> {
  vi.spyOn(cradle.apiClients, 'findByKeyHash').mockResolvedValue(authorizedApiClient());
  const resolveDuplicateScopeSpy = vi.spyOn(cradle.scopeResolver, 'resolveDuplicateScope').mockResolvedValue({
    project: PROJECT,
    algorithm: ALGORITHM,
    minSimilarity: 90,
    thresholdIgnored: false,
  });
  const getByIdentitySpy = vi.spyOn(cradle.assets, 'getByIdentity').mockResolvedValue({
    id: 'asset-1',
    projectId: 'project-1',
    identityId: 'a1',
    identityPath: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const app = await buildHttpServer(cradle);

  return { app, cradle, resolveDuplicateScopeSpy, getByIdentitySpy };
}

const AUTH_HEADER = { authorization: `Bearer ${RAW_KEY}` };

describe('GET /duplicates/matches', () => {
  it('requires the assets:read scope', async () => {
    const app = await buildHttpServer(buildFakeCradle());

    const response = await app.inject({
      method: 'GET',
      url: '/duplicates/matches?id=a1&recipe=image.phash16',
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('rejects a request missing the required recipe param', async () => {
    const { app } = await buildAuthorizedApp();

    const response = await app.inject({ method: 'GET', url: '/duplicates/matches?id=a1', headers: AUTH_HEADER });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('resolves scope via scopeResolver and maps matches to the wire format', async () => {
    const { app, cradle, resolveDuplicateScopeSpy, getByIdentitySpy } = await buildAuthorizedApp();
    const paginateMatchesSpy = vi.spyOn(cradle.assetHashDuplicatesSearch, 'paginateMatches').mockResolvedValue(
      buildPage({
        data: [{ identity: new Identity('a2', null), distance: 3, similarity: 95.3 }],
        totalCount: 1,
        currentCount: 1,
        currentPage: 1,
        pageSize: 20,
        pageCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      }),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/duplicates/matches?id=a1&recipe=image.phash16',
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: [{ identity: { id: 'a2', path: null }, distance: 3, similarity: 95.3 }],
      total_count: 1,
      current_count: 1,
      current_page: 1,
      page_size: 20,
      page_count: 1,
      has_next_page: false,
      has_previous_page: false,
    });
    expect(resolveDuplicateScopeSpy).toHaveBeenCalledWith('project-1', 'image.phash16', undefined);
    expect(getByIdentitySpy).toHaveBeenCalledWith('project-1', new Identity('a1', null));
    expect(paginateMatchesSpy).toHaveBeenCalledWith(
      { projectId: 'project-1', algorithmId: ALGORITHM.id, identity: new Identity('a1', null), minSimilarity: 90 },
      1,
      20,
    );
    await app.close();
  });

  it('honors explicit page/page_size query params', async () => {
    const { app, cradle } = await buildAuthorizedApp();
    const paginateMatchesSpy = vi.spyOn(cradle.assetHashDuplicatesSearch, 'paginateMatches').mockResolvedValue(
      buildPage({
        data: [],
        totalCount: 0,
        currentCount: 0,
        currentPage: 2,
        pageSize: 5,
        pageCount: 1,
        hasNextPage: false,
        hasPreviousPage: true,
      }),
    );

    await app.inject({
      method: 'GET',
      url: '/duplicates/matches?id=a1&recipe=image.phash16&page=2&page_size=5',
      headers: AUTH_HEADER,
    });

    expect(paginateMatchesSpy).toHaveBeenCalledWith(expect.anything(), 2, 5);
    await app.close();
  });

  it('maps a NotFoundError (unconfigured recipe) to a 404', async () => {
    const { app, resolveDuplicateScopeSpy } = await buildAuthorizedApp();
    resolveDuplicateScopeSpy.mockRejectedValue(NotFoundError.project('demo'));

    const response = await app.inject({
      method: 'GET',
      url: '/duplicates/matches?id=a1&recipe=image.phash16',
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('maps a NotFoundError (unknown asset) to a 404', async () => {
    const { app, cradle, getByIdentitySpy } = await buildAuthorizedApp();
    getByIdentitySpy.mockRejectedValue(NotFoundError.asset(new Identity('a1', null)));
    const paginateMatchesSpy = vi.spyOn(cradle.assetHashDuplicatesSearch, 'paginateMatches');

    const response = await app.inject({
      method: 'GET',
      url: '/duplicates/matches?id=unknown&recipe=image.phash16',
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(404);
    expect(paginateMatchesSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it('propagates an unexpected error as a 500', async () => {
    const { app, cradle } = await buildAuthorizedApp();
    vi.spyOn(cradle.assetHashDuplicatesSearch, 'paginateMatches').mockRejectedValue(new Error('boom'));

    const response = await app.inject({
      method: 'GET',
      url: '/duplicates/matches?id=a1&recipe=image.phash16',
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(500);
    await app.close();
  });

  it('resolves matches for a path-only identity when id is omitted', async () => {
    const { app, cradle, getByIdentitySpy } = await buildAuthorizedApp();
    const paginateMatchesSpy = vi.spyOn(cradle.assetHashDuplicatesSearch, 'paginateMatches').mockResolvedValue(
      buildPage({
        data: [],
        totalCount: 0,
        currentCount: 0,
        currentPage: 1,
        pageSize: 20,
        pageCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      }),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/duplicates/matches?path=%2Flibrary%2Fa.jpg&recipe=image.phash16',
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
    expect(getByIdentitySpy).toHaveBeenCalledWith('project-1', new Identity(null, '/library/a.jpg'));
    expect(paginateMatchesSpy).toHaveBeenCalledWith(
      {
        projectId: 'project-1',
        algorithmId: ALGORITHM.id,
        identity: new Identity(null, '/library/a.jpg'),
        minSimilarity: 90,
      },
      1,
      20,
    );
    await app.close();
  });
});

describe('GET /duplicates/clusters', () => {
  it('rejects a request missing the required recipe param', async () => {
    const { app } = await buildAuthorizedApp();

    const response = await app.inject({ method: 'GET', url: '/duplicates/clusters', headers: AUTH_HEADER });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('maps clusters to the wire format', async () => {
    const { app, cradle } = await buildAuthorizedApp();
    const paginateSpy = vi.spyOn(cradle.clustersSearch, 'paginate').mockResolvedValue({
      generation: 42,
      page: buildPage({
        data: [
          {
            clusterId: 'c1',
            maxSimilarity: 99,
            assets: [{ identity: new Identity('a1', null), avgSimilarityToCluster: 98 }],
          },
        ],
        totalCount: 1,
        currentCount: 1,
        currentPage: 1,
        pageSize: 20,
        pageCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      }),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/duplicates/clusters?recipe=image.phash16',
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: [
        {
          cluster_id: 'c1',
          max_similarity: 99,
          assets: [{ identity: { id: 'a1', path: null }, avg_similarity_to_cluster: 98 }],
        },
      ],
      total_count: 1,
      current_count: 1,
      current_page: 1,
      page_size: 20,
      page_count: 1,
      has_next_page: false,
      has_previous_page: false,
      generation: 42,
    });
    expect(paginateSpy).toHaveBeenCalledWith(
      { projectId: 'project-1', algorithmId: ALGORITHM.id, minSimilarity: 90 },
      1,
      20,
    );
    await app.close();
  });

  it('passes id/path query params through as an id/path filter', async () => {
    const { app, cradle } = await buildAuthorizedApp();
    const paginateSpy = vi.spyOn(cradle.clustersSearch, 'paginate').mockResolvedValue({
      generation: 1,
      page: buildPage({
        data: [],
        totalCount: 0,
        currentCount: 0,
        currentPage: 1,
        pageSize: 20,
        pageCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      }),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/duplicates/clusters?recipe=image.phash16&id=a1&path=%2Ainvoice%2A',
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
    expect(paginateSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1', path: '*invoice*' }), 1, 20);
    await app.close();
  });

  it('passes generation through to the search repository when provided', async () => {
    const { app, cradle } = await buildAuthorizedApp();
    const paginateSpy = vi.spyOn(cradle.clustersSearch, 'paginate').mockResolvedValue({
      generation: 42,
      page: buildPage({
        data: [],
        totalCount: 0,
        currentCount: 0,
        currentPage: 1,
        pageSize: 20,
        pageCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      }),
    });

    await app.inject({
      method: 'GET',
      url: '/duplicates/clusters?recipe=image.phash16&generation=42',
      headers: AUTH_HEADER,
    });

    expect(paginateSpy).toHaveBeenCalledWith(
      { projectId: 'project-1', algorithmId: ALGORITHM.id, minSimilarity: 90, generation: 42 },
      1,
      20,
    );
    await app.close();
  });

  it('propagates an unexpected error as a 500', async () => {
    const { app, cradle } = await buildAuthorizedApp();
    vi.spyOn(cradle.clustersSearch, 'paginate').mockRejectedValue(new Error('boom'));

    const response = await app.inject({
      method: 'GET',
      url: '/duplicates/clusters?recipe=image.phash16',
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(500);
    await app.close();
  });
});

describe('GET /duplicates/ranking', () => {
  it('applies default paging and maps the result to the wire format', async () => {
    const { app, cradle } = await buildAuthorizedApp();
    const paginateRankingSpy = vi.spyOn(cradle.assetHashDuplicatesSearch, 'paginateRanking').mockResolvedValue(
      buildPage({
        data: [
          {
            identity: new Identity('a1', null),
            duplicateCount: 2,
            matches: [{ identity: new Identity('a2', null), distance: 1, similarity: 99 }],
          },
        ],
        totalCount: 1,
        currentCount: 1,
        currentPage: 1,
        pageSize: 20,
        pageCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      }),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/duplicates/ranking?recipe=image.phash16',
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: [
        {
          identity: { id: 'a1', path: null },
          duplicate_count: 2,
          matches: [{ identity: { id: 'a2', path: null }, distance: 1, similarity: 99 }],
        },
      ],
      total_count: 1,
      current_count: 1,
      current_page: 1,
      page_size: 20,
      page_count: 1,
      has_next_page: false,
      has_previous_page: false,
    });
    expect(paginateRankingSpy).toHaveBeenCalledWith(expect.anything(), 1, 20);
    await app.close();
  });

  it('passes id/path query params through as an id/path filter', async () => {
    const { app, cradle } = await buildAuthorizedApp();
    const paginateRankingSpy = vi.spyOn(cradle.assetHashDuplicatesSearch, 'paginateRanking').mockResolvedValue(
      buildPage({
        data: [],
        totalCount: 0,
        currentCount: 0,
        currentPage: 1,
        pageSize: 20,
        pageCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      }),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/duplicates/ranking?recipe=image.phash16&id=a1&path=%2Ainvoice%2A',
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
    expect(paginateRankingSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1', path: '*invoice*' }), 1, 20);
    await app.close();
  });

  it('rejects a page_size above the maximum allowed', async () => {
    const { app, cradle } = await buildAuthorizedApp();
    const paginateRankingSpy = vi.spyOn(cradle.assetHashDuplicatesSearch, 'paginateRanking');

    const response = await app.inject({
      method: 'GET',
      url: '/duplicates/ranking?recipe=image.phash16&page_size=500',
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(400);
    expect(paginateRankingSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it('passes match_limit through to the search repository when provided', async () => {
    const { app, cradle } = await buildAuthorizedApp();
    const paginateRankingSpy = vi.spyOn(cradle.assetHashDuplicatesSearch, 'paginateRanking').mockResolvedValue(
      buildPage({
        data: [],
        totalCount: 0,
        currentCount: 0,
        currentPage: 1,
        pageSize: 0,
        pageCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      }),
    );

    await app.inject({
      method: 'GET',
      url: '/duplicates/ranking?recipe=image.phash16&match_limit=3',
      headers: AUTH_HEADER,
    });

    expect(paginateRankingSpy).toHaveBeenCalledWith(
      expect.objectContaining({ matchLimit: 3 }),
      expect.anything(),
      expect.anything(),
    );
    await app.close();
  });

  it('omits matchLimit from the search query when not provided', async () => {
    const { app, cradle } = await buildAuthorizedApp();
    const paginateRankingSpy = vi.spyOn(cradle.assetHashDuplicatesSearch, 'paginateRanking').mockResolvedValue(
      buildPage({
        data: [],
        totalCount: 0,
        currentCount: 0,
        currentPage: 1,
        pageSize: 0,
        pageCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      }),
    );

    await app.inject({ method: 'GET', url: '/duplicates/ranking?recipe=image.phash16', headers: AUTH_HEADER });

    expect(paginateRankingSpy.mock.calls[0]?.[0]).not.toHaveProperty('matchLimit');
    await app.close();
  });

  it('rejects an invalid (non-positive) page', async () => {
    const { app } = await buildAuthorizedApp();

    const response = await app.inject({
      method: 'GET',
      url: '/duplicates/ranking?recipe=image.phash16&page=0',
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
