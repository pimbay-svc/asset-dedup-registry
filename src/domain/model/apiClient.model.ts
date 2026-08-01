/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
export const ApiScope = {
  ASSETS_WRITE: 'assets:write',
  ASSETS_READ: 'assets:read',
  WILDCARD: '*',
} as const;

export type ApiScope = (typeof ApiScope)[keyof typeof ApiScope];
