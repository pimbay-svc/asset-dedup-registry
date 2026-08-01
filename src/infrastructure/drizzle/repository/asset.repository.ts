/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { and, eq, gt, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { DbClient, DbOrTx } from '../client.js';
import { assetTable, assetHashTable, algorithmTable } from '../schema.js';
import type { Assets, AssetCountPerRecipe, AssetActivitySummary } from '../../../domain/repo/asset.repo.js';
import type { Asset } from '../../../domain/model/model.js';
import { Identity } from '../../../domain/model/asset.model.js';
import type { AssetWriter, CreateAssetParams, CreateAssetResult } from '../../../application/writer/asset.writer.js';
import { NotFoundError, AlreadyExistsError } from '../../../domain/errors.js';

/** Any asset-shaped table/alias exposing the two identity columns — lets the same condition builder work
 * against `assetTable` directly or any of its joined aliases (`asset_a`, `asset_self`, ...). */
interface AssetIdentityColumns {
  identityId: PgColumn;
  identityPath: PgColumn;
}

/** `id` takes priority over `path` — see `Identity`'s doc comment for why a lookup only ever uses one. */
export function identityCondition(asset: AssetIdentityColumns, identity: Identity): SQL {
  if (identity.id !== null) {
    return eq(asset.identityId, identity.id);
  }

  // Stryker disable next-line ConditionalExpression: same reason as the v8 ignore below — forcing this to
  // `true` is unobservable, since every test that reaches this line already has a non-null `path` per the
  // invariant the v8 ignore explains.
  /* v8 ignore else -- unreachable: Identity's own constructor guarantees id and path are not both null,
   * so if id is null here, path is always non-null. */
  if (identity.path !== null) {
    return eq(asset.identityPath, identity.path);
  }

  // Stryker disable next-line all: unreachable in practice — guards the type narrowing above, not a code path any test can trigger honestly.
  /* v8 ignore next -- unreachable: Identity's own constructor guarantees id and path are not both null */
  throw new Error('unreachable: Identity with neither id nor path');
}

function isGiven(value: string | null): value is string {
  return value !== null && value !== '';
}

/** `null` (not sent) keeps `previous`; `""` (sent as empty) clears it; anything else replaces it.
 * Exported so the `""`-clears-to-`null` contract can be unit-tested directly — the only caller passes the
 * result straight into `new Identity(...)`, whose own constructor normalizes `""` to `null` too, so a black-box
 * test of `create()` alone can't distinguish this function returning `null` from it returning `""` unchanged. */
export function resolveField(raw: string | null, previous: string | null): string | null {
  if (raw === null) {
    return previous;
  }

  if (raw === '') {
    return null;
  }

  return raw;
}

export class DrizzleAssetRepository implements Assets, AssetWriter {
  constructor(private readonly db: DbClient) {}

  async findByIdentity(projectId: string, identity: Identity): Promise<Asset | null> {
    const [row] = await this.db
      .select()
      .from(assetTable)
      .where(and(eq(assetTable.projectId, projectId), identityCondition(assetTable, identity)))
      .limit(1);

    return row ?? null;
  }

  async getByIdentity(projectId: string, identity: Identity): Promise<Asset> {
    const asset = await this.findByIdentity(projectId, identity);

    if (asset === null) {
      throw NotFoundError.asset(identity);
    }

    return asset;
  }

  /** Locks the matching row (`SELECT ... FOR UPDATE`) so a concurrent `create` racing on the same identity
   * waits instead of both reading a stale "no previous row" and colliding on the unique index. */
  private async findLocked(tx: DbOrTx, projectId: string, condition: SQL): Promise<Asset | null> {
    const [row] = await tx
      .select()
      .from(assetTable)
      .where(and(eq(assetTable.projectId, projectId), condition))
      .for('update')
      .limit(1);

    return row ?? null;
  }

  /** Upsert: `id` takes priority over `path` when looking for a previous row to patch. If both are given
   * and match *different* existing rows, that's a genuine conflict (`AlreadyExistsError`), not something
   * priority order or a `null`/`""` rule can silently resolve. */
  async create(params: CreateAssetParams): Promise<CreateAssetResult> {
    return this.db.transaction(async (tx) => {
      const byId = isGiven(params.identityId)
        ? await this.findLocked(tx, params.projectId, eq(assetTable.identityId, params.identityId))
        : null;
      const byPath = isGiven(params.identityPath)
        ? await this.findLocked(tx, params.projectId, eq(assetTable.identityPath, params.identityPath))
        : null;

      if (byId !== null && byPath !== null && byId.id !== byPath.id) {
        throw AlreadyExistsError.asset(new Identity(params.identityId, params.identityPath));
      }

      const previous = byId ?? byPath;
      const identity = new Identity(
        resolveField(params.identityId, previous?.identityId ?? null),
        resolveField(params.identityPath, previous?.identityPath ?? null),
      );

      if (previous !== null) {
        const [row] = await tx
          .update(assetTable)
          .set({ identityId: identity.id, identityPath: identity.path, updatedAt: new Date() })
          .where(eq(assetTable.id, previous.id))
          .returning();

        /* v8 ignore next 3 -- unreachable: updating by the id of a row just selected in the same tx always returns exactly one row */
        if (row === undefined) {
          // Stryker disable next-line all: unreachable — see the v8 ignore above, same reasoning.
          throw new Error('asset update returned no rows');
        }

        return { id: row.id, identity };
      }

      const [row] = await tx
        .insert(assetTable)
        .values({ projectId: params.projectId, identityId: identity.id, identityPath: identity.path })
        .returning();

      /* v8 ignore next 3 -- unreachable: a successful INSERT always returns exactly one row */
      if (row === undefined) {
        // Stryker disable next-line all: unreachable — see the v8 ignore above, same reasoning.
        throw new Error('asset insert returned no rows');
      }

      return { id: row.id, identity };
    });
  }

  async deleteByIdentity(projectId: string, identity: Identity): Promise<void> {
    await this.db
      .delete(assetTable)
      .where(and(eq(assetTable.projectId, projectId), identityCondition(assetTable, identity)));
  }

  async listRecipes(projectId: string, identity: Identity): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ recipe: algorithmTable.recipe })
      .from(assetHashTable)
      .innerJoin(assetTable, eq(assetTable.id, assetHashTable.assetId))
      .innerJoin(algorithmTable, eq(algorithmTable.id, assetHashTable.algorithmId))
      .where(and(eq(assetTable.projectId, projectId), identityCondition(assetTable, identity)));

    return rows.map((row) => row.recipe);
  }

  async listIdsWithHash(
    projectId: string,
    algorithmId: number,
    afterId: string | null,
    limit: number,
  ): Promise<string[]> {
    const conditions = [eq(assetTable.projectId, projectId)];

    if (afterId !== null) {
      conditions.push(gt(assetTable.id, afterId));
    }

    const rows = await this.db
      .selectDistinct({ id: assetTable.id })
      .from(assetTable)
      .innerJoin(
        assetHashTable,
        and(eq(assetHashTable.assetId, assetTable.id), eq(assetHashTable.algorithmId, algorithmId)),
      )
      .where(and(...conditions))
      .orderBy(assetTable.id)
      .limit(limit);

    return rows.map((row) => row.id);
  }

  async countByProject(projectId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: sql<number>`count(*)::int`.as('value') })
      .from(assetTable)
      .where(eq(assetTable.projectId, projectId));

    /* v8 ignore next -- unreachable: COUNT(*) with no GROUP BY always returns exactly one row */
    return row?.value ?? 0;
  }

  /** One row per recipe with a hash — unhashed recipes are absent, zero-filled by the caller. */
  async countPerRecipe(projectId: string): Promise<AssetCountPerRecipe[]> {
    const rows = await this.db
      .select({
        recipe: algorithmTable.recipe,
        assetCount: sql<number>`count(distinct ${assetHashTable.assetId})::int`.as('asset_count'),
      })
      .from(assetHashTable)
      .innerJoin(assetTable, eq(assetTable.id, assetHashTable.assetId))
      .innerJoin(algorithmTable, eq(algorithmTable.id, assetHashTable.algorithmId))
      .where(eq(assetTable.projectId, projectId))
      .groupBy(algorithmTable.recipe);

    return rows;
  }

  async getActivitySummary(projectId: string): Promise<AssetActivitySummary> {
    const [row] = await this.db
      .select({
        lastAddedAt: sql<string | null>`max(${assetTable.createdAt})`.as('last_added_at'),
        addedLast7d: sql<number>`count(*) filter (where ${assetTable.createdAt} >= now() - interval '7 days')::int`.as(
          'added_last_7d',
        ),
        addedLast30d:
          sql<number>`count(*) filter (where ${assetTable.createdAt} >= now() - interval '30 days')::int`.as(
            'added_last_30d',
          ),
      })
      .from(assetTable)
      .where(eq(assetTable.projectId, projectId));

    /* v8 ignore next 5 -- unreachable: COUNT(*)/MAX(*) with no GROUP BY always returns exactly one row */
    return {
      lastAddedAt: row?.lastAddedAt ? new Date(row.lastAddedAt) : null,
      addedLast7d: row?.addedLast7d ?? 0,
      addedLast30d: row?.addedLast30d ?? 0,
    };
  }
}
