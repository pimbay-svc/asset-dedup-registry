# API Reference

Base URL: `http://localhost:3100` (default `PORT`; configurable via the `PORT` env var).

Auth: `Authorization: Bearer <api-key>`, unless an endpoint says otherwise.
Each key is scoped to `assets:write`, `assets:read`, or `*` (wildcard) — see `src/domain/model/apiClient.model.ts`.
The project a key acts on is derived from the key itself, never from the request body or query string.

Most read endpoints (`/duplicates/*`) are scoped to a single **recipe** (e.g. `binary.sha256`, `image.phash16`) via a required `recipe` query parameter — a project can have several recipes configured, and each is compared independently.

## Error format

Every non-2xx response has the same shape:

```json
{ "error": "human-readable message" }
```

| Status | Meaning                                                                                        |
| ------ | ---------------------------------------------------------------------------------------------- |
| 400    | Validation error — malformed/missing request field                                             |
| 401    | Missing or invalid API key                                                                     |
| 403    | API key valid but lacks the required scope                                                     |
| 404    | Resource not found (project, or the recipe has never hashed this asset)                        |
| 409    | Resource already exists                                                                        |
| 422    | Core rejected this specific asset (e.g. a corrupt file)                                        |
| 429    | Rate limit exceeded for this project (`project.rateLimitPerMinute`/config default, per minute) |
| 501    | Recognized but not yet implemented (cosine/vector recipes)                                     |
| 502    | An upstream dependency (`asset-dedup-core`) is unavailable or misbehaving                      |
| 500    | Unexpected internal error                                                                      |

---

## `POST /assets`

Hashes a file against every recipe configured for the project and adds/updates the asset. Required scope: `assets:write`.

**Request body**

```json
{
  "identity": { "id": "my-app/uploads/photo.jpg" },
  "mime_hint": { "type": "mime", "value": "image/jpeg" },
  "file_content": "<base64-encoded file bytes>"
}
```

`identity` takes `id` and/or `path` — at least one is required. `id` is an opaque external identifier (e.g. a Pimcore asset id) matched exactly; `path` is a location string that also supports partial/"like" search via `/duplicates/*`. Re-running with the same `identity` updates that asset rather than creating a new one.

`mime_hint.type` is `mime` or `extension` — `extension` lets a caller pass a bare file extension (e.g. `jpg`) when it doesn't have a real MIME type on hand.

**Success response — `200`**

```json
{
  "identity": { "id": "my-app/uploads/photo.jpg", "path": null },
  "results": [
    { "recipe": "binary.sha256", "hashes": ["a3f5..."], "status": "created" },
    { "recipe": "image.phash16", "hashes": ["9c2e..."], "status": "created" }
  ]
}
```

The response `identity` always has both `id` and `path` present, `null` on whichever side wasn't set. `status` is `created`, `updated`, or `unchanged` (the file's hash for that recipe was already stored — no recomputation happened).

**Errors**

| Status | Cause                                                                                        |
| ------ | -------------------------------------------------------------------------------------------- |
| 400    | Missing/malformed `identity` (neither `id` nor `path` given), `mime_hint`, or `file_content` |
| 422    | Core rejected the file (corrupt, unreadable)                                                 |
| 502    | Core is unreachable, or its response contradicts an already-stored algorithm                 |

**Example**

```bash
curl -X POST http://localhost:3100/assets \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"identity": {"id": "photo.jpg"}, "mime_hint": {"type": "mime", "value": "image/jpeg"}, "file_content": "'"$(base64 -w0 photo.jpg)"'"}'
```

---

## `DELETE /assets`

Removes an asset and its hashes/duplicate data (cascades via foreign key). Idempotent — deleting an asset that no longer exists still returns `204`. Required scope: `assets:write`.

**Request body**

```json
{ "identity": { "id": "my-app/uploads/photo.jpg" } }
```

Same `identity` shape as `POST /assets` — at least one of `id`/`path` is required.

**Success response — `204`** (empty body)

**Errors**

| Status | Cause                                                |
| ------ | ---------------------------------------------------- |
| 400    | Missing `identity`, or neither `id` nor `path` given |

**Example**

```bash
curl -X DELETE http://localhost:3100/assets \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"identity": {"id": "photo.jpg"}}'
```

---

## `GET /assets/recipes`

Lists which recipes have actually been computed for a given asset — the registry has no way to predict this upfront (core decides which recipes run for a given file), so it's read back from what was actually stored. Required scope: `assets:read`.

**Query parameters**

| Param  | Required           | Description                                                                             |
| ------ | ------------------ | --------------------------------------------------------------------------------------- |
| `id`   | one of `id`/`path` | Asset identity id (exact match)                                                         |
| `path` | one of `id`/`path` | Asset identity path (exact match here; partial search only applies via `/duplicates/*`) |

