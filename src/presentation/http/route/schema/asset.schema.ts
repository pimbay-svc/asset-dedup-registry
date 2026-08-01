/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { AssetAddStatus, MimeHintType } from '../../../../domain/model/asset.model.js';

const mimeHintSchema = {
  type: 'object',
  required: ['type', 'value'],
  properties: {
    type: { type: 'string', enum: Object.values(MimeHintType) },
    value: { type: 'string', minLength: 1 },
  },
} as const;

/** At least one of `id`/`path` required — enforced by `anyOf`, mirroring the domain `Identity` invariant. */
const identityBodySchema = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1 },
    path: { type: 'string', minLength: 1 },
  },
  anyOf: [{ required: ['id'] }, { required: ['path'] }],
} as const;

const identityQueryProps = {
  id: { type: 'string', minLength: 1 },
  path: { type: 'string', minLength: 1 },
} as const;

/** Response identity — always both fields present, `null` on whichever side wasn't set. */
const identityResponseSchema = {
  type: 'object',
  properties: {
    id: { type: ['string', 'null'] },
    path: { type: ['string', 'null'] },
  },
} as const;

export const addAssetBodySchema = {
  type: 'object',
  required: ['identity', 'mime_hint', 'file_content'],
  properties: {
    identity: identityBodySchema,
    mime_hint: mimeHintSchema,
    file_content: { type: 'string', minLength: 1 },
  },
} as const;

export const deleteAssetBodySchema = {
  type: 'object',
  required: ['identity'],
  properties: {
    identity: identityBodySchema,
  },
} as const;

export const assetRecipesQuerySchema = {
  type: 'object',
  properties: identityQueryProps,
  anyOf: [{ required: ['id'] }, { required: ['path'] }],
} as const;

export const addAssetResponseSchema = {
  type: 'object',
  properties: {
    identity: identityResponseSchema,
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          recipe: { type: 'string' },
          hashes: { type: 'array', items: { type: 'string' } },
          status: { type: 'string', enum: Object.values(AssetAddStatus) },
        },
      },
    },
  },
} as const;

export const assetRecipesResponseSchema = {
  type: 'object',
  properties: {
    identity: identityResponseSchema,
    recipes: { type: 'array', items: { type: 'string' } },
  },
} as const;
