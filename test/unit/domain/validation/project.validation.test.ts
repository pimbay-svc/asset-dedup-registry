import { describe, it, expect } from 'vitest';
import {
  assertValidRecipes,
  assertValidHammingThreshold,
} from '../../../../src/domain/validation/project.validation.js';
import { ValidationError } from '../../../../src/domain/errors.js';

describe('assertValidRecipes', () => {
  it('accepts a list containing at least one binary.* recipe', () => {
    expect(() => {
      assertValidRecipes(['binary.sha256', 'image.phash16']);
    }).not.toThrow();
  });

  it('rejects an empty list', () => {
    expect(() => {
      assertValidRecipes([]);
    }).toThrow('recipes must contain at least one recipe');
  });

  it('rejects a list with no binary.* recipe', () => {
    expect(() => {
      assertValidRecipes(['image.phash16']);
    }).toThrow(/binary\.\*/);
  });
});

describe('assertValidHammingThreshold', () => {
  it('accepts null (falls back to the config default)', () => {
    expect(() => {
      assertValidHammingThreshold(null);
    }).not.toThrow();
  });

  it('accepts a value within [0, 100]', () => {
    expect(() => {
      assertValidHammingThreshold(0);
    }).not.toThrow();
    expect(() => {
      assertValidHammingThreshold(100);
    }).not.toThrow();
    expect(() => {
      assertValidHammingThreshold(90.5);
    }).not.toThrow();
  });

  it('rejects a value below 0', () => {
    expect(() => {
      assertValidHammingThreshold(-1);
    }).toThrow('hammingThreshold must be a number between 0 and 100');
  });

  it('rejects a value above 100', () => {
    expect(() => {
      assertValidHammingThreshold(101);
    }).toThrow(ValidationError);
  });

  it('rejects NaN', () => {
    expect(() => {
      assertValidHammingThreshold(Number.NaN);
    }).toThrow(ValidationError);
  });

  it('rejects Infinity', () => {
    expect(() => {
      assertValidHammingThreshold(Number.POSITIVE_INFINITY);
    }).toThrow(ValidationError);
  });
});
