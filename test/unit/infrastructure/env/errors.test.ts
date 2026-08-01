import { describe, it, expect } from 'vitest';
import { EnvError } from '../../../../src/infrastructure/env/errors.js';

describe('EnvError', () => {
  it('is an Error subclass carrying the formatted message and its own name', () => {
    const err = EnvError.invalidConfiguration('PORT: Expected number, received string');

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('invalid environment configuration:\nPORT: Expected number, received string');
    expect(err.name).toBe('EnvError');
  });
});
