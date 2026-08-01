# CLI Reference

```bash
npm run cli -- <group> <command> [options]
```

Every command supports `--json` for machine-readable output unless noted. `project` and `api-client` management has no HTTP equivalent — by design, provisioning is CLI-only.

---

## `project`

### `project create`

Create a new project.

| Option                    | Required | Description                                                                                        |
| ------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `--slug <slug>`           | yes      | Unique project slug (e.g. `pimbay-main`)                                                           |
| `--name <n>`              | yes      | Human-readable project name                                                                        |
| `--recipes <recipes>`     | yes      | Comma-separated recipes, must include at least one `binary.*` (e.g. `binary.sha256,image.phash16`) |
| `--hamming-threshold <n>` | no       | Minimum similarity % (0–100) for hamming duplicates — defaults to `config.yaml` if omitted         |
| `--json`                  | no       | Output as JSON                                                                                     |

```bash
npm run cli -- project create --slug shop-prod --name "Shop Production" --recipes binary.sha256,image.phash16
```

### `project update`

Update a project's recipes and/or hamming threshold.

| Option                    | Required | Description                                                                    |
| ------------------------- | -------- | ------------------------------------------------------------------------------ |
| `--slug <slug>`           | yes      | Project slug                                                                   |
| `--recipes <recipes>`     | no       | Comma-separated recipes, must include at least one `binary.*`                  |
| `--hamming-threshold <n>` | no       | Minimum similarity % (0–100), or `none` to clear it back to the config default |
| `--json`                  | no       | Output as JSON                                                                 |

```bash
npm run cli -- project update --slug shop-prod --hamming-threshold 90
```

### `project list`

List all projects. Options: `--json`.

### `project delete`

Permanently delete a project and everything under it (assets, hashes, duplicate data, API clients).

| Option          | Required | Description                                                                                 |
| --------------- | -------- | ------------------------------------------------------------------------------------------- |
| `--slug <slug>` | yes      | Project slug                                                                                |
| `--yes`         | no       | Actually perform the deletion — without it, only prints what would be deleted and exits `1` |

```bash
npm run cli -- project delete --slug shop-prod --yes
```

---

## `api-client`

### `api-client create`

Create a new API client and print the raw key. **The key is shown once and cannot be retrieved again** — only its hash is stored.

| Option              | Required | Description                                                |
| ------------------- | -------- | ---------------------------------------------------------- |
| `--project <slug>`  | yes      | Project slug                                               |
| `--name <name>`     | yes      | Client name (e.g. `pimcore-prod`)                          |
| `--scopes <scopes>` | yes      | Comma-separated scopes: `assets:write`, `assets:read`, `*` |
| `--json`            | no       | Output as JSON                                             |

```bash
npm run cli -- api-client create --project shop-prod --name pimcore-prod --scopes assets:write,assets:read
```

### `api-client list`

List API clients for a project (including revoked ones, with their revocation timestamp).

| Option             | Required | Description    |
| ------------------ | -------- | -------------- |
| `--project <slug>` | yes      | Project slug   |
| `--json`           | no       | Output as JSON |

### `api-client revoke`

Revoke an API client by ID. Re-issuing the same client **name** afterwards is allowed — the uniqueness constraint on `(project, name)` only applies to active (non-revoked) clients.

| Option      | Required | Description     |
| ----------- | -------- | --------------- |
| `--id <id>` | yes      | API client UUID |

```bash
npm run cli -- api-client revoke --id 3fa2c1e0-...
```

---

## `asset`

Hash and manage assets directly from the CLI — no API client / bearer token needed, since the CLI already has direct database and (indirectly, via the container) core access.

### `asset add`

