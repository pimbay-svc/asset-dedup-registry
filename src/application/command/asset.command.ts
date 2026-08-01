/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { Command } from '../command.gateway.js';
import type { AssetAddStatus, MimeHint, Identity } from '../../domain/model/asset.model.js';
import type { Comparison } from '../../domain/model/algorithm.model.js';

export interface AddRecipeResult {
  recipe: string;
  hashes: string[];
  status: AssetAddStatus;
}

export interface AddAssetResult {
  identity: Identity;
  results: AddRecipeResult[];
}

/** `identityId`/`identityPath` pass through raw (not wrapped in `Identity`) to the repository upsert: at
 * creation `null`/`""` both mean "unset", but against an *existing* asset `null` means "keep previous" and
 * `""` means "clear" — only the repository, which knows creating vs. updating, can tell these apart. */
export class AddAsset implements Command<AddAssetResult> {
  declare readonly _resultType?: () => AddAssetResult;

  constructor(
    public readonly projectId: string,
    public readonly identityId: string | null,
    public readonly identityPath: string | null,
    public readonly mimeHint: MimeHint,
    public readonly fileContentBase64: string,
  ) {}
}

export class DeleteAsset implements Command<void> {
  declare readonly _resultType?: () => void;

  constructor(
    public readonly projectId: string,
    public readonly identity: Identity,
  ) {}
}

export class RecomputeAsset implements Command<void> {
  declare readonly _resultType?: () => void;

  constructor(
    public readonly projectId: string,
    public readonly algorithmId: number,
    public readonly comparison: Comparison,
    public readonly assetId: string,
    /** project.hammingThreshold — null falls back to the registry-wide config default. */
    public readonly hammingThreshold: number | null,
  ) {}
}

export class RecomputeProject implements Command<number> {
  declare readonly _resultType?: () => number;

  constructor(
    public readonly projectId: string,
    public readonly algorithmId: number,
    public readonly comparison: Comparison,
    public readonly hammingThreshold: number | null,
    public readonly batchSize: number,
    public readonly onBatch?: (assetsProcessedSoFar: number) => void,
  ) {}
}
