# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-09-15

### Added

- Multi-tenant PostgreSQL registry storing `project + recipe + asset identity → hash` pairs, one project per API key.
- Assets are identified by an `Identity` (`id` and/or `path`, at least one required) instead of a single flat asset id — `id` is an opaque external identifier matched exactly, `path` is a location string that also supports partial ("like") search via `/duplicates/*`. Every wire response includes both fields, `null` on whichever side wasn't set.
- `POST /assets` — hashes a file against every recipe configured for the project (via `asset-dedup-core`) and stores/updates the result per recipe.
- `DELETE /assets` — removes an asset and its hashes/duplicate data.
- `GET /assets/recipes` — which recipes have actually been computed for an asset (query params `id`/`path`, not a path segment, since a `path` identity can contain `/`).
- `GET /duplicates/matches` — closest matches to a given asset, for one recipe.
- `GET /duplicates/clusters` — connected components (transitive groups, not just direct pairs) of mutually similar assets for one recipe, computed on the fly for the requested threshold and cached with a generation counter for stable pagination across writes.
- `GET /duplicates/ranking` — assets ranked by duplicate count, paginated, each with its nearest matches nested underneath.
- `GET /healthz` — shallow and deep (`?deep=true`, checks DB + core) healthchecks.
- `GET /stats` — scoped, single-project overview across every configured recipe.
- Exact and Hamming-distance duplicate comparison, with similarity precomputed and stored at write time.
- Per-project configurable recipes, Hamming similarity threshold, and rate limit.
- CLI (`project`, `api-client`, `asset`, `duplicates`, `stats`) for provisioning and querying, including bulk `duplicates recompute` after a threshold change and `asset scan` for hashing a whole local directory in one process/DB connection.
- Bearer API key authentication, scoped to `assets:write` / `assets:read` / `*`.
- Pagination powered by the standalone `@pimbay/search-query`/`@pimbay/search-query-drizzle` npm packages (adapter/assembler split, Drizzle-specific adapters), replacing an earlier vendored copy.

### Changed

- Renamed `GET /duplicates/groups` to `GET /duplicates/clusters`: clusters are now computed on the fly per `(project, algorithm, threshold)` and cached, invalidated by a generation counter bumped on every write, rather than served from a precomputed table.
- Replaced the single `asset_id` field across every request/response body and query string with the `identity`/`id`+`path` model described above (`POST /assets`, `DELETE /assets`, `GET /assets/recipes`, `GET /duplicates/*`, and the equivalent `asset`/`duplicates` CLI commands: `--asset-id` is now `--id`/`--path`, and `asset scan`'s `--id-prefix` is now `--path-prefix`).
