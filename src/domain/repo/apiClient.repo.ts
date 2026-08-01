/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { ApiClient } from '../model/model.js';

export interface ApiClients {
  findByKeyHash(keyHash: string): Promise<ApiClient | null>;
  listByProject(projectId: string): Promise<ApiClient[]>;
  findByProjectAndName(projectId: string, name: string): Promise<ApiClient | null>;
}
