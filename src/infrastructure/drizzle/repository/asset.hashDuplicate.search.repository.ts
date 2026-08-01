/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { and, eq, gte, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { DbClient } from '../client.js';
import { assetHashDuplicateTable, assetTable } from '../schema.js';
import type { PageAdapter, Page } from '@pimbay/search-query';
import { paginatePage, mapPage, createSearchTermsConfig } from '@pimbay/search-query';
import { DrizzleSimpleAdapter, buildSearchTermsConditionFromString } from '@pimbay/search-query-drizzle';
import type { AssetHashDuplicates } from '../../../domain/repo/asset.repo.js';
import { Identity } from '../../../domain/model/asset.model.js';
import { identityCondition } from './asset.repository.js';
import type {
  AssetHashDuplicatesSearch,
  AssetHashDuplicateRankingQuery,
  AssetHashDuplicateMatchesQuery,
  AssetHashDuplicateCount,
  AssetWithDuplicateCount,
  DuplicateMatch,
} from '../../../application/query/asset.query.js';

/** Raw SELECT shape for the ranking query — `identityId`/`identityPath` are assembled into an `Identity`
 * right after paginating, same split as `RawDuplicateMatchRow` below. */
interface RawDuplicateCountRow {
  identityId: string | null;
  identityPath: string | null;
  duplicateCount: number;
}

interface RawDuplicateMatchRow {
  identityId: string | null;
  identityPath: string | null;
  distance: number;
  similarity: number;
}

function toDuplicateCount(row: RawDuplicateCountRow): AssetHashDuplicateCount {
  return { identity: new Identity(row.identityId, row.identityPath), duplicateCount: row.duplicateCount };
}

function toDuplicateMatch(row: RawDuplicateMatchRow): DuplicateMatch {
  return {
    identity: new Identity(row.identityId, row.identityPath),
    distance: row.distance,
    similarity: row.similarity,
  };
}

/** Map key for grouping by an asset's identity in-memory — both fields together, since either alone could
 * collide with a different asset that only has the other field set (e.g. `id=null,path='x'` vs
 * `id='x',path=null`). Not a lookup condition, just a stable key for `Map`. */
function identityKey(identity: Identity): string {
  // Stryker disable next-line StringLiteral: the exact fallback text on either side is never observable — it
  // only has to be *consistent* between the write and read side of the map, and the DB's own unique indexes
  // on `(project, identity_id)`/`(project, identity_path)` mean two distinct real assets can never share the
  // field that's present, so no legitimate test data can make the fallback text matter.
  return `${identity.id ?? ''}\u0000${identity.path ?? ''}`;
}

export class DrizzleAssetHashDuplicateSearchRepository implements AssetHashDuplicatesSearch {
  constructor(
    private readonly db: DbClient,
    private readonly assetHashDuplicates: AssetHashDuplicates,
  ) {}

  async paginateRanking(
    query: AssetHashDuplicateRankingQuery,
    page: number,
    size: number,
  ): Promise<Page<AssetWithDuplicateCount>> {
    const rawRanked = await paginatePage(this.getRankingAdapter(query), page, size);
    const ranked = mapPage(rawRanked, toDuplicateCount);
    const matchesByAsset = await this.loadMatches(query, ranked.getData());

    return mapPage(ranked, (row) => withMatches(row, matchesByAsset, query.matchLimit));
  }

  private getRankingAdapter(query: AssetHashDuplicateRankingQuery): PageAdapter<RawDuplicateCountRow> {
    return createRankingAdapter(this.db, query);
  }

  async paginateMatches(
    query: AssetHashDuplicateMatchesQuery,
    page: number,
    size: number,
  ): Promise<Page<DuplicateMatch>> {
    const raw = await paginatePage(createMatchesAdapter(this.db, query), page, size);

    return mapPage(raw, toDuplicateMatch);
  }

  private async loadMatches(
    query: AssetHashDuplicateRankingQuery,
    ranked: readonly AssetHashDuplicateCount[],
  ): Promise<Map<string, DuplicateMatch[]>> {
    const matchesByAsset = new Map<string, DuplicateMatch[]>();

    if (ranked.length === 0) {
      return matchesByAsset;
    }

    const matchRows = await this.assetHashDuplicates.findByAssets(
      query.projectId,
      ranked.map((row) => row.identity),
      query.algorithmId,
      query.minSimilarity,
    );

    matchRows.forEach((row) => {
      const key = identityKey(row.identity);
      const list = matchesByAsset.get(key) ?? [];
      list.push({ identity: row.otherIdentity, distance: row.distance, similarity: row.similarity });
      matchesByAsset.set(key, list);
    });

    return matchesByAsset;
  }
}

const SEARCH_TERMS_CONFIG = createSearchTermsConfig({ anywhere: true });

/** Directional storage means count/ranking share the same FROM/JOIN — no UNION needed. Groups by `asset.id`
 * (the PK) rather than the identity columns directly — Postgres' functional-dependency rule then allows
 * selecting `identity_id`/`identity_path` ungrouped, correct regardless of which field is set. Exported so
 * `head()`/`all()` (unused by `paginatePage()`) can be tested directly. */
export function createRankingAdapter(
  db: DbClient,
  query: AssetHashDuplicateRankingQuery,
): DrizzleSimpleAdapter<{ count: number }, RawDuplicateCountRow> {
  const scope: SQL | undefined = and(
    eq(assetTable.projectId, query.projectId),
    eq(assetHashDuplicateTable.algorithmId, query.algorithmId),
    gte(assetHashDuplicateTable.similarity, query.minSimilarity),
    query.id === undefined ? undefined : eq(assetTable.identityId, query.id),
    query.path === undefined
      ? undefined
      : buildSearchTermsConditionFromString(assetTable.identityPath, query.path, SEARCH_TERMS_CONFIG),
  );

  return new DrizzleSimpleAdapter(
    () =>
      db
        .select({ count: sql<number>`count(distinct ${assetTable.id})::int`.as('count') })
        .from(assetHashDuplicateTable)
        .innerJoin(assetTable, eq(assetTable.id, assetHashDuplicateTable.assetId))
        .$dynamic()
        .where(scope),
    (row) => row.count,
    () =>
      db
        .select({
          identityId: assetTable.identityId,
          identityPath: assetTable.identityPath,
          duplicateCount: sql<number>`count(*)::int`.as('duplicate_count'),
        })
        .from(assetHashDuplicateTable)
        .innerJoin(assetTable, eq(assetTable.id, assetHashDuplicateTable.assetId))
        .$dynamic()
        .where(scope)
        .groupBy(assetTable.id)
        .orderBy(sql`duplicate_count desc`, assetTable.identityId, assetTable.identityPath),
  );
}

/** Pure, sync — the batched match lookup already happened; this only assembles + sorts + caps. */
function withMatches(
  ranked: AssetHashDuplicateCount,
  matchesByAsset: Map<string, DuplicateMatch[]>,
  matchLimit: number | undefined,
): AssetWithDuplicateCount {
  /* v8 ignore next -- unreachable: findByAssets uses the same minSimilarity filter as the ranking
     query, so every asset here (duplicateCount > 0) always has >=1 entry in matchesByAsset */
  const matches = (matchesByAsset.get(identityKey(ranked.identity)) ?? []).sort((a, b) => b.similarity - a.similarity);
  // Stryker disable next-line ConditionalExpression: `.slice(0, undefined)` returns the whole array per JS
  // spec, identical to not slicing at all — so this guard is unobservable when matchLimit is undefined;
  // `caps matches per asset at matchLimit` already covers the defined case.
  const limited = matchLimit !== undefined ? matches.slice(0, matchLimit) : matches;

  return {
    identity: ranked.identity,
    duplicateCount: ranked.duplicateCount,
    matches: limited,
  };
}

export function createMatchesAdapter(
  db: DbClient,
  query: AssetHashDuplicateMatchesQuery,
): DrizzleSimpleAdapter<{ count: number }, RawDuplicateMatchRow> {
  const self = alias(assetTable, 'asset_self');
  const other = alias(assetTable, 'asset_other');
  const scope: SQL | undefined = and(
    eq(self.projectId, query.projectId),
    identityCondition(self, query.identity),
    eq(assetHashDuplicateTable.algorithmId, query.algorithmId),
    gte(assetHashDuplicateTable.similarity, query.minSimilarity),
  );

  return new DrizzleSimpleAdapter(
    () =>
      db
        .select({ count: sql<number>`count(*)::int`.as('count') })
        .from(assetHashDuplicateTable)
        .innerJoin(self, eq(self.id, assetHashDuplicateTable.assetId))
        .innerJoin(other, eq(other.id, assetHashDuplicateTable.otherAssetId))
        .$dynamic()
        .where(scope),
    (row) => row.count,
    () =>
      db
        .select({
          identityId: other.identityId,
          identityPath: other.identityPath,
          distance: assetHashDuplicateTable.distance,
          similarity: assetHashDuplicateTable.similarity,
        })
        .from(assetHashDuplicateTable)
        .innerJoin(self, eq(self.id, assetHashDuplicateTable.assetId))
        .innerJoin(other, eq(other.id, assetHashDuplicateTable.otherAssetId))
        .$dynamic()
        .where(scope)
        .orderBy(sql`similarity desc`),
  );
}
