/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  CoreUnavailableError,
  AssetProcessingError,
  NotFoundError,
  AlreadyExistsError,
  AlgorithmContractError,
  UnsupportedRecipeError,
} from '../../domain/errors.js';
import { HttpServerMessage } from './messages.js';

export function sendErrorResponse(request: FastifyRequest, reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof UnauthorizedError) {
    return reply.status(401).send({ error: err.message });
  }
  if (err instanceof ForbiddenError) {
    return reply.status(403).send({ error: err.message });
  }
  if (err instanceof ValidationError) {
    return reply.status(400).send({ error: err.message });
  }
  if (err instanceof NotFoundError) {
    return reply.status(404).send({ error: err.message });
  }
  if (err instanceof AlreadyExistsError) {
    return reply.status(409).send({ error: err.message });
  }
  if (err instanceof AssetProcessingError) {
    return reply.status(422).send({ error: err.message });
  }
  if (err instanceof AlgorithmContractError) {
    return reply.status(502).send({ error: err.message });
  }
  if (err instanceof UnsupportedRecipeError) {
    return reply.status(501).send({ error: err.message });
  }
  if (err instanceof CoreUnavailableError) {
    return reply.status(502).send({ error: err.message });
  }

  request.log.error({ err }, HttpServerMessage.UNEXPECTED_ERROR);

  return reply.status(500).send({ error: HttpServerMessage.INTERNAL_ERROR });
}
