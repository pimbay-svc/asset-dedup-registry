/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { CoreHasher, CoreHashResult, CoreAlgorithm } from '../../domain/provider/hasher.provider.js';
import {
  CoreUnavailableError,
  AssetProcessingError,
  ValidationError,
  UnsupportedRecipeError,
} from '../../domain/errors.js';
import type { MimeHint } from '../../domain/model/asset.model.js';

interface CoreHashResultWire {
  recipe: string;
  hashes?: string[];
  vectors?: number[][];
}

interface CoreHashResponseBody {
  results?: CoreHashResultWire[];
}

interface CoreAlgorithmsResponseBody {
  algorithms?: CoreAlgorithm[];
}

interface CoreErrorBody {
  error?: string;
}

interface AlgorithmsCacheEntry {
  value: CoreAlgorithm[];
  expiresAt: number;
}

export class CoreClient implements CoreHasher {
  private algorithmsCache: AlgorithmsCacheEntry | null = null;
  private algorithmsPending: Promise<CoreAlgorithm[]> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly algorithmsCacheTtlMs: number = 5 * 60_000,
  ) {}

  async hash(mimeHint: MimeHint, fileContentBase64: string, recipes: string[] | null): Promise<CoreHashResult[]> {
    // `recipes` must always be present in the body, even when null (api.md's POST /hash contract).
    const body = await this.request<CoreHashResponseBody>('/hash', {
      method: 'POST',
      body: JSON.stringify({
        mime_hint: { type: mimeHint.type, value: mimeHint.value },
        file_content: fileContentBase64,
        recipes,
      }),
    });

    if (!body.results || body.results.length === 0) {
      throw CoreUnavailableError.emptyHashResponse();
    }

    return body.results.map((result) => this.normalizeHashResult(result));
  }

  async listAlgorithms(): Promise<CoreAlgorithm[]> {
    if (this.algorithmsCache && this.algorithmsCache.expiresAt > Date.now()) {
      return this.algorithmsCache.value;
    }

    if (this.algorithmsPending) {
      return this.algorithmsPending;
    }

    const promise = this.fetchAlgorithms()
      .then((value) => {
        this.algorithmsCache = { value, expiresAt: Date.now() + this.algorithmsCacheTtlMs };

        return value;
      })
      .finally(() => {
        this.algorithmsPending = null;
      });

    this.algorithmsPending = promise;

    return promise;
  }

  private normalizeHashResult(result: CoreHashResultWire): CoreHashResult {
    if (result.vectors !== undefined) {
      throw UnsupportedRecipeError.vectorRecipe(result.recipe);
    }
    if (result.hashes !== undefined) {
      return { recipe: result.recipe, hashes: result.hashes };
    }

    throw CoreUnavailableError.malformedHashResult(result.recipe);
  }

  private async fetchAlgorithms(): Promise<CoreAlgorithm[]> {
    const body = await this.request<CoreAlgorithmsResponseBody>('/algorithms', { method: 'GET' });

    if (!body.algorithms) {
      throw CoreUnavailableError.incompleteAlgorithmsResponse();
    }

    return body.algorithms;
  }

  private async request<T>(path: string, init: { method: string; body?: string }): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: init.method,
        ...(init.body !== undefined && { headers: { 'content-type': 'application/json' }, body: init.body }),
        signal: controller.signal,
      });

      if (!response.ok) {
        await this.throwForStatus(response);
      }

      return (await response.json()) as T;
    } catch (err) {
      if (
        err instanceof CoreUnavailableError ||
        err instanceof AssetProcessingError ||
        err instanceof ValidationError ||
        err instanceof UnsupportedRecipeError
      ) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw CoreUnavailableError.unreachable(message);
    } finally {
      clearTimeout(timer);
    }
  }

  private async throwForStatus(response: Response): Promise<never> {
    const body = (await response.json().catch(() => ({}))) as CoreErrorBody;
    const message = body.error ?? `core responded with status ${String(response.status)}`;

    // 422: core rejected this specific asset (corrupt file, subservice item error) — fail-closed,
    // distinct from "core is unreachable" (502) since it's not a transient/infra problem.
    if (response.status === 422) {
      throw AssetProcessingError.fromCore(message);
    }
    // 400: our own request was malformed (e.g. an unknown recipe, or mime_hint contradicting the
    // sniffed content), surfaced as a ValidationError rather than swallowed into a generic 502.
    if (response.status === 400) {
      throw ValidationError.fromCore(message);
    }

    throw CoreUnavailableError.fromCoreResponse(message);
  }
}
