/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { FastifyRequest } from 'fastify';
import type { ApiClients } from '../../domain/repo/apiClient.repo.js';
import type { ApiClient } from '../../domain/model/model.js';
import type { ApiScope } from '../../domain/model/apiClient.model.js';
import { hasScope } from '../../domain/validation/apiScope.validation.js';
import { sha256Hex } from '../../infrastructure/crypto/credentials.js';
import { UnauthorizedError, ForbiddenError } from '../../domain/errors.js';

// Augment Fastify request to carry the authenticated context
declare module 'fastify' {
  interface FastifyRequest {
    apiClient: ApiClient;
    projectId: string;
  }
}

export function requireScope(apiClients: ApiClients, scope: ApiScope): (req: FastifyRequest) => Promise<void> {
  return async function authPreHandler(req: FastifyRequest): Promise<void> {
    const authHeader = req.headers.authorization;

    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      throw UnauthorizedError.missingAuthorizationHeader();
    }

    const rawKey = authHeader.slice('Bearer '.length).trim();

    if (rawKey.length === 0) {
      throw UnauthorizedError.emptyApiKey();
    }

    const apiClient = await apiClients.findByKeyHash(sha256Hex(rawKey));

    if (apiClient === null) {
      throw UnauthorizedError.invalidApiKey();
    }

    if (!hasScope(apiClient, scope)) {
      throw ForbiddenError.missingScope(scope);
    }

    req.apiClient = apiClient;
    req.projectId = apiClient.projectId;
  };
}
