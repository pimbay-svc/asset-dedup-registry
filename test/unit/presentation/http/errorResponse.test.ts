import { describe, it, expect, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendErrorResponse } from '../../../../src/presentation/http/errorResponse.js';
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
} from '../../../../src/domain/errors.js';
import { Identity } from '../../../../src/domain/model/asset.model.js';

interface FakeReply {
  reply: FastifyReply;
  statusSpy: MockInstance;
  sendSpy: MockInstance;
}

function buildReply(): FakeReply {
  const reply = { status: vi.fn(), send: vi.fn() } as unknown as FastifyReply;
  const statusSpy = vi.spyOn(reply, 'status').mockReturnValue(reply);
  const sendSpy = vi.spyOn(reply, 'send').mockReturnValue(reply);

  return { reply, statusSpy, sendSpy };
}

interface FakeRequest {
  request: FastifyRequest;
  logErrorSpy: MockInstance;
}

function buildRequest(): FakeRequest {
  const request = { log: { error: vi.fn() } } as unknown as FastifyRequest;
  const logErrorSpy = vi.spyOn(request.log, 'error');

  return { request, logErrorSpy };
}

describe('sendErrorResponse', () => {
  it.each([
    [UnauthorizedError.invalidApiKey(), 401],
    [ForbiddenError.missingScope('assets:read'), 403],
    [ValidationError.recipesEmpty(), 400],
    [NotFoundError.asset(new Identity('a1', null)), 404],
    [AlreadyExistsError.project('demo'), 409],
    [AssetProcessingError.fromCore('corrupt file'), 422],
    [AlgorithmContractError.recipeNotReportedByCore('image.phash16'), 502],
    [UnsupportedRecipeError.vectorRecipe('image.embedding'), 501],
    [CoreUnavailableError.emptyHashResponse(), 502],
  ])('maps %s to status %i', (err, status) => {
    const { reply, statusSpy, sendSpy } = buildReply();
    const { request } = buildRequest();

    sendErrorResponse(request, reply, err);

    expect(statusSpy).toHaveBeenCalledWith(status);
    expect(sendSpy).toHaveBeenCalledWith({ error: err.message });
  });

  it('logs and returns 500 for an unrecognized error', () => {
    const { reply, statusSpy, sendSpy } = buildReply();
    const { request, logErrorSpy } = buildRequest();
    const err = new Error('boom');

    sendErrorResponse(request, reply, err);

    expect(logErrorSpy).toHaveBeenCalledWith({ err }, 'unexpected error');
    expect(statusSpy).toHaveBeenCalledWith(500);
    expect(sendSpy).toHaveBeenCalledWith({ error: 'internal error' });
  });

  it('handles a non-Error thrown value as an unrecognized error', () => {
    const { reply, statusSpy } = buildReply();
    const { request } = buildRequest();

    sendErrorResponse(request, reply, 'a string throw');

    expect(statusSpy).toHaveBeenCalledWith(500);
  });
});
