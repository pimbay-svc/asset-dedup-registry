import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildHttpServer } from '../../../../../src/presentation/http/server.js';
import { buildFakeCradle } from '../../../../helpers/fakeCradle.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('GET /healthz', () => {
  it('returns 200 ok for a shallow check, without touching the db or core', async () => {
    const cradle = buildFakeCradle();
    const executeSpy = vi.spyOn(cradle.db, 'execute');
    const app = await buildHttpServer(cradle);

    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(executeSpy).not.toHaveBeenCalled();

    await app.close();
  });

  it('returns 200 with reachability details for a deep check when both dependencies are up', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    const cradle = buildFakeCradle();
    const app = await buildHttpServer(cradle);

    const response = await app.inject({ method: 'GET', url: '/healthz?deep=true' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', db_reachable: true, core_reachable: true });

    await app.close();
  });

  it('returns 503 degraded when the database is unreachable', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    const cradle = buildFakeCradle();
    (cradle.db.execute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('connection refused'));
    const app = await buildHttpServer(cradle);

    const response = await app.inject({ method: 'GET', url: '/healthz?deep=true' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'degraded', db_reachable: false, core_reachable: true });

    await app.close();
  });

  it('returns 503 degraded when core is unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const cradle = buildFakeCradle();
    const app = await buildHttpServer(cradle);

    const response = await app.inject({ method: 'GET', url: '/healthz?deep=true' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 'degraded', core_reachable: false });

    await app.close();
  });

  it('returns 503 degraded when core does not respond before the timeout', async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn().mockImplementation(
      (_url: string, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            reject(new Error('The operation was aborted'));
          });
        }),
    );
    const cradle = buildFakeCradle();
    const app = await buildHttpServer(cradle);

    const responsePromise = app.inject({ method: 'GET', url: '/healthz?deep=true' });
    await vi.advanceTimersByTimeAsync(3000);
    const response = await responsePromise;

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 'degraded', core_reachable: false });

    vi.useRealTimers();
    await app.close();
  });
});
