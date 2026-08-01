/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { ValidationError } from '../domain/errors.js';
import { isValidPercentage } from '../domain/validation/validation.js';

/** Pure input parsing (HTTP query strings, CLI flags) — no domain/repo access, so plain functions, no DI. */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export function parsePositiveInt(raw: string | undefined, defaultValue: number, fieldName: string): number {
  if (raw === undefined) {
    return defaultValue;
  }
  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw ValidationError.notPositiveInteger(fieldName);
  }

  return parsed;
}

export function parseOptionalLimit(raw: string | undefined, fieldName = 'limit'): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw ValidationError.notPositiveInteger(fieldName);
  }

  return parsed;
}

export function parsePercentage(raw: string | undefined, fallback: number): number {
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number.parseFloat(raw);

  if (!isValidPercentage(parsed)) {
    throw ValidationError.percentageOutOfRange('threshold');
  }

  return parsed;
}

export function parsePage(
  raw: { page?: string; pageSize?: string },
  pageSizeFieldName = 'page_size',
): { page: number; size: number } {
  const page = parsePositiveInt(raw.page, 1, 'page');
  const size = parsePositiveInt(raw.pageSize, DEFAULT_PAGE_SIZE, pageSizeFieldName);

  if (size > MAX_PAGE_SIZE) {
    throw ValidationError.exceedsMaximum(pageSizeFieldName, MAX_PAGE_SIZE);
  }

  return { page, size };
}
