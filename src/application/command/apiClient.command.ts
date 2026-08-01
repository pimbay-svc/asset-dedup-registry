/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { Command } from '../command.gateway.js';
import type { ApiScope } from '../../domain/model/apiClient.model.js';
import type { ApiClient } from '../../domain/model/model.js';

export interface CreateApiClientResult {
  apiClient: ApiClient;
  /** The raw API key — shown ONCE at creation time, never stored in plain */
  rawKey: string;
}

export class CreateApiClient implements Command<CreateApiClientResult> {
  declare readonly _resultType?: () => CreateApiClientResult;

  constructor(
    public readonly projectId: string,
    public readonly name: string,
    public readonly scopes: ApiScope[],
  ) {}
}

export class RevokeApiClient implements Command<void> {
  declare readonly _resultType?: () => void;

  constructor(public readonly id: string) {}
}
