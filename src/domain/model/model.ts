/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import type { projectTable } from '../../infrastructure/drizzle/schema/project.schema.js';
import type { apiClientTable } from '../../infrastructure/drizzle/schema/apiClient.schema.js';
import type { algorithmTable } from '../../infrastructure/drizzle/schema/algorithm.schema.js';
import type { assetTable } from '../../infrastructure/drizzle/schema/asset.schema.js';
import type { assetHashTable } from '../../infrastructure/drizzle/schema/asset.hash.schema.js';
import type { assetHashDuplicateTable } from '../../infrastructure/drizzle/schema/asset.hashDuplicate.schema.js';

export type Project = InferSelectModel<typeof projectTable>;
export type ApiClient = InferSelectModel<typeof apiClientTable>;
export type Algorithm = InferSelectModel<typeof algorithmTable>;
export type Asset = InferSelectModel<typeof assetTable>;
export type AssetHash = InferSelectModel<typeof assetHashTable>;
export type AssetHashDuplicate = InferSelectModel<typeof assetHashDuplicateTable>;

export type NewProject = InferInsertModel<typeof projectTable>;
export type NewApiClient = InferInsertModel<typeof apiClientTable>;
export type NewAlgorithm = InferInsertModel<typeof algorithmTable>;
export type NewAsset = InferInsertModel<typeof assetTable>;
export type NewAssetHash = InferInsertModel<typeof assetHashTable>;
export type NewAssetHashDuplicate = InferInsertModel<typeof assetHashDuplicateTable>;
