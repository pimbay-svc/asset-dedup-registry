import { describe, it, expect, vi } from 'vitest';
import { ScopeResolver } from '../../../src/presentation/scopeResolver.js';
import { Comparison } from '../../../src/domain/model/algorithm.model.js';
import type { Projects } from '../../../src/domain/repo/project.repo.js';
import type { Algorithms } from '../../../src/domain/repo/algorithm.repo.js';
import type { Project, Algorithm } from '../../../src/domain/model/model.js';
import type { Config } from '../../../src/infrastructure/config/types.js';
import { NotFoundError, ValidationError } from '../../../src/domain/errors.js';

const CONFIG: Config = {
  core_base_url: 'http://core:3000',
  core_timeout_ms: 5000,
  default_hamming_threshold: 90,
  default_rate_limit_per_minute: 300,
  database: { pool_size: 5 },
};

const PROJECT: Project = {
  id: 'p1',
  slug: 'demo',
  name: 'Demo',
  recipes: ['binary.sha256', 'image.phash16'],
  hammingThreshold: null,
  rateLimitPerMinute: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const HAMMING_ALGORITHM: Algorithm = { id: 2, recipe: 'image.phash16', comparison: Comparison.HAMMING };
const EXACT_ALGORITHM: Algorithm = { id: 1, recipe: 'binary.sha256', comparison: Comparison.EXACT };

function buildResolver(
  overrides: { projects?: Partial<Projects>; algorithms?: Partial<Algorithms> } = {},
): ScopeResolver {
  const projects: Projects = {
    findById: vi.fn().mockResolvedValue(PROJECT),
    findBySlug: vi.fn(),
    getBySlug: vi.fn(),
    list: vi.fn(),
    ...overrides.projects,
  };
  const algorithms: Algorithms = {
    findByRecipe: vi.fn().mockResolvedValue(HAMMING_ALGORITHM),
    ...overrides.algorithms,
  };

  return new ScopeResolver(projects, algorithms, CONFIG);
}

describe('ScopeResolver.resolveRecipeScope', () => {
  it('resolves the project and algorithm for a configured recipe', async () => {
    const resolver = buildResolver();

    await expect(resolver.resolveRecipeScope('p1', 'image.phash16')).resolves.toEqual({
      project: PROJECT,
      algorithm: HAMMING_ALGORITHM,
    });
  });

  it('throws NotFoundError when the project does not exist', async () => {
    const resolver = buildResolver({ projects: { findById: vi.fn().mockResolvedValue(null) } });

    await expect(resolver.resolveRecipeScope('missing', 'image.phash16')).rejects.toThrow(NotFoundError);
  });

  it('throws ValidationError when the recipe is not configured for the project', async () => {
    const resolver = buildResolver();

    await expect(resolver.resolveRecipeScope('p1', 'video.something')).rejects.toThrow(
      /not configured for this project/,
    );
  });

  it('throws ValidationError when the recipe has never been used to hash any asset', async () => {
    const resolver = buildResolver({ algorithms: { findByRecipe: vi.fn().mockResolvedValue(null) } });

    await expect(resolver.resolveRecipeScope('p1', 'image.phash16')).rejects.toThrow(
      /has not been used to hash any asset/,
    );
  });
});

describe('ScopeResolver.resolveDuplicateScope', () => {
  it('uses the project hammingThreshold when raw is undefined and it is set', async () => {
    const resolver = buildResolver({
      projects: { findById: vi.fn().mockResolvedValue({ ...PROJECT, hammingThreshold: 95 }) },
    });

    const result = await resolver.resolveDuplicateScope('p1', 'image.phash16', undefined);

    expect(result.minSimilarity).toBe(95);
  });

  it('falls back to the config default when raw is undefined and project hammingThreshold is null', async () => {
    const resolver = buildResolver();

    const result = await resolver.resolveDuplicateScope('p1', 'image.phash16', undefined);

    expect(result.minSimilarity).toBe(90);
  });

  it('parses a valid raw threshold, overriding the fallback', async () => {
    const resolver = buildResolver();

    const result = await resolver.resolveDuplicateScope('p1', 'image.phash16', '42.5');

    expect(result.minSimilarity).toBe(42.5);
  });

  it('rejects an out-of-range threshold', async () => {
    const resolver = buildResolver();

    await expect(resolver.resolveDuplicateScope('p1', 'image.phash16', '101')).rejects.toThrow(ValidationError);
  });

  it('flags thresholdIgnored when an explicit threshold is given for an exact-comparison recipe', async () => {
    const resolver = buildResolver({ algorithms: { findByRecipe: vi.fn().mockResolvedValue(EXACT_ALGORITHM) } });

    const result = await resolver.resolveDuplicateScope('p1', 'binary.sha256', '80');

    expect(result.thresholdIgnored).toBe(true);
    expect(result.minSimilarity).toBe(80);
  });

  it('does not flag thresholdIgnored for a hamming-comparison recipe', async () => {
    const resolver = buildResolver();

    const result = await resolver.resolveDuplicateScope('p1', 'image.phash16', '80');

    expect(result.thresholdIgnored).toBe(false);
  });

  it('does not flag thresholdIgnored when no explicit threshold was given, even for exact', async () => {
    const resolver = buildResolver({ algorithms: { findByRecipe: vi.fn().mockResolvedValue(EXACT_ALGORITHM) } });

    const result = await resolver.resolveDuplicateScope('p1', 'binary.sha256', undefined);

    expect(result.thresholdIgnored).toBe(false);
  });
});
