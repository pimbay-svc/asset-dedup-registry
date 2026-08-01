import { randomUUID, randomBytes } from 'node:crypto';
import type { DbClient } from '../../src/infrastructure/drizzle/client.js';
import type { Project, ApiClient, Algorithm, Asset } from '../../src/domain/model/model.js';
import { ApiScope } from '../../src/domain/model/apiClient.model.js';
import { Comparison } from '../../src/domain/model/algorithm.model.js';
import { DrizzleProjectRepository } from '../../src/infrastructure/drizzle/repository/project.repository.js';
import { DrizzleApiClientRepository } from '../../src/infrastructure/drizzle/repository/apiClient.repository.js';
import { DrizzleAlgorithmRepository } from '../../src/infrastructure/drizzle/repository/algorithm.repository.js';
import { DrizzleAssetRepository } from '../../src/infrastructure/drizzle/repository/asset.repository.js';
import { DrizzleAssetHashRepository } from '../../src/infrastructure/drizzle/repository/asset.hash.repository.js';
import { sha256Hex } from '../../src/infrastructure/crypto/credentials.js';

// ─── Project ──────────────────────────────────────────────────────────────────

export async function makeProject(
  db: DbClient,
  opts: { slug?: string; name?: string; recipes?: string[]; hammingThreshold?: number | null } = {},
): Promise<Project> {
  return new DrizzleProjectRepository(db).create({
    slug: opts.slug ?? `proj-${randomUUID()}`,
    name: opts.name ?? 'Test Project',
    recipes: opts.recipes ?? ['binary.sha256'],
    hammingThreshold: opts.hammingThreshold ?? null,
  });
}

// ─── ApiClient ────────────────────────────────────────────────────────────────

export async function makeApiClient(
  db: DbClient,
  projectId: string,
  opts: { name?: string; scopes?: ApiScope[] } = {},
): Promise<{ apiClient: ApiClient; rawKey: string }> {
  const rawKey = randomUUID();
  const apiClient = await new DrizzleApiClientRepository(db).create({
    projectId,
    name: opts.name ?? `client-${randomUUID()}`,
    keyHash: sha256Hex(rawKey),
    scopes: opts.scopes ?? [ApiScope.ASSETS_READ, ApiScope.ASSETS_WRITE],
  });

  return { apiClient, rawKey };
}

// ─── Algorithm ────────────────────────────────────────────────────────────────

export async function makeAlgorithm(
  db: DbClient,
  opts: { recipe?: string; comparison?: Comparison } = {},
): Promise<Algorithm> {
  return new DrizzleAlgorithmRepository(db).add({
    recipe: opts.recipe ?? `image.phash16-${randomUUID()}`,
    comparison: opts.comparison ?? Comparison.HAMMING,
  });
}

// ─── Asset ────────────────────────────────────────────────────────────────────

export async function makeAsset(db: DbClient, projectId: string, identity?: string): Promise<Asset> {
  const repo = new DrizzleAssetRepository(db);
  const created = await repo.create({
    projectId,
    identityId: identity ?? `asset-${randomUUID()}`,
    identityPath: null,
  });

  return repo.getByIdentity(projectId, created.identity);
}

// ─── AssetHash ────────────────────────────────────────────────────────────────

/** 4 bits per hex char — pass e.g. bitLength=64 for a 16-char hash. */
export function randomHexHash(bitLength = 64): string {
  return randomBytes(Math.ceil(bitLength / 8))
    .toString('hex')
    .slice(0, bitLength / 4);
}

export async function makeAssetHash(
  db: DbClient,
  assetId: string,
  algorithmId: number,
  opts: { hashes?: string[] } = {},
): Promise<void> {
  await new DrizzleAssetHashRepository(db).replaceAll(assetId, algorithmId, opts.hashes ?? [randomHexHash()]);
}
