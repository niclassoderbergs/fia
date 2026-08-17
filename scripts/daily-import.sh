#!/usr/bin/env bash
#
# Dygnskörning av eSett-importen. Körs av cron på servern:
#
#   30 4 * * * /home/niclas/docker/fia/scripts/daily-import.sh
#
# Själva starttiden slumpas ytterligare inne i importen
# (IMPORT_JITTER_MAX_MINUTES) så vi inte träffar eSett på exakt samma sekund
# varje dygn. Skriptet tar samma flaggor som importern (--dry-run, --manual).

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

LOG_DIR="$REPO_DIR/logs"
mkdir -p "$LOG_DIR"
exec >>"$LOG_DIR/import-$(date +%Y-%m).log" 2>&1

# En körning i taget. Startar cron en ny medan gårdagens fortfarande retryar
# skulle två processer commita i samma arbetsträd.
exec 9>"$LOG_DIR/.import.lock"
if ! flock -n 9; then
  echo "=== $(date -Is) — en import pågår redan, hoppar över ==="
  exit 0
fi

echo "=== $(date -Is) — start ==="

export FIA_UID="$(id -u)"
export FIA_GID="$(id -g)"

status=0
docker compose run --rm importer "$@" || status=$?

echo "=== $(date -Is) — klar (exit $status) ==="

# Exit-koden är enda felsignalen: fånga den i cron (MAILTO) eller i er
# övervakning om ni vill ha larm när eSett varit nere hela natten.
exit "$status"
