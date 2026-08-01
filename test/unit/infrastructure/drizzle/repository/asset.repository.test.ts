import { describe, it, expect } from 'vitest';
import { resolveField } from '../../../../../src/infrastructure/drizzle/repository/asset.repository.js';

describe('resolveField', () => {
  it('keeps the previous value when raw is null (field not sent)', () => {
    expect(resolveField(null, 'previous-value')).toBe('previous-value');
  });

  it('keeps null as the previous value when raw is null and there was no previous value', () => {
    expect(resolveField(null, null)).toBeNull();
  });

  it('clears the field to null when raw is an explicit empty string, regardless of the previous value', () => {
    expect(resolveField('', 'previous-value')).toBeNull();
  });

  it('replaces the previous value with raw when raw is a non-empty string', () => {
    expect(resolveField('new-value', 'previous-value')).toBe('new-value');
  });
});
