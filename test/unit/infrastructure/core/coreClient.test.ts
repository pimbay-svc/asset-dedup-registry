import { describe, it, expect, vi, afterEach } from 'vitest';
import { CoreClient } from '../../../../src/infrastructure/core/coreClient.js';
import { MimeHintType } from '../../../../src/domain/model/asset.model.js';
import { Comparison } from '../../../../src/domain/model/algorithm.model.js';
import {
  CoreUnavailableError,
  AssetProcessingError,
  ValidationError,
  UnsupportedRecipeError,
} from '../../../../src/domain/errors.js';

const originalFetch = global.fetch;
const MIME_HINT = { type: MimeHintType.MIME, value: 'image/jpeg' };

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function mockFetchOnce(response: Partial<Response> & { json?: () => Promise<unknown> }): void {
  global.fetch = vi.fn().mockResolvedValue(response);
}

describe('CoreClient.hash', () => {
  it('returns normalized results and sends mime_hint/file_content/recipes in the body', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ results: [{ recipe: 'binary.sha256', hashes: ['abc123'] }] }),
    });

    const client = new CoreClient('http://core:3000', 5000);
    const result = await client.hash(MIME_HINT, 'ZmFrZQ==', ['binary.sha256']);

    expect(result).toEqual([{ recipe: 'binary.sha256', hashes: ['abc123'] }]);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://core:3000/hash',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mime_hint: MIME_HINT, file_content: 'ZmFrZQ==', recipes: ['binary.sha256'] }),
      }),
    );
  });

  it('clears the abort timer once the request settles (success path)', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ results: [{ recipe: 'binary.sha256', hashes: ['abc123'] }] }),
    });
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    const client = new CoreClient('http://core:3000', 5000);
    await client.hash(MIME_HINT, 'ZmFrZQ==', ['binary.sha256']);

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });

  it('sends recipes: null as-is (not omitted) when no recipes filter is given', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ results: [{ recipe: 'binary.sha256', hashes: ['abc123'] }] }),
    });

    const client = new CoreClient('http://core:3000', 5000);
    await client.hash(MIME_HINT, 'ZmFrZQ==', null);

    expect(global.fetch).toHaveBeenCalledWith(
      'http://core:3000/hash',
      expect.objectContaining({
        body: JSON.stringify({ mime_hint: MIME_HINT, file_content: 'ZmFrZQ==', recipes: null }),
      }),
    );
  });

  it('throws CoreUnavailableError when results is empty', async () => {
    mockFetchOnce({ ok: true, status: 200, json: () => Promise.resolve({ results: [] }) });

    const client = new CoreClient('http://core:3000', 5000);
    await expect(client.hash(MIME_HINT, 'ZmFrZQ==', null)).rejects.toThrow(/empty \/hash response/);
  });

  it('throws UnsupportedRecipeError when a result returns vectors', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ results: [{ recipe: 'image.clip', vectors: [[0.1, 0.2]] }] }),
    });

    const client = new CoreClient('http://core:3000', 5000);
    await expect(client.hash(MIME_HINT, 'ZmFrZQ==', null)).rejects.toThrow(UnsupportedRecipeError);
  });

  it('throws CoreUnavailableError when a result has neither hashes nor vectors', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ results: [{ recipe: 'binary.sha256' }] }),
    });

    const client = new CoreClient('http://core:3000', 5000);
    await expect(client.hash(MIME_HINT, 'ZmFrZQ==', null)).rejects.toThrow(/neither 'hashes' nor 'vectors'/);
  });

  it('throws AssetProcessingError on a 422 response', async () => {
    mockFetchOnce({ ok: false, status: 422, json: () => Promise.resolve({ error: 'corrupt file' }) });

    const client = new CoreClient('http://core:3000', 5000);
    await expect(client.hash(MIME_HINT, 'ZmFrZQ==', null)).rejects.toThrow(AssetProcessingError);
    await expect(client.hash(MIME_HINT, 'ZmFrZQ==', null)).rejects.toThrow(/corrupt file/);
  });

  it('throws ValidationError on a 400 response', async () => {
    mockFetchOnce({ ok: false, status: 400, json: () => Promise.resolve({ error: 'unknown recipe' }) });

    const client = new CoreClient('http://core:3000', 5000);
    await expect(client.hash(MIME_HINT, 'ZmFrZQ==', null)).rejects.toThrow(ValidationError);
  });

  it('throws CoreUnavailableError on any other non-ok status', async () => {
    mockFetchOnce({ ok: false, status: 503, json: () => Promise.resolve({}) });

    const client = new CoreClient('http://core:3000', 5000);
    await expect(client.hash(MIME_HINT, 'ZmFrZQ==', null)).rejects.toThrow(CoreUnavailableError);
    await expect(client.hash(MIME_HINT, 'ZmFrZQ==', null)).rejects.toThrow(/status 503/);
  });

  it('falls back to a generic message when the error body is not valid JSON', async () => {
    mockFetchOnce({ ok: false, status: 503, json: () => Promise.reject(new Error('not json')) });

    const client = new CoreClient('http://core:3000', 5000);
    await expect(client.hash(MIME_HINT, 'ZmFrZQ==', null)).rejects.toThrow(/status 503/);
  });

  it('wraps a network failure as CoreUnavailableError', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const client = new CoreClient('http://core:3000', 5000);
    await expect(client.hash(MIME_HINT, 'ZmFrZQ==', null)).rejects.toThrow(CoreUnavailableError);
    await expect(client.hash(MIME_HINT, 'ZmFrZQ==', null)).rejects.toThrow(/core unreachable: ECONNREFUSED/);
  });

  it('wraps a non-Error rejection as CoreUnavailableError', async () => {
    global.fetch = vi.fn().mockRejectedValue('some string rejection');

    const client = new CoreClient('http://core:3000', 5000);
    await expect(client.hash(MIME_HINT, 'ZmFrZQ==', null)).rejects.toThrow(/core unreachable: some string rejection/);
  });

  it('aborts and reports unavailability once the request exceeds the timeout', async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn().mockImplementation(
      (_url: string, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            reject(new Error('The operation was aborted'));
          });
        }),
    );

    const client = new CoreClient('http://core:3000', 5);
    const pending = client.hash(MIME_HINT, 'ZmFrZQ==', null);
    const assertion = expect(pending).rejects.toThrow(/core unreachable/);

    await vi.advanceTimersByTimeAsync(10);
    await assertion;
  });
});

