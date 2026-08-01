/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */

export const DbClientMessage = {
  POOL_CONNECTION_CLOSED: 'pool connection closed',
} as const;

export const MigrateMessage = {
  ALL_MIGRATIONS_APPLIED: '[migrate] All migrations applied.',
  FATAL: '[migrate] Fatal:',
} as const;
