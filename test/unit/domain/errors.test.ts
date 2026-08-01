import { describe, it, expect } from 'vitest';
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
} from '../../../src/domain/errors.js';
import { Identity } from '../../../src/domain/model/asset.model.js';

describe('domain errors', () => {
  it.each([
    ['UnauthorizedError', UnauthorizedError.invalidApiKey()],
    ['ForbiddenError', ForbiddenError.missingScope('assets:read')],
    ['ValidationError', ValidationError.recipesEmpty()],
    ['CoreUnavailableError', CoreUnavailableError.emptyHashResponse()],
    ['AssetProcessingError', AssetProcessingError.fromCore('corrupt file')],
    ['NotFoundError', NotFoundError.asset(new Identity('a1', null))],
    ['AlreadyExistsError', AlreadyExistsError.project('demo')],
    ['AlgorithmContractError', AlgorithmContractError.recipeNotReportedByCore('image.phash16')],
    ['UnsupportedRecipeError', UnsupportedRecipeError.vectorRecipe('image.embedding')],
  ])('%s sets name and is an Error instance', (name, err) => {
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe(name);
  });

  it('UnauthorizedError.invalidApiKey formats its message', () => {
    expect(UnauthorizedError.invalidApiKey().message).toBe('invalid or revoked API key');
  });

  it('ForbiddenError.missingScope includes the missing scope', () => {
    expect(ForbiddenError.missingScope('assets:write').message).toBe(
      "this API key does not have the 'assets:write' scope",
    );
  });

  it('ValidationError.tooManyDuplicateEdges includes the edge count', () => {
    const err = ValidationError.tooManyDuplicateEdges(250_000);

    expect(err.name).toBe('ValidationError');
    expect(err.message).toContain('250000');
    expect(err.message).toContain('/duplicates/ranking');
  });

  it('ValidationError.clusterComputationDidNotConverge includes the algorithm id and threshold', () => {
    const err = ValidationError.clusterComputationDidNotConverge(3, 90);

    expect(err.name).toBe('ValidationError');
    expect(err.message).toContain('algorithm 3');
    expect(err.message).toContain('90%');
  });

  it('ValidationError.clusterGenerationExpired includes the generation number', () => {
    const err = ValidationError.clusterGenerationExpired(42);

    expect(err.name).toBe('ValidationError');
    expect(err.message).toContain('generation 42');
  });

  it('ValidationError.identityEmpty explains the invariant', () => {
    expect(ValidationError.identityEmpty().message).toBe('identity must have at least one of id or path set');
  });

  it.each([
    [new Identity('a1', null), "asset 'id=a1' not found"],
    [new Identity(null, 'photos/1.jpg'), "asset 'path=photos/1.jpg' not found"],
    [new Identity('a1', 'photos/1.jpg'), "asset 'id=a1, path=photos/1.jpg' not found"],
  ] satisfies [Identity, string][])('NotFoundError.asset formats %o as %s', (identity, expected) => {
    expect(NotFoundError.asset(identity).message).toBe(expected);
  });

  it.each([
    [new Identity('a1', null), "identity 'id=a1' matches two different existing assets (one via id, another via path)"],
    [
      new Identity('a1', 'photos/1.jpg'),
      "identity 'id=a1, path=photos/1.jpg' matches two different existing assets (one via id, another via path)",
    ],
  ] satisfies [Identity, string][])('AlreadyExistsError.asset formats %o as %s', (identity, expected) => {
    expect(AlreadyExistsError.asset(identity).message).toBe(expected);
  });
});
