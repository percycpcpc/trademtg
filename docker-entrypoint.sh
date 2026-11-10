#!/bin/sh
set -eu
export PORT="${PORT:-3000}"
node ./node_modules/prisma/build/index.js migrate deploy
node scripts/backfill-type-lines.mjs || true
exec node server.js
