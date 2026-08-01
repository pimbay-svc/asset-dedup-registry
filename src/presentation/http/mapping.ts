/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { Page } from '@pimbay/search-query';
import { mapPage } from '@pimbay/search-query';
import type { Identity } from '../../domain/model/asset.model.js';

/** Wire shape for an asset's identity — `null` on either side, never omitted, so callers always see both. */
export interface IdentityDto {
  id: string | null;
  path: string | null;
}

export function mapIdentity(identity: Identity): IdentityDto {
  return { id: identity.id, path: identity.path };
}

/** Shared DTO shape for every paginated HTTP response — snake_case, matching this API's wire format. */
export interface PageDto<T> {
  data: readonly T[];
  total_count: number;
  current_count: number;
  current_page: number;
  page_size: number;
  page_count: number;
  has_next_page: boolean;
  has_previous_page: boolean;
}

/** Maps each item through `mapItem`, then flattens `Page<T>`'s getters into {@link PageDto}. */
export function mapPageToJson<T, R>(page: Page<T>, mapItem: (item: T) => R): PageDto<R> {
  const mapped = mapPage(page, mapItem);

  return {
    data: mapped.getData(),
    total_count: mapped.getTotalCount(),
    current_count: mapped.getCurrentCount(),
    current_page: mapped.getCurrentPage(),
    page_size: mapped.getPageSize(),
    page_count: mapped.getPageCount(),
    has_next_page: mapped.hasNextPage(),
    has_previous_page: mapped.hasPreviousPage(),
  };
}
