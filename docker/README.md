# asset-dedup-registry

Stateful indexing and duplicate-detection layer for the asset-dedup ecosystem.
It stores `project + recipe + assetId → hash` pairs and precomputed similarity data in PostgreSQL, and exposes authenticated duplicate lookup/grouping over HTTP.
Unlike `asset-dedup-core` and its extensions, this service is the ecosystem's only stateful, multi-tenant boundary — every endpoint except `/healthz` requires an API key bound to exactly one project.

## Quick Start

```bash
docker run --rm \
  -v /path/to/config.yaml:/etc/asset-dedup-registry/config.yaml:ro \
  -e CONFIG_PATH=/etc/asset-dedup-registry/config.yaml \
  -e DATABASE_URL=postgres://postgres:postgres@host.docker.internal:5432/asset_dedup_registry \
  -p 3100:3100 \
  pimbay/asset-dedup-registry:latest
```

Requires a reachable PostgreSQL 16+ database (the schema uses `bit_count()`, PG14+) and a running `asset-dedup-core` instance at the URL configured in `config.yaml`.
Run `asset-dedup-registry-cli migrate` (or `npm run migrate` from source) against the database before starting the container for the first time.

## Docker Compose

```yaml
services:
  registry:
    image: pimbay/asset-dedup-registry:latest
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - '127.0.0.1:3100:3100'
    environment:
      NODE_ENV: production
      LOG_LEVEL: info
      CONFIG_PATH: /etc/asset-dedup-registry/config.yaml
      DATABASE_URL: postgres://postgres:postgres@postgres:5432/asset_dedup_registry
    volumes:
      - ./config/config.yaml:/etc/asset-dedup-registry/config.yaml:ro
    restart: unless-stopped
```

`config.yaml` is read-only inside the container and must exist on the host before the container starts — see `config/config.example.yaml` in the repo for the full key reference.

## Environment Variables

| Variable       | Required | Default | Description                                                            |
| -------------- | -------- | ------- | ---------------------------------------------------------------------- |
| `CONFIG_PATH`  | Yes      | —       | Path to the service's YAML config file inside the container            |
| `DATABASE_URL` | Yes      | —       | PostgreSQL connection string                                           |
| `NODE_ENV`     | No       | —       | `development` \| `production` \| `test` — controls log pretty-printing |
| `LOG_LEVEL`    | No       | `info`  | pino log level (`trace`, `debug`, `info`, `warn`, `error`, `fatal`)    |
| `PORT`         | No       | `3100`  | HTTP listen port                                                       |

## Volumes

| Container path                          | Description                                      |
| --------------------------------------- | ------------------------------------------------ |
| `/etc/asset-dedup-registry/config.yaml` | The service's YAML config file — mount read-only |

## Ports

| Port   | Protocol | Description                 |
| ------ | -------- | --------------------------- |
| `3100` | HTTP     | REST API and `GET /healthz` |

## Tags

| Tag      | Description                         |
| -------- | ----------------------------------- |
| `latest` | latest stable release               |
| `1.0`    | major.minor — updated on each patch |
| `1.0.0`  | exact version                       |

Images are published to both registries on each release:

```bash
docker pull pimbay/asset-dedup-registry:latest
docker pull ghcr.io/pimbay-svc/asset-dedup-registry:latest
```

## License

Public domain — Unlicense

Created by Jan Sarmir · No conditions · No copyright
