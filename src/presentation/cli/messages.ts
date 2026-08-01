/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */

// Runtime console output for `cli/command/*` — text printed depending on how a command executes (progress
// lines, success/error messages). Command *definition* (descriptions, option help text, table columns)
// stays inline in each command file, next to the `.command()`/`.option()` calls it documents.

export const DuplicateMessages = {
  THRESHOLD_IGNORED_WARNING:
    'Warning: --threshold is ignored for exact-comparison recipes (matches are always 100% similar)\n',
  pageFooter: (currentPage: number, pageCount: number, totalCount: number, noun: string): string =>
    `\nPage ${String(currentPage)}/${String(pageCount)} — ${String(totalCount)} ${noun} total.\n`,
  NO_RESULTS: '(no results)\n',
  NO_CLUSTERS: '(no duplicate clusters found)',
  clusterHeader: (clusterId: string, maxSimilarity: number): string =>
    `\n${clusterId} (max similarity ${String(maxSimilarity)}%)\n`,
  generationFooter: (generation: number): string =>
    `generation: ${String(generation)} (pass --generation to keep paging this snapshot)\n`,
  NO_HAMMING_RECIPES: '(no hamming-comparison recipes with existing hashes for this project — nothing to recompute)',
  recomputingLine: (recipe: string, threshold: number): string =>
    `Recomputing '${recipe}' (threshold ${String(threshold)}%)...\n`,
  batchProgressLine: (done: number): string => `  ${String(done)} assets processed...\n`,
  recomputeDoneLine: (total: number, recipe: string): string =>
    `  done: ${String(total)} asset(s) processed for '${recipe}'.\n`,
} as const;

export const AssetMessages = {
  noExtension: (filePath: string): string => `cannot derive a mime hint for '${filePath}' — it has no file extension`,
  noFilesMatched: (root: string, patterns: string): string =>
    `no files matched under '${root}' (patterns: ${patterns})`,
  scanLine: (status: string, identityPath: string): string => `${status.padEnd(9)} ${identityPath}\n`,
  scanFailedLine: (identityPath: string, message: string): string => `failed    ${identityPath}: ${message}\n`,
  scanSummary: (total: number, created: number, updated: number, unchanged: number, failed: number): string =>
    `\nDone: ${String(total)} files — ${String(created)} created, ` +
    `${String(updated)} updated, ${String(unchanged)} unchanged, ${String(failed)} failed.`,
  deleted: (identity: string): string => `Deleted asset '${identity}'.`,
} as const;

export const ProjectMessages = {
  confirmDelete: (slug: string, assetCount: number, apiClientCount: number): string =>
    `This would permanently delete project '${slug}' and everything under it: ` +
    `${String(assetCount)} asset(s), ${String(apiClientCount)} api-client(s), and all their hashes/duplicate data. ` +
    `Re-run with --yes to confirm.`,
  deleted: (slug: string, assetCount: number, apiClientCount: number): string =>
    `Deleted project '${slug}' (${String(assetCount)} asset(s), ${String(apiClientCount)} api-client(s)).`,
} as const;

export const ApiClientMessages = {
  invalidScopes: (invalid: string, valid: string): string => `Invalid scopes: ${invalid}. Valid: ${valid}`,
  rawKeyBlock: (rawKey: string): string => `\nAPI Key (shown ONCE — store it securely):\n${rawKey}\n`,
  revoked: (id: string): string => `API client '${id}' revoked.`,
} as const;
