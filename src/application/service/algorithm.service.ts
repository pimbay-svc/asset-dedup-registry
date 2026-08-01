/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { Algorithms } from '../../domain/repo/algorithm.repo.js';
import type { AlgorithmWriter } from '../writer/algorithm.writer.js';
import type { CoreHasher, CoreAlgorithm } from '../../domain/provider/hasher.provider.js';
import type { Algorithm } from '../../domain/model/model.js';
import { AlgorithmContractError } from '../../domain/errors.js';

interface CacheEntry {
  algorithm: Algorithm;
  expiresAt: number;
}

interface CoreListCacheEntry {
  algorithms: CoreAlgorithm[];
  expiresAt: number;
}

export class AlgorithmService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<Algorithm>>();

  /** `coreHasher.listAlgorithms()` already reports every recipe core knows about — caching only the one
   * recipe being resolved would mean each *distinct* recipe's first resolve within a TTL window re-fetches
   * the whole list, even though an earlier resolve for another recipe already pulled it in. Caches that
   * list itself, once, so `resolveUncached` answers any recipe from it. */
  private coreListCache: CoreListCacheEntry | null = null;
  private coreListPending: Promise<CoreAlgorithm[]> | null = null;

  constructor(
    private readonly algorithms: Algorithms,
    private readonly algorithmWriter: AlgorithmWriter,
    private readonly coreHasher: CoreHasher,
    private readonly cacheTtlMs: number = 5 * 60_000,
  ) {}

  async resolveAlgorithm(recipe: string): Promise<Algorithm> {
    const cached = this.cache.get(recipe);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.algorithm;
    }

    const inFlight = this.pending.get(recipe);

    if (inFlight) {
      return inFlight;
    }

    const promise = this.resolveUncached(recipe)
      .then((algorithm) => {
        this.cache.set(recipe, { algorithm, expiresAt: Date.now() + this.cacheTtlMs });

        return algorithm;
      })
      .finally(() => {
        this.pending.delete(recipe);
      });

    this.pending.set(recipe, promise);

    return promise;
  }

  private async resolveUncached(recipe: string): Promise<Algorithm> {
    const existing = await this.algorithms.findByRecipe(recipe);
    const coreAlgorithms = await this.listCoreAlgorithms();
    const coreAlgorithm = coreAlgorithms.find((algorithm) => algorithm.recipe === recipe);

    if (!coreAlgorithm) {
      throw AlgorithmContractError.recipeNotReportedByCore(recipe);
    }

    if (existing) {
      if (existing.comparison !== coreAlgorithm.comparison) {
        throw AlgorithmContractError.comparisonMismatch(recipe, coreAlgorithm.comparison, existing.comparison);
      }

      return existing;
    }

    return this.algorithmWriter.add({ recipe, comparison: coreAlgorithm.comparison });
  }

  /** Same cache/in-flight-coalescing shape as `resolveAlgorithm` above, just keyed on nothing (one list,
   * not one per recipe) since there's only ever one `listAlgorithms()` result to share. */
  private async listCoreAlgorithms(): Promise<CoreAlgorithm[]> {
    if (this.coreListCache && this.coreListCache.expiresAt > Date.now()) {
      return this.coreListCache.algorithms;
    }

    if (this.coreListPending) {
      return this.coreListPending;
    }

    const promise = this.coreHasher
      .listAlgorithms()
      .then((algorithms) => {
        this.coreListCache = { algorithms, expiresAt: Date.now() + this.cacheTtlMs };

        return algorithms;
      })
      .finally(() => {
        this.coreListPending = null;
      });

    this.coreListPending = promise;

    return promise;
  }
}
