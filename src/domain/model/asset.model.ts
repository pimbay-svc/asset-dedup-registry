/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { ValidationError } from '../errors.js';

export const AssetAddStatus = {
  CREATED: 'created',
  UPDATED: 'updated',
  UNCHANGED: 'unchanged',
} as const;
export type AssetAddStatus = (typeof AssetAddStatus)[keyof typeof AssetAddStatus];

export const MimeHintType = {
  MIME: 'mime',
  EXTENSION: 'extension',
} as const;
export type MimeHintType = (typeof MimeHintType)[keyof typeof MimeHintType];

export interface MimeHint {
  type: MimeHintType;
  value: string;
}

/**
 * An asset's identity as known to the outside world — never the registry's own internal `asset.id` PK,
 * which is never published. At least one of `id`/`path` is always present (constructor-enforced, also
 * normalizes `""` to `null`); both may be set, e.g. a Pimcore-style project keying by opaque numeric id
 * while also storing the path for partial search. `id` matches exactly; `path` also supports partial
 * ("like") search.
 *
 * Holds only an already-resolved pair — "keep previous on update" (`null`) / "clear" (`""`) and "no filter
 * on this field" semantics belong to the calling layer, not this class.
 */
export class Identity {
  readonly id: string | null;
  readonly path: string | null;

  constructor(id: string | null, path: string | null) {
    this.id = id === '' ? null : id;
    this.path = path === '' ? null : path;

    if (this.id === null && this.path === null) {
      throw ValidationError.identityEmpty();
    }
  }
}