`id`/`path` are query params rather than a `:id`-style path segment — a `path` identity can contain `/`, which a raw URL path segment can't safely carry.

**Success response — `200`**

```json
{ "identity": { "id": "photo.jpg", "path": null }, "recipes": ["binary.sha256", "image.phash16"] }
```

**Example**

```bash
curl "http://localhost:3100/assets/recipes?id=photo.jpg" \
  -H "Authorization: Bearer $API_KEY"
```

---

## `GET /duplicates/matches`

Closest matches to one given asset, for one recipe — "which assets look like this one". Required scope: `assets:read`.

**Query parameters**

| Param       | Required           | Description                                                                                                                                     |
| ----------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | one of `id`/`path` | The asset's identity id to find matches for                                                                                                     |
| `path`      | one of `id`/`path` | The asset's identity path to find matches for                                                                                                   |
| `recipe`    | yes                | Which configured recipe to compare on                                                                                                           |
| `threshold` | no                 | Minimum similarity % (0-100, up to 2 decimals) - defaults to the project's/config's default. Ignored for exact-comparison recipes (always 100%) |
| `page`      | no                 | Page number, default `1`                                                                                                                        |
| `page_size` | no                 | Page size, default `20`, max `100`                                                                                                              |

**Success response - `200`**

```json
{
  "data": [{ "identity": { "id": "photo-copy.jpg", "path": null }, "distance": 1, "similarity": 98.4 }],
  "total_count": 1,
  "current_count": 1,
  "current_page": 1,
  "page_size": 20,
  "page_count": 1,
  "has_next_page": false,
  "has_previous_page": false
}
```

`distance` is the raw Hamming distance (always `0` for exact-comparison recipes).

**Errors**

| Status | Cause                                                               |
| ------ | ------------------------------------------------------------------- |
| 400    | Missing `id`/`path` and `recipe`, or a malformed `threshold`/`page` |
| 404    | Project not found, or the asset was never hashed for this recipe    |

**Example**

```bash
curl "http://localhost:3100/duplicates/matches?id=photo.jpg&recipe=image.phash16&threshold=90" \
  -H "Authorization: Bearer $API_KEY"
```

---

## `GET /duplicates/clusters`

All clusters of mutually similar assets for one recipe (connected components over the qualifying duplicate pairs) - transitive groups, not just direct pairs. Computed fresh for the given `threshold` and cached until the underlying data changes; `threshold` is not limited to the project's configured default - narrower or looser cuts are both answered exactly, not from a table baked to one value. Required scope: `assets:read`.

Every response includes a `generation` field. Pass it back as `?generation=` on subsequent pages of the _same_ listing to keep reading that exact snapshot, even if assets are added/removed in between - without it, each page reflects whatever's current at the moment it's requested, so a write landing between page 1 and page 2 can shift cluster membership or ordering across pages. A `generation` older than about an hour may have been cleaned up, in which case the response is `400` - restart pagination from page 1 without `generation` to get a current one.

**Query parameters**

| Param        | Required | Description                                                                                                       |
| ------------ | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `recipe`     | yes      | Which configured recipe to compare on                                                                             |
| `threshold`  | no       | Minimum similarity % - same rules as `/duplicates/matches`                                                        |
| `generation` | no       | Pin to a snapshot from a previous page's response (see above)                                                     |
| `id`         | no       | Only clusters containing a member with this exact identity id                                                     |
| `path`       | no       | Only clusters containing a member whose identity path matches this `@pimbay/search-query` term (e.g. `*invoice*`) |
| `page`       | no       | Page number, default `1`                                                                                          |
| `page_size`  | no       | Page size, default `20`, max `100`                                                                                |

**Success response - `200`**

```json
{
  "data": [
    {
      "cluster_id": "0f9e1a2b-...-...-...-...",
      "max_similarity": 99,
      "assets": [{ "identity": { "id": "photo.jpg", "path": null }, "avg_similarity_to_cluster": 98.5 }]
    }
  ],
  "total_count": 1,
  "current_count": 1,
  "current_page": 1,
  "page_size": 20,
  "page_count": 1,
  "has_next_page": false,
  "has_previous_page": false,
  "generation": 42
}
```

Scopes larger than `MAX_CLUSTER_EDGE_COUNT` (200,000 qualifying edges) return `400` - narrow `threshold`, or use `/duplicates/ranking` for a per-asset view instead.

**Example**

```bash
curl "http://localhost:3100/duplicates/clusters?recipe=image.phash16" \
  -H "Authorization: Bearer $API_KEY"
```

---