describe('CoreClient.listAlgorithms', () => {
  it('returns the parsed algorithm list', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ algorithms: [{ recipe: 'binary.sha256', comparison: Comparison.EXACT }] }),
    });

    const client = new CoreClient('http://core:3000', 5000);
    await expect(client.listAlgorithms()).resolves.toEqual([{ recipe: 'binary.sha256', comparison: Comparison.EXACT }]);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://core:3000/algorithms',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('throws CoreUnavailableError when the algorithms field is missing', async () => {
    mockFetchOnce({ ok: true, status: 200, json: () => Promise.resolve({}) });

    const client = new CoreClient('http://core:3000', 5000);
    await expect(client.listAlgorithms()).rejects.toThrow(/incomplete \/algorithms response/);
  });

  it('caches the result within the TTL — a second call does not refetch', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ algorithms: [{ recipe: 'binary.sha256', comparison: Comparison.EXACT }] }),
    });

    const client = new CoreClient('http://core:3000', 5000, 60_000);
    await client.listAlgorithms();
    await client.listAlgorithms();

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent in-flight calls into a single fetch', async () => {
    let resolveFetch!: (value: unknown) => void;
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const client = new CoreClient('http://core:3000', 5000);
    const first = client.listAlgorithms();
    const second = client.listAlgorithms();

    resolveFetch({ ok: true, status: 200, json: () => Promise.resolve({ algorithms: [] }) });
    await Promise.all([first, second]);

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('refetches after the cache TTL expires', async () => {
    vi.useFakeTimers();
    mockFetchOnce({ ok: true, status: 200, json: () => Promise.resolve({ algorithms: [] }) });

    const client = new CoreClient('http://core:3000', 5000, 1000);
    await client.listAlgorithms();

    vi.advanceTimersByTime(2000);
    await client.listAlgorithms();

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('treats the cache as expired at the exact TTL boundary (not one tick early)', async () => {
    vi.useFakeTimers();
    mockFetchOnce({ ok: true, status: 200, json: () => Promise.resolve({ algorithms: [] }) });

    const client = new CoreClient('http://core:3000', 5000, 1000);
    await client.listAlgorithms();

    vi.advanceTimersByTime(1000);
    await client.listAlgorithms();

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('defaults the cache TTL to several minutes — an immediate second call still hits the cache', async () => {
    mockFetchOnce({ ok: true, status: 200, json: () => Promise.resolve({ algorithms: [] }) });

    const client = new CoreClient('http://core:3000', 5000);
    await client.listAlgorithms();
    await client.listAlgorithms();

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
