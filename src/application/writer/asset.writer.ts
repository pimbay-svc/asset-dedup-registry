/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { Identity } from '../../domain/model/asset.model.js';

/** Raw upsert input — see `AddAsset`'s doc comment for why `identityId`/`identityPath` stay unwrapped here. */
export interface CreateAssetParams {
  projectId: string;
  identityId: string | null;
  identityPath: string | null;
}

export interface CreateAssetResult {
  /** The registry's own internal id — never the identity, and never published outside the writer/repo boundary. */
  id: string;
  identity: Identity;
}

export interface AssetWriter {
  create(params: CreateAssetParams): Promise<CreateAssetResult>;
  deleteByIdentity(projectId: string, identity: Identity): Promise<void>;
}

export interface AssetHashWriter {
  replaceAll(assetId: string, algorithmId: number, hashes: string[]): Promise<void>;
}

export interface AssetHashDuplicateWriter {
  recomputeExact(projectId: string, algorithmId: number, assetId: string): Promise<void>;
  recomputeHamming(projectId: string, algorithmId: number, assetId: string, minSimilarity: number): Promise<void>;
  deleteByAsset(algorithmId: number, assetId: string): Promise<void>;
  deleteByProject(projectId: string, algorithmId: number): Promise<void>;
}
