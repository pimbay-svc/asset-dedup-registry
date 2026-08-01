/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { Asset, AssetHash } from '../model/model.js';
import type { Identity } from '../model/asset.model.js';

/** One row per recipe with a hashed asset — see `Assets.countPerRecipe`. */
export interface AssetCountPerRecipe {
  recipe: string;
  assetCount: number;
}

/** Backs `GET /stats`' activity counters. */
export interface AssetActivitySummary {
  lastAddedAt: Date | null;
  addedLast7d: number;
  addedLast30d: number;
}

export interface Assets {
  findByIdentity(projectId: string, identity: Identity): Promise<Asset | null>;
  getByIdentity(projectId: string, identity: Identity): Promise<Asset>;
  listRecipes(projectId: string, identity: Identity): Promise<string[]>;
  countByProject(projectId: string): Promise<number>;
  listIdsWithHash(projectId: string, algorithmId: number, afterId: string | null, limit: number): Promise<string[]>;
  countPerRecipe(projectId: string): Promise<AssetCountPerRecipe[]>;
  getActivitySummary(projectId: string): Promise<AssetActivitySummary>;
}

/** Backs the `EXACT` branch of `GET /stats`' `duplicates_per_recipe` — computed off `asset_hash` directly,
 * cheap `GROUP BY hash`, no cluster computation involved (exact matches never need transitive closure). */
export interface ExactDuplicateStats {
  clusterCount: number;
  edgeCount: number;
  assetsWithDuplicateCount: number;
}

export interface AssetHashes {
  findOne(assetId: string, algorithmId: number, sequenceIndex: number): Promise<AssetHash | null>;
  findByAssetId(assetId: string): Promise<AssetHash[]>;
  countExactDuplicateStats(projectId: string, algorithmId: number): Promise<ExactDuplicateStats>;
}

export interface AssetHashDuplicateEdge {
  identityA: Identity;
  identityB: Identity;
  distance: number;
  similarity: number;
}

export interface AssetHashDuplicateMatch {
  identity: Identity;
  otherIdentity: Identity;
  distance: number;
  similarity: number;
}

export interface AssetHashDuplicates {
  findByProject(projectId: string, algorithmId: number, minSimilarity: number): Promise<AssetHashDuplicateEdge[]>;
  findByAssets(
    projectId: string,
    identities: Identity[],
    algorithmId: number,
    minSimilarity: number,
  ): Promise<AssetHashDuplicateMatch[]>;
  /** Distinct duplicate pairs (edges) across all algorithms in the project — not the raw, doubled row count. */
  countPairsByProject(projectId: string): Promise<number>;
}
