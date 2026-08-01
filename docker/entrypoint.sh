#!/bin/sh
set -e

echo "[entrypoint] running migrations..."
node dist/infrastructure/drizzle/migrate.js

echo "[entrypoint] starting: $*"
exec "$@"