## `GET /duplicates/ranking`

Paginated list of assets ranked by duplicate count, for one recipe - "which assets have the most duplicates". Required scope: `assets:read`.

**Query parameters**

| Param         | Required | Description                                                                                 |
| ------------- | -------- | ------------------------------------------------------------------------------------------- |
| `recipe`      | yes      | Which configured recipe to compare on                                                       |
| `threshold`   | no       | Minimum similarity % - same rules as `/duplicates/matches`                                  |
| `id`          | no       | Only assets with this exact identity id                                                     |
| `path`        | no       | Only assets whose identity path matches this `@pimbay/search-query` term (e.g. `*invoice*`) |
| `page`        | no       | Page number, default `1`                                                                    |
| `page_size`   | no       | Page size, default `20`, max `100`                                                          |
| `match_limit` | no       | Max matches shown per asset                                                                 |

**Success response - `200`**

```json
{
  "data": [
    {
      "identity": { "id": "photo.jpg", "path": null },
      "duplicate_count": 2,
      "matches": [{ "identity": { "id": "photo-copy.jpg", "path": null }, "distance": 1, "similarity": 98.4 }]
    }
  ],
  "total_count": 1,
  "current_count": 1,
  "current_page": 1,
  "page_size": 20,
  "page_count": 1,
  "has_next_page": false,
  "has_previous_page": false
}
```

**Example**

```bash
curl "http://localhost:3100/duplicates/ranking?recipe=image.phash16&page_size=50" \
  -H "Authorization: Bearer $API_KEY"
```

---

## `GET /stats`

Scoped, single-project overview across every configured recipe - total assets, per-recipe asset/duplicate counts, and recent-activity counters.
Meant for a "project overview" screen (e.g. an admin bundle) that would otherwise have to page through `/duplicates/*` per recipe and aggregate client-side.
Required scope: `assets:read`.
No query parameters - project is derived from the API key, and duplicate counts use the project's configured `hamming_threshold` (or the registry-wide default) with no override.

Not to be confused with the `stats projects` CLI command, which is cross-project and admin-facing (see `docs/cli.md`) - both share the same counting service, just at different scopes.

**Success response - `200`**

```json
{
  "project": { "slug": "shop-prod", "name": "Shop Production" },
  "total_assets": 1204,
  "assets_per_recipe": [
    { "recipe": "binary.sha256", "asset_count": 1204 },
    { "recipe": "image.phash16", "asset_count": 980 }
  ],
  "duplicates_per_recipe": [
    {
      "recipe": "binary.sha256",
      "cluster_count": 12,
      "edge_count": 37,
      "assets_with_duplicate_count": 74,
      "assets_with_duplicate_pct": 6.14,
      "degraded": false
    },
    {
      "recipe": "image.phash16",
      "cluster_count": null,
      "edge_count": null,
      "assets_with_duplicate_count": null,
      "assets_with_duplicate_pct": null,
      "degraded": true
    }
  ],
  "last_asset_added_at": "2026-08-05T14:32:00Z",
  "assets_added_last_7d": 41,
  "assets_added_last_30d": 213
}
```

- `assets_per_recipe`/`duplicates_per_recipe` include one row per recipe in `project.recipes` - a recipe never hashed yet gets `asset_count: 0` and a zeroed, non-degraded `duplicates_per_recipe` row, rather than being omitted.
- `degraded: true` means this recipe's duplicate graph exceeded the safety cap used by `/duplicates/clusters` (`MAX_CLUSTER_EDGE_COUNT`, 200,000 edges) - its counts are `null`, but the rest of the response is still `200`. One oversized recipe never fails the whole overview.
- `EXACT`-comparison recipes (`cluster_count`/`edge_count`) are computed directly from stored hashes (`GROUP BY hash`), not via cluster computation - cheaper, since identical hashes never need transitive-closure resolution.
- `last_asset_added_at` is `null` for a project with no assets yet.

**Example**

```bash
curl "http://localhost:3100/stats" \
  -H "Authorization: Bearer $API_KEY"
```

---

## `GET /healthz`

No authentication required.

**Query parameters**

| Param  | Required | Description                                                                 |
| ------ | -------- | --------------------------------------------------------------------------- |
| `deep` | no       | `true` also checks DB and `asset-dedup-core` reachability (3s timeout each) |

**Success response — `200`** (shallow, default)

```json
{ "status": "ok" }
```

**Success/degraded response — `deep=true`**

```json
{ "status": "ok", "db_reachable": true, "core_reachable": true }
```

Returns `503` instead of `200` when `status` is `"degraded"` (either dependency unreachable).

**Example**

```bash
curl "http://localhost:3100/healthz?deep=true"
```
