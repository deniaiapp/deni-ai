#!/bin/sh
set -eu

if [ "${SKIP_DB_MIGRATE:-false}" != "true" ]; then
  echo "Applying database migrations..."
  node ./scripts/db-migrate.mjs
fi

exec node server.js
