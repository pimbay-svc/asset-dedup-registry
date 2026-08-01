import { Page } from '@pimbay/search-query';

export interface PageSnapshot<T> {
  data: readonly T[];
  totalCount: number;
  currentCount: number;
  currentPage: number;
  pageSize: number;
  pageCount: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/** Builds a real `Page<T>` (getter-based) from a plain snapshot — keeps test fixtures readable as plain objects. */
export function buildPage<T>(snapshot: PageSnapshot<T>): Page<T> {
  return new Page<T>(
    snapshot.data,
    snapshot.currentCount,
    snapshot.currentPage,
    snapshot.pageSize,
    snapshot.hasNextPage,
    snapshot.hasPreviousPage,
    snapshot.pageCount,
    snapshot.totalCount,
  );
}