Hash a single local file and add it as an asset. Re-running on the same identity updates it (or reports `unchanged` per recipe if the hash didn't change) — at least one of `--id`/`--path` is required.

| Option             | Required               | Description                                                       |
| ------------------ | ---------------------- | ----------------------------------------------------------------- |
| `--project <slug>` | yes                    | Project slug                                                      |
| `--id <id>`        | one of `--id`/`--path` | Asset identity id (opaque to the registry — your own external id) |
| `--path <path>`    | one of `--id`/`--path` | Asset identity path (supports partial search, unlike `--id`)      |
| `--file <path>`    | yes                    | Path to the local file to hash                                    |
| `--json`           | no                     | Output as JSON                                                    |

The MIME hint is derived from the file's extension — a file with no extension is rejected.

```bash
npm run cli -- asset add --project shop-prod --id photos/1.jpg --file ./1.jpg
```

### `asset scan`

Hash every file under a local directory and add/update them as assets, in one process/DB connection — much faster than calling `asset add` in a loop for a large batch. Every file is added by `path` identity only (no `--id`).

| Option                   | Required | Description                                                                                                                            |
| ------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `--project <slug>`       | yes      | Project slug                                                                                                                           |
| `--root <path>`          | yes      | Directory to scan                                                                                                                      |
| `--include <glob>`       | no       | Glob pattern relative to `--root`, repeatable (default: `**/*`, everything)                                                            |
| `--path-prefix <prefix>` | no       | Prefix asset paths with this instead of using the absolute local path (e.g. `s3://my-bucket/` if this local copy mirrors an S3 layout) |
| `--json`                 | no       | Output a JSON summary instead of per-file progress lines                                                                               |

Prints one line per file (`created`/`updated`/`unchanged`/`failed`) as it goes, then a summary. A file that fails to hash doesn't stop the scan — it's reported and the exit code is `1` if any file failed.

```bash
npm run cli -- asset scan --project shop-prod --root ./photos --path-prefix "s3://my-bucket/"
```

### `asset delete`

Delete an asset (and its hashes/duplicate data, cascaded). At least one of `--id`/`--path` is required.

| Option             | Required               | Description         |
| ------------------ | ---------------------- | ------------------- |
| `--project <slug>` | yes                    | Project slug        |
| `--id <id>`        | one of `--id`/`--path` | Asset identity id   |
| `--path <path>`    | one of `--id`/`--path` | Asset identity path |

### `asset recipes`

List which recipes have actually been computed for a given asset. At least one of `--id`/`--path` is required.

| Option             | Required               | Description         |
| ------------------ | ---------------------- | ------------------- |
| `--project <slug>` | yes                    | Project slug        |
| `--id <id>`        | one of `--id`/`--path` | Asset identity id   |
| `--path <path>`    | one of `--id`/`--path` | Asset identity path |
| `--json`           | no                     | Output as JSON      |

---

## `duplicates`

### `duplicates matches`

Paginated list of the closest matches for a single asset — "which assets look like this one". At least one of `--id`/`--path` is required.

| Option              | Required               | Description                                                                                                                  |
| ------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `--project <slug>`  | yes                    | Project slug                                                                                                                 |
| `--id <id>`         | one of `--id`/`--path` | Asset identity id                                                                                                            |
| `--path <path>`     | one of `--id`/`--path` | Asset identity path                                                                                                          |
| `--recipe <recipe>` | yes                    | Recipe to compare on (must be one of the project's configured recipes)                                                       |
| `--threshold <pct>` | no                     | Minimum similarity % (0-100) - defaults to the project/config default. Ignored (with a warning) for exact-comparison recipes |
| `--page <n>`        | no                     | Page number (default: 1)                                                                                                     |
| `--page-size <n>`   | no                     | Page size (default: 20, max 100)                                                                                             |
| `--json`            | no                     | Output as JSON                                                                                                               |

For a hamming-comparison recipe the table shows `similarity` and `distance`; for an exact-comparison recipe `distance` is omitted (always `0`).

```bash
npm run cli -- duplicates matches --project shop-prod --id photos/1.jpg --recipe image.phash16 --threshold 90
```

### `duplicates clusters`

Paginated list of clusters of mutually similar assets (connected components over the qualifying duplicate pairs) - transitive groups, not just direct pairs. Computed fresh for `--threshold` and cached until the underlying data changes; `--threshold` is not limited to the project's configured default.

Every run prints (or, with `--json`, includes) a `generation` value. Pass it back via `--generation` on later pages of the _same_ listing to keep reading that exact snapshot rather than whatever's current at the time each page is requested - a generation older than roughly an hour may have aged out, in which case the command errors and pagination should restart from page 1 without `--generation`.

| Option              | Required | Description                                                                       |
| ------------------- | -------- | --------------------------------------------------------------------------------- |
| `--project <slug>`  | yes      | Project slug                                                                      |
| `--recipe <recipe>` | yes      | Recipe to compare on                                                              |
| `--threshold <pct>` | no       | Minimum similarity % (0-100)                                                      |
| `--generation <n>`  | no       | Pin to a snapshot from a previous run (see above)                                 |
| `--id <id>`         | no       | Only clusters containing a member with this exact identity id                     |
| `--path <term>`     | no       | Only clusters containing a member whose path matches this term (e.g. `*invoice*`) |
| `--page <n>`        | no       | Page number (default: 1)                                                          |
| `--page-size <n>`   | no       | Page size (default: 20, max 100)                                                  |
| `--json`            | no       | Output as JSON                                                                    |

### `duplicates ranking`

Paginated list of assets ranked by duplicate count, with each asset's matches nested underneath.

| Option              | Required | Description                                                 |
| ------------------- | -------- | ----------------------------------------------------------- |
| `--project <slug>`  | yes      | Project slug                                                |
| `--recipe <recipe>` | yes      | Recipe to compare on                                        |
| `--threshold <pct>` | no       | Minimum similarity % (0-100)                                |
| `--id <id>`         | no       | Only assets with this exact identity id                     |
| `--path <term>`     | no       | Only assets whose path matches this term (e.g. `*invoice*`) |
| `--page <n>`        | no       | Page number (default: 1)                                    |
| `--page-size <n>`   | no       | Page size (default: 20, max 100)                            |
| `--match-limit <n>` | no       | Max matches shown per asset                                 |
| `--json`            | no       | Output as JSON                                              |

```
asset_id               similarity  duplicate_count
---------------------  ----------  ---------------
id=photos/1.jpg                     2
* id=photos/2.jpg      98.4
* id=photos/3.jpg      87.5

Page 1/1 - 1 assets total.
```

### `duplicates recompute`

Bulk-recomputes all hamming-comparison duplicate data for a project's configured recipes — e.g. after changing `--hamming-threshold`, since `project update` never retroactively touches existing rows. Exact-comparison recipes are skipped, since exact matches never depend on the threshold.

| Option             | Required | Description                                          |
| ------------------ | -------- | ---------------------------------------------------- |
| `--project <slug>` | yes      | Project slug                                         |
| `--batch-size <n>` | no       | Assets processed per batch (default: 200, max: 1000) |

Deletes all stale duplicate rows for the affected recipes first, then walks the project's assets in fixed-size batches, printing progress as it goes.

```bash
npm run cli -- project update --slug shop-prod --hamming-threshold 95
npm run cli -- duplicates recompute --project shop-prod
```

## `stats`

Read-only, derived statistics — kept separate from `project` (config) on purpose.
Cross-project and admin-facing; for a single, scoped project's per-recipe breakdown (asset/duplicate counts per recipe, recent-activity counters), see `GET /stats` in `docs/api.md` instead.
Both share the same counting service (`ProjectStatsService`), so the two never drift.

### `stats projects`

Per-project asset and duplicate-pair counts, across all projects. `duplicate_pairs` counts distinct duplicate pairs, not the raw (directional) row count.

| Option   | Required | Description    |
| -------- | -------- | -------------- |
| `--json` | no       | Output as JSON |

```bash
npm run cli -- stats projects
```

```
slug        name            assets  duplicate_pairs
----------  --------------  ------  ---------------
shop-prod   Shop Production  1204   37
```
