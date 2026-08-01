import { describe, it, expect } from 'vitest';
import { Identity } from '../../../../src/domain/model/asset.model.js';
import { ValidationError } from '../../../../src/domain/errors.js';

describe('Identity', () => {
  it('accepts id-only', () => {
    const identity = new Identity('a1', null);

    expect(identity.id).toBe('a1');
    expect(identity.path).toBeNull();
  });

  it('accepts path-only', () => {
    const identity = new Identity(null, 'photos/1.jpg');

    expect(identity.id).toBeNull();
    expect(identity.path).toBe('photos/1.jpg');
  });

  it('accepts both id and path', () => {
    const identity = new Identity('a1', 'photos/1.jpg');

    expect(identity.id).toBe('a1');
    expect(identity.path).toBe('photos/1.jpg');
  });

  it('rejects neither id nor path (both null)', () => {
    expect(() => new Identity(null, null)).toThrow(ValidationError);
    expect(() => new Identity(null, null)).toThrow('identity must have at least one of id or path set');
  });

  it('rejects neither id nor path (both empty strings)', () => {
    expect(() => new Identity('', '')).toThrow(ValidationError);
  });

  it('rejects neither id nor path (mixed null and empty string)', () => {
    expect(() => new Identity(null, '')).toThrow(ValidationError);
    expect(() => new Identity('', null)).toThrow(ValidationError);
  });

  it('accepts an empty string on one side as long as the other side is set, normalizing it to null', () => {
    expect(new Identity('', 'photos/1.jpg')).toEqual({ id: null, path: 'photos/1.jpg' });
    expect(new Identity('a1', '')).toEqual({ id: 'a1', path: null });
  });
});
