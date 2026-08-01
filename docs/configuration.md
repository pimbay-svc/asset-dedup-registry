# Configuration Reference

Two layers: **env vars** (bootstrap only — where to find the config file, secrets that shouldn't sit in a YAML file on disk) and **`config.yaml`** (everything else, validated by a zod schema at startup — see `src/infrastructure/config/types.ts`).

## Environment variables

| Variable       | Required | Description                                                                                                                        |
| -------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `CONFIG_PATH`  | yes      | Path to `config.yaml`. No default — the app fails fast with a clear error if unset rather than guessing a container-specific path. |
| `DATABASE_URL` | yes      | PostgreSQL connection string. No default, for the same reason as `CONFIG_PATH`.                                                    |
| `NODE_ENV`     | no       | `development` \| `production` \| `test`. Default `production`. Controls log pretty-printing — see AGENTS.md.                       |
| `LOG_LEVEL`    | no       | `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal` \| `silent`. Default `info`.                                          |
| `PORT`         | no       | HTTP port the registry listens on. Default `3100`.                                                                                 |

## `config.yaml` reference

Schema source of truth: `src/infrastructure/config/types.ts`.
Every key below is validated at startup — an invalid or missing required key fails the process immediately rather than at first use.

No `${ENV_VAR}` substitution — `config.yaml` is static YAML, and secrets (the database connection string) live in `DATABASE_URL` instead, never in this file.

| Key                             | Type   | Required | Default | Description                                                                                                                                                                         |
| ------------------------------- | ------ | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core_base_url`                 | url    | yes      | —       | Base URL of the `asset-dedup-core` instance this registry hashes files against.                                                                                                     |
| `core_timeout_ms`               | number | no       | `10000` | Request timeout (ms) for calls to core.                                                                                                                                             |
| `default_hamming_threshold`     | number | yes      | —       | Fallback minimum similarity % (0–100) for hamming-comparison recipes, used whenever a project hasn't set its own `hamming_threshold` (`project create/update --hamming-threshold`). |
| `default_rate_limit_per_minute` | number | no       | `300`   | Fallback per-API-key requests/minute, used whenever a project hasn't set its own `rate_limit_per_minute` (`project create/update --rate-limit`).                                    |
| `database.pool_size`            | number | no       | `10`    | PostgreSQL connection pool size.                                                                                                                                                    |

**Example `config.yaml`**

```yaml
core_base_url: http://asset-dedup-core:3000
core_timeout_ms: 10000

# Fallback minimum similarity percentage (0-100) for hamming duplicate matching, used when a project hasn't set its own.
default_hamming_threshold: 85

# Fallback per-API-key requests/minute, used when a project hasn't set its own `rate_limit_per_minute`.
default_rate_limit_per_minute: 300

database:
  pool_size: 10
```
