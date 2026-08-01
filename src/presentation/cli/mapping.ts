/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { Page } from '@pimbay/search-query';

/** Shared snapshot shape for every paginated CLI `--json` output — camelCase, matching this CLI's JSON output. */
export interface PageJson<T> {
  data: readonly T[];
  totalCount: number;
  currentCount: number;
  currentPage: number;
  pageSize: number;
  pageCount: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/** Flattens `Page<T>`'s getters into {@link PageJson} — pass to `printJson()` for `--json` output. */
export function mapPageToJson<T>(page: Page<T>): PageJson<T> {
  return {
    data: page.getData(),
    totalCount: page.getTotalCount(),
    currentCount: page.getCurrentCount(),
    currentPage: page.getCurrentPage(),
    pageSize: page.getPageSize(),
    pageCount: page.getPageCount(),
    hasNextPage: page.hasNextPage(),
    hasPreviousPage: page.hasPreviousPage(),
  };
}
