import { describe, it, expect } from 'vitest';
import { isValidPercentage } from '../../../../src/domain/validation/validation.js';

describe('isValidPercentage', () => {
  it.each([0, 50, 100, 90.5])('accepts %s', (value) => {
    expect(isValidPercentage(value)).toBe(true);
  });

  it.each([-1, 100.001, 101, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('rejects %s', (value) => {
    expect(isValidPercentage(value)).toBe(false);
  });
});
