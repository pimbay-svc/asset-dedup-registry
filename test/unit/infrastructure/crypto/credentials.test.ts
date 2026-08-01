import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { sha256Hex } from '../../../../src/infrastructure/crypto/credentials.js';

describe('sha256Hex', () => {
  it('matches the reference sha256 hex digest', () => {
    const expected = createHash('sha256').update('hello', 'utf8').digest('hex');
    expect(sha256Hex('hello')).toBe(expected);
  });

  it('is deterministic for the same input', () => {
    expect(sha256Hex('same-input')).toBe(sha256Hex('same-input'));
  });

  it('produces different digests for different inputs', () => {
    expect(sha256Hex('a')).not.toBe(sha256Hex('b'));
  });
});
