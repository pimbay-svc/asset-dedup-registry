/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
const UNIQUE_VIOLATION_CODE = '23505';

/** True if `err` (or anything in its `.cause` chain) is a Postgres unique-constraint violation. */
export function isUniqueError(err: unknown): boolean {
  let current: unknown = err;

  while (current instanceof Error) {
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION_CODE) {
      return true;
    }
    current = current.cause;
  }

  return false;
}
