/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */

/**
 * `DrizzleAssetHashDuplicateRepository` uses it to invalidate the cluster cache on every write, mirroring
 * how `AssetHashDuplicateWriter` below splits from `AssetHashDuplicates`.
 * Both methods bump the same (project, algorithm) counter; they only differ in what the caller has on
 * hand. `bumpGenerationForAsset` takes `assetId` instead of `projectId` (e.g. `deleteByAsset`, whose
 * signature has none) and derives the project via a subquery — the asset row must still exist at call time.
 */
export interface ClusterWriter {
  bumpGeneration(projectId: string, algorithmId: number): Promise<void>;
  bumpGenerationForAsset(algorithmId: number, assetId: string): Promise<void>;
}
