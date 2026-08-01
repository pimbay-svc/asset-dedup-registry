import { describe, it, expect, vi } from 'vitest';
import { buildHttpServer } from '../../../../../src/presentation/http/server.js';
import { buildFakeCradle } from '../../../../helpers/fakeCradle.js';
import { ApiScope } from '../../../../../src/domain/model/apiClient.model.js';
import { sha256Hex } from '../../../../../src/infrastructure/crypto/credentials.js';
import type { ApiClient } from '../../../../../src/domain/model/model.js';
import type { ProjectStatsSummary } from '../../../../../src/application/service/projectStats.service.js';

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

const SUMMARY: ProjectStatsSummary = {
  project: { slug: 'shop-prod', name: 'Shop Production' },
  totalAssets: 1204,
  assetsPerRecipe: [
    { recipe: 'binary.sha256', assetCount: 1204 },
    { recipe: 'image.phash16', assetCount: 980 },
  ],
  duplicatesPerRecipe: [
    {
      recipe: 'binary.sha256',
      clusterCount: 12,
      edgeCount: 37,
      assetsWithDuplicateCount: 74,
      assetsWithDuplicatePct: 6.14,
      degraded: false,
    },
    {
      recipe: 'image.phash16',
      clusterCount: null,
      edgeCount: null,
      assetsWithDuplicateCount: null,
      assetsWithDuplicatePct: null,
      degraded: true,
    },
  ],
  lastAssetAddedAt: new Date('2026-08-05T14:32:00Z'),
  assetsAddedLast7d: 41,
  assetsAddedLast30d: 213,
};

const AUTH_HEADER = { authorization: `Bearer ${RAW_KEY}` };

describe('GET /stats', () => {
  it('requires the assets:read scope', async () => {
    const app = await buildHttpServer(buildFakeCradle());

    const response = await app.inject({ method: 'GET', url: '/stats' });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('resolves the project from the API key and maps the summary to the wire format', async () => {
    const cradle = buildFakeCradle();
    vi.spyOn(cradle.apiClients, 'findByKeyHash').mockResolvedValue(authorizedApiClient());
    const getSummarySpy = vi.spyOn(cradle.projectStatsService, 'getSummary').mockResolvedValue(SUMMARY);
    const app = await buildHttpServer(cradle);

    const response = await app.inject({ method: 'GET', url: '/stats', headers: AUTH_HEADER });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      project: { slug: 'shop-prod', name: 'Shop Production' },
      total_assets: 1204,
      assets_per_recipe: [
        { recipe: 'binary.sha256', asset_count: 1204 },
        { recipe: 'image.phash16', asset_count: 980 },
      ],
      duplicates_per_recipe: [
        {
          recipe: 'binary.sha256',
          cluster_count: 12,
          edge_count: 37,
          assets_with_duplicate_count: 74,
          assets_with_duplicate_pct: 6.14,
          degraded: false,
        },
        {
          recipe: 'image.phash16',
          cluster_count: null,
          edge_count: null,
          assets_with_duplicate_count: null,
          assets_with_duplicate_pct: null,
          degraded: true,
        },
      ],
      last_asset_added_at: '2026-08-05T14:32:00.000Z',
      assets_added_last_7d: 41,
      assets_added_last_30d: 213,
    });
    expect(getSummarySpy).toHaveBeenCalledWith('project-1');
    await app.close();
  });

  it('returns null for last_asset_added_at when the project has no assets yet', async () => {
    const cradle = buildFakeCradle();
    (cradle.apiClients.findByKeyHash as ReturnType<typeof vi.fn>).mockResolvedValue(authorizedApiClient());
    (cradle.projectStatsService.getSummary as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...SUMMARY,
      lastAssetAddedAt: null,
    });
    const app = await buildHttpServer(cradle);

    const response = await app.inject({ method: 'GET', url: '/stats', headers: AUTH_HEADER });

    expect(response.json()).toMatchObject({ last_asset_added_at: null });
    await app.close();
  });

  it('propagates a NotFoundError from the service as a 404', async () => {
    const cradle = buildFakeCradle();
    (cradle.apiClients.findByKeyHash as ReturnType<typeof vi.fn>).mockResolvedValue(authorizedApiClient());
    const { NotFoundError } = await import('../../../../../src/domain/errors.js');
    (cradle.projectStatsService.getSummary as ReturnType<typeof vi.fn>).mockRejectedValue(
      NotFoundError.project('project-1'),
    );
    const app = await buildHttpServer(cradle);

    const response = await app.inject({ method: 'GET', url: '/stats', headers: AUTH_HEADER });

    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
