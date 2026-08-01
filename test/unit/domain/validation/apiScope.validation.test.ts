import { describe, it, expect } from 'vitest';
import { hasScope } from '../../../../src/domain/validation/apiScope.validation.js';
import { ApiScope } from '../../../../src/domain/model/apiClient.model.js';
import type { ApiClient } from '../../../../src/domain/model/model.js';

function buildApiClient(scopes: unknown): ApiClient {
  return { scopes } as ApiClient;
}

describe('hasScope', () => {
  it('returns true when the exact scope is present', () => {
    expect(hasScope(buildApiClient([ApiScope.ASSETS_READ]), ApiScope.ASSETS_READ)).toBe(true);
  });

  it('returns false when the scope is absent', () => {
    expect(hasScope(buildApiClient([ApiScope.ASSETS_READ]), ApiScope.ASSETS_WRITE)).toBe(false);
  });

  it('returns true for a wildcard scope regardless of the required scope', () => {
    expect(hasScope(buildApiClient([ApiScope.WILDCARD]), ApiScope.ASSETS_WRITE)).toBe(true);
  });

  it('returns false for an empty scopes array', () => {
    expect(hasScope(buildApiClient([]), ApiScope.ASSETS_READ)).toBe(false);
  });
});
