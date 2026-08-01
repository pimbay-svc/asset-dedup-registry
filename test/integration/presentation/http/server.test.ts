import { describe, it, expect, type vi } from 'vitest';
import { buildHttpServer } from '../../../../src/presentation/http/server.js';
import { buildFakeCradle } from '../../../helpers/fakeCradle.js';

describe('server-level error handler', () => {
  it('maps an unexpected error escaping a preHandler (outside any route try/catch) to a 500', async () => {
    const cradle = buildFakeCradle();
    // requireScope() awaits apiClients.findByKeyHash() with no try/catch of its own — a rejection
    // here propagates past the route's own error handling straight into Fastify's global handler.
    (cradle.apiClients.findByKeyHash as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('unexpected db failure'));
    const app = await buildHttpServer(cradle);

    const response = await app.inject({
      method: 'GET',
      url: '/duplicates/matches?id=a1&recipe=image.phash16',
      headers: { authorization: 'Bearer whatever' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'internal error' });

    await app.close();
  });
});
