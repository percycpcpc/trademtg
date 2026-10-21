#!/bin/sh
set -eu
export PORT="${PORT:-3000}"
node ./node_modules/prisma/build/index.js migrate deploy
exec node server.js
