#!/bin/sh
# Installerar beroenden vid behov och kör sedan importen.
# Alla argument skickas vidare till importern (--dry-run, --manual).
set -e

if [ ! -d node_modules/tsx ]; then
  echo "[fia-import] node_modules saknas — installerar beroenden"
  npm ci --no-audit --no-fund
fi

exec npx tsx src/importer/run.ts "$@"
