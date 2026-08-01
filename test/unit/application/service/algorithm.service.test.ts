import { describe, it, expect, vi } from 'vitest';
import { AlgorithmService } from '../../../../src/application/service/algorithm.service.js';
import { Comparison } from '../../../../src/domain/model/algorithm.model.js';
import type { Algorithms } from '../../../../src/domain/repo/algorithm.repo.js';
import type { AlgorithmWriter } from '../../../../src/application/writer/algorithm.writer.js';
import type { CoreHasher } from '../../../../src/domain/provider/hasher.provider.js';
import type { Algorithm } from '../../../../src/domain/model/model.js';
import { AlgorithmContractError } from '../../../../src/domain/errors.js';

const EXISTING: Algorithm = { id: 1, recipe: 'binary.sha256', comparison: Comparison.EXACT };
const CREATED: Algorithm = { id: 2, recipe: 'image.phash16', comparison: Comparison.HAMMING };

function buildDeps(
  overrides: {
    algorithms?: Partial<Algorithms>;
    algorithmWriter?: Partial<AlgorithmWriter>;
    coreHasher?: Partial<CoreHasher>;
  } = {},
): { algorithms: Algorithms; algorithmWriter: AlgorithmWriter; coreHasher: CoreHasher } {
  return {
    algorithms: { findByRecipe: vi.fn().mockResolvedValue(null), ...overrides.algorithms },
    algorithmWriter: { add: vi.fn().mockResolvedValue(CREATED), ...overrides.algorithmWriter },
    coreHasher: {
      hash: vi.fn(),
      listAlgorithms: vi.fn().mockResolvedValue([
        { recipe: 'binary.sha256', comparison: Comparison.EXACT },
        { recipe: 'image.phash16', comparison: Comparison.HAMMING },
      ]),
      ...overrides.coreHasher,
    },
  };
}

