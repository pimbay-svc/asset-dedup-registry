# Usage Reference

The README's Usage section is deliberately minimal — one query, two transports.
This file holds everything that doesn't fit there: the full provisioning-to-query workflow, threshold tuning, and edge cases worth calling out explicitly.

Every command and every block of output below is real, copied from an actual local run — nothing invented, nothing abbreviated.

## A full provisioning → indexing → query workflow

This walks through the entire lifecycle: bring up the database, provision a project, add assets one at a time and in bulk, then read the same duplicate data back three different ways.

### 1. Start Postgres and migrate

```bash
docker compose up postgres -d
npm run migrate
```

### 2. Provision a project

A fresh instance has no projects yet:

```bash
npm run cli -- project list
```

```text
(no results)
```

Create one — at least one `binary.*` recipe is required, even if you plan to add more later:

```bash
npm run cli -- project create --slug pimbay --name PimBay --recipes binary.sha256
```

```text
id                                    slug    name    recipes        hamming_threshold  rate_limit_per_minute
------------------------------------  ------  ------  -------------  -----------------  ---------------------
d898b7e8-f22b-4b5d-8054-d84ddfd0f35e  pimbay  PimBay  binary.sha256
```

Add the recipes you actually care about — `project update` replaces the full list, it doesn't append:

```bash
npm run cli -- project update --slug pimbay --recipes binary.sha256,image.sha256,image.phash16
```

```text
id                                    slug    name    recipes                                     hamming_threshold  rate_limit_per_minute
------------------------------------  ------  ------  ------------------------------------------  -----------------  ---------------------
f7949db0-af77-4353-8555-a0324ba8658b  pimbay  PimBay  binary.sha256, image.sha256, image.phash16
```

### 3. Create an API client

Needed for the HTTP API — the CLI itself doesn't use API keys, since it already has direct database access.

```bash
npm run cli -- api-client create --project pimbay --name pimcore-prod --scopes '*'
```

```text
id                                    name          scopes
------------------------------------  ------------  ------
6b7c1d44-7552-45e9-bc5e-34a9b66ded4f  pimcore-prod  *

API Key (shown ONCE — store it securely):
4abfa6936cd66a046a650f1571b74afb008505dc280bd29517e5709c35ceefe1
```

The raw key is printed exactly once — only its hash is stored, so if you lose it, the fix is `api-client revoke` plus a new `api-client create`, not a lookup.

### 4. Add a single asset

```bash
npm run cli -- asset add --project pimbay --path /Downloads/test/001.jpg --file ~/Downloads/test/001.jpg
```

```text
recipe         hashes                                                            status
-------------  ----------------------------------------------------------------  -------
image.sha256   c816b1660d65704bccaa9648142cfd7fe05d032543911c399cbb412113337f45  created
image.phash16  9139c4f6894d8a1f9b9eea69a2332dc06ca5769670a3131ff66835e3d631893c  created
```

Both configured image recipes get hashed in one call — `asset add` computes every project recipe whose mime group matches the file, not one at a time. `asset recipes` confirms both are now on record for this asset:

```bash
npm run cli -- asset recipes --project pimbay --path /Downloads/test/001.jpg
```

```text
recipe
-------------
image.phash16
image.sha256
```

### 5. Bulk-add the rest with `asset scan`

```bash
npm run cli -- asset scan --project pimbay --path-prefix /Downloads/test/ --root ~/Downloads/test
```

```text
unchanged /Downloads/test/001.jpg
created   /Downloads/test/002.png
created   /Downloads/test/003.jpeg
created   /Downloads/test/004-crop.png
created   /Downloads/test/004-crop2.png
created   /Downloads/test/005-blur.png

Done: 6 files — 5 created, 0 updated, 1 unchanged, 0 failed.
```

`scan` is idempotent per identity — re-running it over an asset that's already indexed and unchanged reports `unchanged` rather than re-writing it, which is exactly what happened to `001.jpg` here, since it was already added in step 4.

### 6. Query duplicates — exact vs. perceptual

Same asset, two different recipes, two different kinds of answer:

```bash
npm run cli -- duplicates matches --project pimbay --path /Downloads/test/001.jpg --recipe image.phash16
```

```text
asset_id                           similarity  distance
---------------------------------  ----------  --------
path=/Downloads/test/002.png       100         0
path=/Downloads/test/003.jpeg      100         0
path=/Downloads/test/005-blur.png  98.4        4
path=/Downloads/test/004-crop.png  82          46
```

