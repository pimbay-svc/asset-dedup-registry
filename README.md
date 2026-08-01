# asset-dedup-registry

[![Docker Image](https://img.shields.io/badge/docker.io-pimbay%2Fasset--dedup--registry-blue?style=flat-square&logo=docker)](https://hub.docker.com/r/pimbay/asset-dedup-registry)
[![Node Version](https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&logo=node.js)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-Unlicense-green?style=flat-square)](LICENSE)
[![Coverage](https://img.shields.io/badge/coverage-100%25-brightgreen?style=flat-square)](https://codeberg.org/pimbay-svc/asset-dedup-registry)
[![Mutation Score](https://img.shields.io/badge/MSI-100%25-brightgreen?style=flat-square)](https://codeberg.org/pimbay-svc/asset-dedup-registry)

Stateful indexing and duplicate-detection layer for the asset-dedup ecosystem.
It stores `project + recipe + assetId → hash` pairs and precomputed similarity data in PostgreSQL, and exposes authenticated duplicate lookup/grouping over HTTP.
Unlike `asset-dedup-core` and its extensions, this service is the ecosystem's **only stateful, multi-tenant boundary** — every endpoint except `/healthz` requires an API key bound to exactly one project.

## Quick Start (Local)

```bash
npm install
cp .env.example .env
cp config/config.example.yaml config/config.yaml
npm run migrate
npm run dev
```

Requires a reachable PostgreSQL 16+ database (the schema uses `bit_count()`, PG14+) and a running `asset-dedup-core` instance at the URL configured in `config.yaml`.

Provision a project and an API key before calling the API:

```bash
npm run cli -- project create --slug shop-prod --name "Shop Production" --recipes binary.sha256,image.phash16
npm run cli -- api-client create --project shop-prod --name my-app --scopes assets:write,assets:read
# prints the raw API key ONCE — store it securely, it is never shown again
```

## Quick Start (Docker)

```bash
docker compose up postgres -d
npm run migrate
npm run dev
```

`docker-compose.yml` only runs Postgres by default — migrations and the app itself run locally against it, so schema changes don't require an image rebuild.
The `registry` service (full containerized build, `docker compose up --build`) is available for testing the actual production image, but is not the default local workflow.

## Configuration

| Variable       | Required | Description                                                            |
| -------------- | -------- | ---------------------------------------------------------------------- |
| `CONFIG_PATH`  | yes      | Path to the service's YAML config file — no default.                   |
| `DATABASE_URL` | yes      | PostgreSQL connection string.                                          |
| `NODE_ENV`     | no       | `development` \| `production` \| `test`. Controls log pretty-printing. |

Full reference (all env vars, all `config.yaml` keys): **[docs/configuration.md](docs/configuration.md)**.

## Usage

The core thing this service is for: given one asset, find what already looks like it.

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

The same query over HTTP:

```bash
curl -s "http://localhost:3100/duplicates/matches?path=/Downloads/test/001.jpg&recipe=image.phash16&threshold=80" \
  -H "Authorization: Bearer $API_KEY" | jq
```

```json
{
  "data": [
    { "identity": { "id": null, "path": "/Downloads/test/002.png" }, "distance": 0, "similarity": 100 },
    { "identity": { "id": null, "path": "/Downloads/test/003.jpeg" }, "distance": 0, "similarity": 100 },
    { "identity": { "id": null, "path": "/Downloads/test/005-blur.png" }, "distance": 4, "similarity": 98.4 },
    { "identity": { "id": null, "path": "/Downloads/test/004-crop.png" }, "distance": 46, "similarity": 82 }
  ],
  "total_count": 4,
  "current_count": 4,
  "current_page": 1,
  "page_size": 20,
  "page_count": 1,
  "has_next_page": false,
  "has_previous_page": false
}
```

A full provisioning-to-query workflow (project setup, bulk scanning, threshold tuning, `ranking`/`clusters`, stats), plus edge cases worth knowing about: **[docs/usage.md](docs/usage.md)**.

## API

All endpoints except `GET /healthz` require `Authorization: Bearer <api-key>`. The project is always derived from the key, never from the request body/query.

| Method   | Path                        | Description                                                   |
| -------- | --------------------------- | ------------------------------------------------------------- |
| `POST`   | `/assets`                   | Hash and add/update an asset (one or more recipes per call)   |
| `DELETE` | `/assets`                   | Remove an asset and its hashes/duplicate data                 |
| `GET`    | `/assets/:asset_id/recipes` | Which recipes have actually been computed for an asset        |
| `GET`    | `/duplicates/matches`       | Closest matches to one given asset, for one recipe, paginated |
| `GET`    | `/duplicates/groups`        | All mutually-similar groups, for one recipe, paginated        |
| `GET`    | `/duplicates/ranking`       | Assets ranked by duplicate count, paginated                   |
| `GET`    | `/healthz`                  | Healthcheck (`?deep=true` also checks DB + core reachability) |

Full request/response shapes, error codes, and `curl` examples: **[docs/api.md](docs/api.md)**.

## CLI

Projects and API clients are managed exclusively via the CLI — there is no public endpoint to create either, by design.

```bash
npm run cli -- project --help
npm run cli -- api-client --help
npm run cli -- asset --help
npm run cli -- duplicates --help
npm run cli -- stats --help
```

| Command                | Description                                                    |
| ---------------------- | -------------------------------------------------------------- |
| `project create`       | Create a project (slug, name, recipes, hamming threshold)      |
| `project update`       | Update a project's recipes and/or hamming threshold            |
| `project list`         | List all projects                                              |
| `project delete`       | Delete a project and everything under it (requires `--yes`)    |
| `api-client create`    | Create an API client and print its key (shown once)            |
| `api-client list`      | List API clients for a project                                 |
| `api-client revoke`    | Revoke an API client                                           |
| `asset add`            | Hash a single local file and add/update it as an asset         |
| `asset scan`           | Hash every file under a local directory                        |
| `asset delete`         | Delete an asset                                                |
| `asset recipes`        | List which recipes were actually computed for an asset         |
| `duplicates matches`   | Paginated list of the closest matches for a single asset       |
| `duplicates groups`    | Paginated list of groups of mutually similar assets            |
| `duplicates ranking`   | Paginated list of assets ranked by duplicate count             |
| `duplicates recompute` | Bulk-recompute hamming duplicate data after a threshold change |
| `stats projects`       | Per-project asset and duplicate-pair counts                    |

Full option reference and example output: **[docs/cli.md](docs/cli.md)**.

## Testing

```bash
npm run test:unit
npm run test:integration
npm run test:all
npm run test:coverage
npm run test:mutation           # incremental, against the committed .stryker/incremental.json
npm run test:mutation:snapshot  # full run from scratch; regenerates and overwrites that snapshot
```

Integration tests spin up a real PostgreSQL via Testcontainers (Docker required) and apply `migration/` with the same migrator `npm run migrate` uses in production.

Mutation testing runs incrementally in CI against a snapshot committed to git — only files that changed since the snapshot get re-tested.
Regenerate the snapshot with `test:mutation:snapshot` and commit the result after a large refactor (especially test-only changes), or if a mutation report looks suspiciously clean.

## Development Helpers

```bash
npm run js:lint       # check
npm run js:lint:fix   # fix
npm run js:format     # check
npm run js:format:fix # fix
npm run js:typecheck  # tsc --noEmit
npm run migrate       # apply migration/*.sql

# after editing src/infrastructure/drizzle/schema/*.ts, generate the matching migration (needs DATABASE_URL set, but not a reachable database)
npx drizzle-kit generate --name title
```

## Architecture & Decisions

- **[docs/context.md](docs/context.md)** — non-obvious rules and past mistakes; read this for what the code doesn't say.
- **[docs/DECISIONS.md](docs/DECISIONS.md)** — why things are built the way they are, in the order the decisions were made.
- **[docs/CHANGELOG.md](docs/CHANGELOG.md)** — version history.

## License

Public domain — [Unlicense](LICENSE)

Created by [Jan Sarmir](https://pimbay.dev) · No conditions · No copyright

Bundled third-party dependencies and their licenses: **[docs/THIRD-PARTY-NOTICES.md](docs/THIRD-PARTY-NOTICES.md)**.