describe('AlgorithmService.resolveAlgorithm', () => {
  it('creates a new algorithm via the writer when none exists yet', async () => {
    const { algorithms, algorithmWriter, coreHasher } = buildDeps({
      coreHasher: {
        listAlgorithms: vi.fn().mockResolvedValue([{ recipe: 'image.phash16', comparison: Comparison.HAMMING }]),
      },
    });
    const addSpy = vi.spyOn(algorithmWriter, 'add');
    const service = new AlgorithmService(algorithms, algorithmWriter, coreHasher);

    const result = await service.resolveAlgorithm('image.phash16');

    expect(result).toEqual(CREATED);
    expect(addSpy).toHaveBeenCalledWith({ recipe: 'image.phash16', comparison: Comparison.HAMMING });
  });

  it('matches the requested recipe among several core algorithms, not just the first in the list', async () => {
    const { algorithms, algorithmWriter, coreHasher } = buildDeps({
      coreHasher: {
        listAlgorithms: vi.fn().mockResolvedValue([
          { recipe: 'binary.sha256', comparison: Comparison.EXACT },
          { recipe: 'vector.clip', comparison: Comparison.COSINE },
          { recipe: 'image.phash16', comparison: Comparison.HAMMING },
        ]),
      },
    });
    const addSpy = vi.spyOn(algorithmWriter, 'add');
    const service = new AlgorithmService(algorithms, algorithmWriter, coreHasher);

    const result = await service.resolveAlgorithm('image.phash16');

    expect(result).toEqual(CREATED);
    expect(addSpy).toHaveBeenCalledWith({ recipe: 'image.phash16', comparison: Comparison.HAMMING });
  });

  it('returns the existing algorithm when its stored comparison matches core', async () => {
    const { algorithms, algorithmWriter, coreHasher } = buildDeps({
      algorithms: { findByRecipe: vi.fn().mockResolvedValue(EXISTING) },
    });
    const addSpy = vi.spyOn(algorithmWriter, 'add');
    const service = new AlgorithmService(algorithms, algorithmWriter, coreHasher);

    const result = await service.resolveAlgorithm('binary.sha256');

    expect(result).toEqual(EXISTING);
    expect(addSpy).not.toHaveBeenCalled();
  });

  it('throws AlgorithmContractError when core no longer reports the recipe', async () => {
    const { algorithms, algorithmWriter, coreHasher } = buildDeps({
      coreHasher: { listAlgorithms: vi.fn().mockResolvedValue([]) },
    });
    const service = new AlgorithmService(algorithms, algorithmWriter, coreHasher);

    await expect(service.resolveAlgorithm('binary.sha256')).rejects.toThrow(AlgorithmContractError);
    await expect(service.resolveAlgorithm('binary.sha256')).rejects.toThrow(/does not report a recipe named/);
  });

  it('throws AlgorithmContractError when the stored comparison contradicts core', async () => {
    const { algorithms, algorithmWriter, coreHasher } = buildDeps({
      algorithms: { findByRecipe: vi.fn().mockResolvedValue(EXISTING) },
      coreHasher: {
        listAlgorithms: vi.fn().mockResolvedValue([{ recipe: 'binary.sha256', comparison: Comparison.HAMMING }]),
      },
    });
    const service = new AlgorithmService(algorithms, algorithmWriter, coreHasher);

    await expect(service.resolveAlgorithm('binary.sha256')).rejects.toThrow(AlgorithmContractError);
    await expect(service.resolveAlgorithm('binary.sha256')).rejects.toThrow(/now reports recipe/);
  });

  // --- Per-recipe cache (`this.cache`) — spy on `algorithms.findByRecipe`, the first thing
  // `resolveUncached` does with no caching layer in front of it, so it fires exactly once per *actual*
  // (non-short-circuited) resolution — unlike `coreHasher.listAlgorithms`, which has its own independent
  // cache (`coreListCache`) that can mask a broken per-recipe cache by still returning a cached list.

  it('caches a resolved algorithm — a second call for the same recipe does not re-resolve', async () => {
    const { algorithms, algorithmWriter, coreHasher } = buildDeps({
      algorithms: { findByRecipe: vi.fn().mockResolvedValue(EXISTING) },
    });
    const findByRecipeSpy = vi.spyOn(algorithms, 'findByRecipe');
    const service = new AlgorithmService(algorithms, algorithmWriter, coreHasher);

    await service.resolveAlgorithm('binary.sha256');
    await service.resolveAlgorithm('binary.sha256');

    expect(findByRecipeSpy).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent in-flight calls for the same recipe into one resolution', async () => {
    const { algorithms, algorithmWriter, coreHasher } = buildDeps({
      algorithms: { findByRecipe: vi.fn().mockResolvedValue(EXISTING) },
    });
    const findByRecipeSpy = vi.spyOn(algorithms, 'findByRecipe');
    const service = new AlgorithmService(algorithms, algorithmWriter, coreHasher);

    const [firstResult, secondResult] = await Promise.all([
      service.resolveAlgorithm('binary.sha256'),
      service.resolveAlgorithm('binary.sha256'),
    ]);

    expect(firstResult).toEqual(EXISTING);
    expect(secondResult).toEqual(EXISTING);
    expect(findByRecipeSpy).toHaveBeenCalledTimes(1);
  });

  it('expires the per-recipe cache after the given TTL — a later call re-resolves', async () => {
    vi.useFakeTimers();
    const { algorithms, algorithmWriter, coreHasher } = buildDeps({
      algorithms: { findByRecipe: vi.fn().mockResolvedValue(EXISTING) },
    });
    const findByRecipeSpy = vi.spyOn(algorithms, 'findByRecipe');
    const service = new AlgorithmService(algorithms, algorithmWriter, coreHasher, 1000);

    await service.resolveAlgorithm('binary.sha256');
    vi.advanceTimersByTime(2000);
    await service.resolveAlgorithm('binary.sha256');

    expect(findByRecipeSpy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('treats the per-recipe cache as expired at the exact TTL boundary (not one tick early)', async () => {
    vi.useFakeTimers();
    const { algorithms, algorithmWriter, coreHasher } = buildDeps({
      algorithms: { findByRecipe: vi.fn().mockResolvedValue(EXISTING) },
    });
    const findByRecipeSpy = vi.spyOn(algorithms, 'findByRecipe');
    const service = new AlgorithmService(algorithms, algorithmWriter, coreHasher, 1000);

    await service.resolveAlgorithm('binary.sha256');
    vi.advanceTimersByTime(1000);
    await service.resolveAlgorithm('binary.sha256');

    expect(findByRecipeSpy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  // --- Shared core-list cache (`this.coreListCache`) — spy on `coreHasher.listAlgorithms` directly, and
  // use *different* recipes across sequential (not concurrent) calls so the per-recipe cache/pending map
  // never short-circuits and the core-list cache is what's actually being exercised.

  it('reuses the core-list cache across different recipes resolved one after another', async () => {
    const { algorithms, algorithmWriter, coreHasher } = buildDeps();
    const listAlgorithmsSpy = vi.spyOn(coreHasher, 'listAlgorithms');
    const service = new AlgorithmService(algorithms, algorithmWriter, coreHasher);

    await service.resolveAlgorithm('binary.sha256');
    await service.resolveAlgorithm('image.phash16');

    expect(listAlgorithmsSpy).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent in-flight calls for different recipes into one core-list fetch', async () => {
    const { algorithms, algorithmWriter, coreHasher } = buildDeps();
    const listAlgorithmsSpy = vi.spyOn(coreHasher, 'listAlgorithms');
    const service = new AlgorithmService(algorithms, algorithmWriter, coreHasher);

    await Promise.all([service.resolveAlgorithm('binary.sha256'), service.resolveAlgorithm('image.phash16')]);

    // two distinct recipes, so the per-recipe `pending` cache doesn't coalesce them — only the shared
    // core-list fetch (`coreListPending`) does.
    expect(listAlgorithmsSpy).toHaveBeenCalledTimes(1);
  });

  it('expires the core-list cache after the given TTL — a later call re-fetches from core', async () => {
    vi.useFakeTimers();
    const { algorithms, algorithmWriter, coreHasher } = buildDeps();
    const listAlgorithmsSpy = vi.spyOn(coreHasher, 'listAlgorithms');
    const service = new AlgorithmService(algorithms, algorithmWriter, coreHasher, 1000);

    await service.resolveAlgorithm('binary.sha256');
    vi.advanceTimersByTime(2000);
    await service.resolveAlgorithm('image.phash16');

    expect(listAlgorithmsSpy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('treats the core-list cache as expired at the exact TTL boundary (not one tick early)', async () => {
    vi.useFakeTimers();
    const { algorithms, algorithmWriter, coreHasher } = buildDeps();
    const listAlgorithmsSpy = vi.spyOn(coreHasher, 'listAlgorithms');
    const service = new AlgorithmService(algorithms, algorithmWriter, coreHasher, 1000);

    await service.resolveAlgorithm('binary.sha256');
    vi.advanceTimersByTime(1000);
    await service.resolveAlgorithm('image.phash16');

    expect(listAlgorithmsSpy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
