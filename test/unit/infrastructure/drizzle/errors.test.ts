import { describe, it, expect } from 'vitest';
import { isUniqueError } from '../../../../src/infrastructure/drizzle/errors.js';

describe('isUniqueError', () => {
  it('returns true for an error with SQLSTATE 23505', () => {
    const err = Object.assign(new Error('duplicate key'), { code: '23505' });

    expect(isUniqueError(err)).toBe(true);
  });

  it('returns true when the 23505 code is on a wrapped .cause', () => {
    const inner = Object.assign(new Error('duplicate key'), { code: '23505' });
    const outer = new Error('query failed', { cause: inner });

    expect(isUniqueError(outer)).toBe(true);
  });

  it('returns false for an unrelated Postgres error code', () => {
    const err = Object.assign(new Error('not null violation'), { code: '23502' });

    expect(isUniqueError(err)).toBe(false);
  });

  it('returns false for a plain Error with no code', () => {
    expect(isUniqueError(new Error('boom'))).toBe(false);
  });

  it('returns false for a non-Error value', () => {
    expect(isUniqueError('not an error')).toBe(false);
    expect(isUniqueError(null)).toBe(false);
    expect(isUniqueError(undefined)).toBe(false);
  });

  it('stops walking .cause once it reaches a non-Error value', () => {
    const outer = new Error('query failed', { cause: 'not an error' });

    expect(isUniqueError(outer)).toBe(false);
  });
});