`004-crop.png` already shows up here at the config's 80% default `hamming_threshold` — it takes a lower threshold to surface `004-crop2.png` too, which is what the next section demonstrates.

```bash
npm run cli -- duplicates matches --project pimbay --path /Downloads/test/001.jpg --recipe image.sha256
```

```text
asset_id                      similarity
----------------------------  ----------
path=/Downloads/test/002.png  100
```

Note the missing `distance` column on the `sha256` result — see [Edge cases](#edge-cases) below for why.

## Advanced usage: recomputing after a threshold change

`duplicates matches`/`clusters`/`ranking` all read from a table of duplicate pairs computed once, at hash time — not recalculated live on every query. Lowering (or raising) a project's `hamming_threshold` does **not** retroactively touch that table:

```bash
npm run cli -- project update --slug pimbay --hamming-threshold 40
```

```text
id                                    slug    name    recipes                                     hamming_threshold  rate_limit_per_minute
------------------------------------  ------  ------  ------------------------------------------  -----------------  ---------------------
f7949db0-af77-4353-8555-a0324ba8658b  pimbay  PimBay  binary.sha256, image.sha256, image.phash16  40.00
```

Querying `matches` again right after this would still return the old, pre-threshold-change result set — the setting changed, but no existing row was touched. `duplicates recompute` is what actually rebuilds the table against the new threshold:

```bash
npm run cli -- duplicates recompute --project pimbay
```

```text
Recomputing 'image.phash16' (threshold 40%)...
  6 assets processed...
  done: 6 asset(s) processed for 'image.phash16'.
```

_Now_ the same query picks up `004-crop2.png` — at 53.1%, it was below the 80% default used by the query above, but clears the new 40% threshold:

```bash
npm run cli -- duplicates matches --project pimbay --path /Downloads/test/001.jpg --recipe image.phash16
```

```text
asset_id                            similarity  distance
-----------------------------------  ----------  --------
path=/Downloads/test/002.png        100         0
path=/Downloads/test/003.jpeg       100         0
path=/Downloads/test/005-blur.png   98.4        4
path=/Downloads/test/004-crop.png   82          46
path=/Downloads/test/004-crop2.png  53.1        120
```

## The same underlying data, three ways

With the full 5-asset picture in place, the three duplicate views answer three different questions.

**`ranking`** — every asset, sorted by duplicate count, matches nested underneath. The natural starting point for a cleanup pass:

```bash
npm run cli -- duplicates ranking --project pimbay --recipe image.phash16 --threshold 80 --match-limit 5
```

```text
asset_id                             similarity  duplicate_count
-----------------------------------  ----------  ---------------
path=/Downloads/test/001.jpg                      4
* path=/Downloads/test/002.png       100
* path=/Downloads/test/003.jpeg      100
* path=/Downloads/test/005-blur.png  98.4
* path=/Downloads/test/004-crop.png  82

path=/Downloads/test/002.png                      4
* path=/Downloads/test/001.jpg       100
* path=/Downloads/test/003.jpeg      100
* path=/Downloads/test/005-blur.png  98.4
* path=/Downloads/test/004-crop.png  82

path=/Downloads/test/003.jpeg                     4
* path=/Downloads/test/002.png       100
* path=/Downloads/test/001.jpg       100
* path=/Downloads/test/005-blur.png  98.4
* path=/Downloads/test/004-crop.png  82

path=/Downloads/test/004-crop.png                 4
* path=/Downloads/test/005-blur.png  82.8
* path=/Downloads/test/002.png       82
* path=/Downloads/test/001.jpg       82
* path=/Downloads/test/003.jpeg      82

path=/Downloads/test/005-blur.png                 4
* path=/Downloads/test/002.png       98.4
* path=/Downloads/test/001.jpg       98.4
* path=/Downloads/test/003.jpeg      98.4
* path=/Downloads/test/004-crop.png  82.8

Page 1/1 — 5 assets total.
```

**`clusters`** — the whole group as one transitive unit. `avg_similarity` here is each asset's average similarity _to the rest of the cluster_, not to any single other asset — that's why `001.jpg` and `002.png` show `96.1` even though their pairwise match above was a clean `100`:

```bash
npm run cli -- duplicates clusters --project pimbay --recipe image.phash16 --threshold 80
```

```text
3b431d81-0ee1-466a-b15b-591c78753b47 (max similarity 100%)
asset_id                           avg_similarity
---------------------------------  --------------
path=/Downloads/test/004-crop.png  82.2
path=/Downloads/test/002.png       96.1
path=/Downloads/test/001.jpg       96.1
path=/Downloads/test/003.jpeg      95.1
path=/Downloads/test/005-blur.png  94.5

Page 1/1 — 1 clusters total.
generation: 13 (pass --generation to keep paging this snapshot)
```

Pass that `generation` value back on later pages of the _same_ listing (`--generation 13`) to keep reading this exact snapshot even if new assets get added mid-read.

## Cross-project stats

`stats projects` is the cross-project view — asset and duplicate-pair counts for everything in one instance:

```bash
npm run cli -- stats projects
```

```text
slug    name    assets  duplicate_pairs
------  ------  ------  ---------------
pimbay  PimBay  6       16
```

The single-project, per-recipe breakdown used in the README's dashboard-style output is `GET /stats` over HTTP, scoped by API key:

```bash
curl -s "http://localhost:3100/stats" \
  -H "Authorization: Bearer 4abfa6936cd66a046a650f1571b74afb008505dc280bd29517e5709c35ceefe1" | jq
```

```json
{
  "project": { "slug": "pimbay", "name": "PimBay" },
  "total_assets": 6,
  "assets_per_recipe": [
    { "recipe": "binary.sha256", "asset_count": 0 },
    { "recipe": "image.sha256", "asset_count": 6 },
    { "recipe": "image.phash16", "asset_count": 6 }
  ],
  "duplicates_per_recipe": [
    {
      "recipe": "binary.sha256",
      "cluster_count": 0,
      "edge_count": 0,
      "assets_with_duplicate_count": 0,
      "assets_with_duplicate_pct": 0,
      "degraded": false
    },
    {
      "recipe": "image.sha256",
      "cluster_count": 1,
      "edge_count": 1,
      "assets_with_duplicate_count": 2,
      "assets_with_duplicate_pct": 33.33,
      "degraded": false
    },
    {
      "recipe": "image.phash16",
      "cluster_count": 1,
      "edge_count": 15,
      "assets_with_duplicate_count": 6,
      "assets_with_duplicate_pct": 100,
      "degraded": false
    }
  ],
  "last_asset_added_at": "2026-09-17T18:29:09.939Z",
  "assets_added_last_7d": 6,
  "assets_added_last_30d": 6
}
```

`binary.sha256` sits at 0 assets throughout this walkthrough — every file added in it happened to be an image, so nothing ever landed in the `binary` mime group. That's expected, not an error: `binary.sha256` stays configured on the project because at least one `binary.*` recipe is required, whether or not anything ever actually uses it.

## Edge cases

### `threshold` is accepted but ignored for exact-comparison recipes

The `image.sha256` result in step 6 has no `distance` column and only ever answers "identical or not" — `sha256` is an exact-comparison algorithm, so a `--threshold` value has nothing to scale. Passing one on an exact-comparison recipe is accepted, not rejected, but a warning is printed to stderr and the value has no effect on the result. This is why the README's HTTP example passes `threshold=80` for `image.phash16` specifically — the same query against `image.sha256` would answer the same way regardless of what threshold was passed.

### `id` and `path` are independent identities, not aliases

Every command above uses `--path`, matching how `asset scan`/`asset add` indexed these files. A lookup by `--id` on an asset that was only ever given a `--path` won't find it — `id` and `path` are two separate fields on an asset's identity, not two names for the same thing. Picking the wrong one doesn't silently fall back to the other; it returns a 404 (`GET /assets/recipes`, `duplicates matches`) as if the asset didn't exist at all.

### A low threshold isn't "safer," it's noise

Nothing in this walkthrough demonstrates it directly, but it's worth stating for anyone tempted to set `hamming_threshold` very low "just to be safe": below a certain point (roughly 50% for a 256-bit hash like `phash16`), similarity scores stop distinguishing real duplicates from unrelated images — that's the statistical noise floor for random bit agreement, not a stricter search. A threshold set that low doesn't just add false positives to `matches`; it drags down `clusters`' `avg_similarity` for every legitimate member of a cluster a noise-level asset gets pulled into.
