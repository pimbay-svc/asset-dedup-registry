/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import type { Cradle } from '../../../infrastructure/container.js';

interface HealthzQuery {
  deep?: string;
}

const DEEP_CHECK_TIMEOUT_MS = 3000;

export function registerHealthzRoute(app: FastifyInstance, cradle: Cradle): void {
  app.get<{ Querystring: HealthzQuery }>(
    '/healthz',
    {
      schema: {
        security: [],
      },
    },
    async (request, reply) => {
      if (request.query.deep !== 'true') {
        return reply.status(200).send({ status: 'ok' });
      }

      const [dbReachable, coreReachable] = await Promise.all([
        isDatabaseReachable(cradle),
        isCoreReachable(cradle.config.core_base_url),
      ]);

      const allReachable = dbReachable && coreReachable;

      return reply.status(allReachable ? 200 : 503).send({
        status: allReachable ? 'ok' : 'degraded',
        db_reachable: dbReachable,
        core_reachable: coreReachable,
      });
    },
  );
}

async function isDatabaseReachable(cradle: Cradle): Promise<boolean> {
  try {
    await cradle.db.execute(sql`SELECT 1`);

    return true;
  } catch {
    return false;
  }
}

async function isCoreReachable(coreBaseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, DEEP_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(`${coreBaseUrl}/healthz`, { signal: controller.signal });

    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
