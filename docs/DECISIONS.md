# Decisions

> Append-only log of decisions specific to _this_ project.
> Never edit or delete a past entry — if a decision changes, add a new entry that supersedes it and says so.
>
> **What belongs here** (test): would changing this silently break correctness, compatibility, or behavior if someone didn't know why it was done this way?
> If yes → here.
> If it's a cheap/local implementation detail → docs/context.md instead.
> If it's a pattern repeated across multiple repos → AGENTS.md instead, not here.

## `asset_hash_duplicate` identifies an edge by asset-id pair, stored directionally

**Date:** 2026-08-01

**Decision:** `asset_hash_duplicate` references `asset(id)` directly — `algorithm_id, asset_id, other_asset_id` — rather than being keyed by hash id. Each match produces two rows, `(X,Y)` and `(Y,X)`, written together in one statement (`distance`/`similarity` are symmetric, so both sides are known from a single recompute).

**Why:** keying by asset id (not hash id) guarantees at most one edge per asset pair per algorithm regardless of frame count — a multi-frame recipe (e.g. video phash) would otherwise produce a combinatorial explosion of hash-level rows for two similar videos. Storing both directions means every "which assets have duplicates" read is a straight join on the caller's own asset id, with no `UNION`/`OR`-across-two-columns needed to cover "this asset could be stored on either side of the pair."

**Trade-off:** 2x storage/writes per edge; `recomputeExact`/`recomputeHamming` must write both directions atomically in one statement, or the two assets' duplicate views silently diverge. Read paths that want one row per edge (not per asset) add `WHERE asset_id < other_asset_id` to undo the doubling.

## Hamming distance computed entirely in Postgres, not in JS

**Date:** 2026-08-01

**Decision:** Hamming distance is computed with `bit_count(('x'||hash)::bit varying # ('x'||hash)::bit varying)` directly in SQL (requires PG14+; `docker-compose.yml` pins `postgres:16-alpine`). The application layer never computes Hamming distance itself.

**Why:** avoids round-tripping every candidate hash through the application for what is fundamentally a set operation, and lets Postgres use indexes and do the comparison at the storage layer.

## `similarity` is a stored column, computed at write time — not derived at read time

**Date:** 2026-08-02

**Decision:** `asset_hash_duplicate` stores both `distance` (`integer`) and `similarity` (`double precision`, not `real` — `real`'s single-precision rounding broke `similarity >= threshold` comparisons at the boundary), both computed once by the write path.

**Why:** every read path (query service, CLI formatting, HTTP mapping) needs the same `(bitLength - distance) / bitLength * 100` conversion. Storing it once means every read path shares one number, computed one way, and threshold filtering (`WHERE similarity >= $1`) is a plain indexed comparison instead of a computed expression.

## Bulk recompute walks assets in application-level batches, not one large SQL statement

**Date:** 2026-08-02

**Decision:** `duplicates recompute` cursor-paginates the project's assets (`asset.id` cursor, not `OFFSET`) in fixed-size batches (default 200, max 1000), calling the existing single-asset `recomputeHamming` primitive once per asset per batch. It is a separate, manually-triggered step — changing a project's `--hamming-threshold` does not retroactively touch existing `asset_hash_duplicate` rows.

**Why:** a single all-at-once self-join statement is faster in the best case, but turns into one long-running transaction with no visible progress and no way to resume after a partial failure on a large project. Batching pays a real cost — each pair gets recomputed twice, once from each asset's perspective — in exchange for bounded transaction size, per-batch progress reporting, and resumability.

## `/duplicates/clusters`: on-the-fly DB-side computation with a generation-pinned cache, not a precomputed table

**Date:** 2026-09-11 (cache pinning refined 2026-09-12)

**Decision:** Cluster membership (`GET /duplicates/clusters`, `duplicates clusters`) is computed by a min-label propagation algorithm running as a bounded loop of plain `UPDATE ... FROM ... JOIN` statements directly in Postgres (`DrizzleClusterRepository.recompute`/`propagateLabels`, capped at `MAX_PROPAGATION_ITERATIONS`) — no edge list is ever pulled into application memory, no JS union-find is involved. `?minSimilarity=`/`--threshold` stays a free per-request parameter rather than being committed to one value at write time.

The result is cached per exact `(algorithm_id, threshold)` in `cluster_cache_asset`/`cluster_cache_meta`, keyed by a `generation` counter per `(project, algorithm)` that every write bumps. Both cache tables carry `generation` as part of their key and are **append-only** — a superseded generation is a permanent, independently-addressable snapshot, not deleted in place. A paginated read pins itself to one `generation` across all its pages (round-tripped as `generation` in the response/`--generation` CLI flag), so a write landing mid-listing can never tear it. `bumpGeneration` sweeps rows older than `CLUSTER_CACHE_RETENTION_MS` (1 hour) rather than purging the superseded generation immediately — long enough for any in-flight paginated read pinned to it to finish. `MAX_CLUSTER_EDGE_COUNT` (200,000, checked via a cheap `COUNT(*)` before any cluster work starts) rejects requests over a graph size where per-request computation stops being practical.

**Why not a write-time-precomputed `group_id`/cluster table:** near-duplicate profiling genuinely needs arbitrary per-request thresholds (Johny compares cluster composition at 80% vs 99% against the same data as a normal workflow, not an edge case) — a table committing cluster membership to one threshold at write time can't serve that. Read-time computation was always required; the design question was only how to make it fast enough, which the SQL-side propagation loop plus generation-pinned cache answers: near-duplicate clusters are small-diameter by construction, so propagation converges in very few round trips, and the cache means a "try 80%, then 85%, then 90%" request pattern only pays full computation once per distinct threshold actually used.

**Threshold range this can't serve:** `asset_hash_duplicate` only ever contains edges at or above the _write-time_ threshold used by `recomputeHamming` — a read-time threshold below that floor can't recover edges that were never written. The readable range is `[write-time threshold, 100%]`, never `[0, 100%]`.
