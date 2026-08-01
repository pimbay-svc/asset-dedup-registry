/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { ApiClient, NewApiClient } from '../../domain/model/model.js';

export interface ApiClientWriter {
  create(params: NewApiClient): Promise<ApiClient>;
  revoke(id: string): Promise<void>;
}
