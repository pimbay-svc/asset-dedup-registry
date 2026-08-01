/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyRequest } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import rateLimit from '@fastify/rate-limit';
import type { Cradle } from '../../infrastructure/container.js';
import { SERVICE_VERSION } from '../../infrastructure/version.js';
import { registerAssetsRoutes } from './route/asset.route.js';
import { registerDuplicatesRoutes } from './route/duplicate.route.js';
import { registerStatsRoutes } from './route/stats.route.js';
import { registerHealthzRoute } from './route/healthz.route.js';
import { sendErrorResponse } from './errorResponse.js';

// Kept generous on purpose — rejecting a valid large asset is worse than a large buffer.
const BODY_LIMIT_BYTES = 100 * 1024 * 1024;

export async function buildHttpServer(cradle: Cradle): Promise<FastifyInstance> {
  const fastify = Fastify<Server, IncomingMessage, ServerResponse>({
    loggerInstance: cradle.logger,
    bodyLimit: BODY_LIMIT_BYTES,
    forceCloseConnections: true,
  });

  await fastify.register(swagger, {
    openapi: {
      info: { title: 'asset-dedup-registry', version: SERVICE_VERSION },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            description: 'API key issued via `asset-dedup-registry-cli api-client create`',
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });
  await fastify.register(swaggerUi, { routePrefix: '/docs' });

  /** `req.projectId` is typed non-optional (set by each route's own `requireScope` preHandler) but is
   * genuinely unset for `/healthz`, which this hook also sees since it's registered globally. Narrowed back
   * to reality just here rather than loosening the type everywhere else it's trusted as always-set. */
  const projectIdOf = (req: FastifyRequest): string | undefined => (req as { projectId?: string }).projectId;

  /**
   * Per-project request throttling — `ProjectRateLimitCache` only resolves *what* the limit is; this counts
   * requests against it and returns 429s. Must register before the routes: the plugin's `onRoute` hook
   * appends its handler to whichever lifecycle array `hook` names, so `hook: 'preHandler'` lands it after
   * `requireScope` (already in that array by registration time) — `req.projectId` is set by the time
   * `keyGenerator`/`max` read it. The plugin's default `onRequest` hook fires before auth and would never
   * see it. `allowList` skips `healthz` (no `requireScope`, nothing to key on, and it shouldn't be throttled).
   */
  await fastify.register(rateLimit, {
    global: true,
    hook: 'preHandler',
    timeWindow: '1 minute',
    keyGenerator: (req) => projectIdOf(req) ?? req.ip,
    max: (req) => cradle.projectRateLimitCache.resolve(req.projectId),
    allowList: (req) => projectIdOf(req) === undefined,
  });

  fastify.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error.validation !== undefined) {
      return reply.status(400).send({ error: error.message });
    }

    return sendErrorResponse(request, reply, error);
  });

  registerAssetsRoutes(fastify, cradle);
  registerDuplicatesRoutes(fastify, cradle);
  registerStatsRoutes(fastify, cradle);
  registerHealthzRoute(fastify, cradle);

  return fastify;
}
