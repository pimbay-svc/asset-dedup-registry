/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { ApiClient } from '../model/model.js';
import { ApiScope } from '../model/apiClient.model.js';

export function hasScope(apiClient: ApiClient, requiredScope: ApiScope): boolean {
  return apiClient.scopes.some((scope) => scope === ApiScope.WILDCARD || scope === requiredScope);
}
