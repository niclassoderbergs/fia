#!/usr/bin/env bash
#
# Engångsdump av eSett-körningshistoriken ur energi-systemets databas.
#
#   ./scripts/dump-energi-runs.sh [utfil]
#
# Skriver en JSON-fil som src/importer/backfill.ts läser. Skriptet rör bara
# SELECT — inget i energi ändras. Anledningen till att det går via en fil i
# stället för en direktkoppling är att den här appen inte ska ha någon
# databasdrivare alls: hela poängen är att den lever på filer.
#
# Kör bara om på en maskin där energi-stacken är igång.

set -euo pipefail

OUT="${1:-/tmp/energi-esett-runs.json}"
CONTAINER="${ENERGI_PG_CONTAINER:-energi-elhandel-postgres-1}"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Hittar inte postgres-containern '$CONTAINER'. Är energi-stacken igång?" >&2
  echo "Sätt ENERGI_PG_CONTAINER om den heter något annat." >&2
  exit 1
fi

read -r -d '' SQL <<'EOSQL' || true
SELECT json_build_object(
  'dumpedAt', now(),
  'brp', (
    SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.created_at), '[]'::json) FROM (
      SELECT created_at, duration_ms, rows_fetched, relations_seen,
             new_retailers, new_relations, brp_switches, ended,
             triggered_by, changes
      FROM esett_brp_import_run
    ) t
  ),
  'grid', (
    SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.created_at), '[]'::json) FROM (
      SELECT created_at, duration_ms,
             dso_fetched, dso_inserted, dso_updated,
             mga_fetched, mga_inserted, mga_updated, mga_linked, mga_skipped,
             triggered_by, changes
      FROM esett_import_run
    ) t
  )
);
EOSQL

# SQL:en går via stdin — slipper ett lager citering genom docker exec och sh -c.
printf '%s\n' "$SQL" \
  | docker exec -i "$CONTAINER" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' \
  > "$OUT"

echo "Dumpade till $OUT ($(wc -c < "$OUT") byte)"
