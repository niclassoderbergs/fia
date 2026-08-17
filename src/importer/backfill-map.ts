// Ren översättning av energi-systemets körningshistorik till vårt rapportformat.
// DB-fri och I/O-fri → enhetstestbar. CLI:t ligger i backfill.ts.
//
// Historiken kördes som TVÅ separata jobb i energi: nätområden veckovis och
// balansansvar dagligen. En importerad körning täcker därför bara den ena
// halvan, vilket märks ut med `scope`, och märks som `origin: 'energi'` så
// ingen tror att den här appen producerat den.
//
// Vad som medvetet INTE hittas på:
//
// - `triggered_by` saknas helt på nätområdessidan (9 av 9 rader NULL). Att
//   anta "cron" hade varit fel — flera av körningarna skedde mitt på dagen.
//   De får `unknown`.
// - Stegtider finns inte per endpoint, bara körningens totaltid. Nätområdes-
//   körningarnas steg får `durationMs: null` i stället för en påhittad siffra.
// - Spärrar fanns inte i det gamla systemet. Listan blir tom, inte påhittad.
// - Misslyckade körningar lämnade aldrig något spår i de här tabellerna
//   (raden skrevs inuti transaktionen), så historiken innehåller bara lyckade
//   körningar. Det är en egenskap hos källan, inte hos inläsningen — och
//   skälet till att den här appen skriver rapporten först av allt.

import type { BrpChange } from '@/esett/brp-diff';
import type { ChangeAction, RecordChange } from '@/esett/diff';
import type { RunReport, RunStep, TriggeredBy } from '@/lib/types';
import { runIdFromDate } from './store';

/** Energis BRP-tabell kapade ändringsloggen vid 500 poster. */
export const ENERGI_BRP_CHANGE_CAP = 500;

export interface EnergiBrpRun {
  created_at: string;
  duration_ms: number;
  rows_fetched: number;
  relations_seen: number;
  new_retailers: number;
  new_relations: number;
  brp_switches: number;
  ended: number;
  triggered_by: string | null;
  changes: BrpChange[];
}

export interface EnergiGridChange {
  entity: string;
  code: string;
  name: string;
  action: string;
  fields: Array<{ field: string; from: string | null; to: string | null }>;
}

export interface EnergiGridRun {
  created_at: string;
  duration_ms: number;
  dso_fetched: number;
  dso_inserted: number;
  dso_updated: number;
  mga_fetched: number;
  mga_inserted: number;
  mga_updated: number;
  mga_linked: number;
  mga_skipped: number;
  triggered_by: string | null;
  changes: EnergiGridChange[];
}

export interface EnergiDump {
  dumpedAt: string;
  brp: EnergiBrpRun[];
  grid: EnergiGridRun[];
}

/** energis triggered_by → vår. 'admin' var deras ord för manuell körning. */
export function mapTrigger(raw: string | null): TriggeredBy {
  if (raw === 'cron') return 'cron';
  if (raw === 'admin' || raw === 'manual') return 'manual';
  return 'unknown';
}

/** energis entity/action → våra. `linked` behålls som eget utfall. */
export function mapRecordChange(change: EnergiGridChange): RecordChange {
  const action: ChangeAction =
    change.action === 'inserted'
      ? 'added'
      : change.action === 'linked'
        ? 'linked'
        : change.action === 'removed'
          ? 'removed'
          : 'changed';

  return {
    entity: change.entity === 'actor' ? 'dso' : 'grid_area',
    code: change.code,
    name: change.name,
    action,
    fields: change.fields ?? [],
  };
}

const emptyDiffCounts = () => ({ added: 0, changed: 0, removed: 0, unchanged: 0 });
const emptyBrpCounts = () => ({
  newRetailers: 0,
  newRelations: 0,
  brpSwitches: 0,
  ended: 0,
  unchanged: 0,
});

export function brpRunToReport(row: EnergiBrpRun): RunReport {
  const startedAt = new Date(row.created_at);
  const changes = row.changes ?? [];
  const changeCount = row.new_retailers + row.new_relations + row.brp_switches + row.ended;

  const steps: RunStep[] = [
    {
      name: 'Balansansvar (alla prisområden)',
      endpoint: '/EXP04/RetailerBalanceResponsibility',
      fetched: row.rows_fetched,
      durationMs: row.duration_ms,
    },
  ];

  return {
    id: runIdFromDate(startedAt),
    startedAt: startedAt.toISOString(),
    finishedAt: new Date(startedAt.getTime() + row.duration_ms).toISOString(),
    durationMs: row.duration_ms,
    status: 'success',
    triggeredBy: mapTrigger(row.triggered_by),
    dryRun: false,
    origin: 'energi',
    scope: ['brp'],
    totals: { dsos: 0, gridAreas: 0, brpRelations: row.relations_seen },
    changeCount,
    error: null,
    requestCount: 0,
    steps,
    guards: [],
    counts: {
      dsos: emptyDiffCounts(),
      gridAreas: emptyDiffCounts(),
      brp: {
        newRetailers: row.new_retailers,
        newRelations: row.new_relations,
        brpSwitches: row.brp_switches,
        ended: row.ended,
        unchanged: Math.max(
          0,
          row.relations_seen - (row.new_retailers + row.new_relations + row.brp_switches),
        ),
      },
    },
    skipped: { dsos: [], gridAreas: [], brp: [] },
    changes: { records: [], brp: changes },
    changesTruncated: changes.length >= ENERGI_BRP_CHANGE_CAP,
  };
}

export function gridRunToReport(row: EnergiGridRun): RunReport {
  const startedAt = new Date(row.created_at);
  const changes = (row.changes ?? []).map(mapRecordChange);

  // Bara totaltiden loggades — stegen får null hellre än en påhittad siffra.
  const steps: RunStep[] = [
    {
      name: 'Nätägare (DSO)',
      endpoint: '/EXP01/DistributionSystemOperators?country=SE',
      fetched: row.dso_fetched,
      durationMs: null,
    },
    {
      name: 'Nätområden (MGA)',
      endpoint: '/EXP03/MeteringGridAreas?mgaType=DISTRIBUTION',
      fetched: row.mga_fetched,
      durationMs: null,
    },
  ];

  // energi räknade "länkad" separat; för oss är det en ändring av nätområdet.
  const gridChanged = row.mga_updated + row.mga_linked;

  return {
    id: runIdFromDate(startedAt),
    startedAt: startedAt.toISOString(),
    finishedAt: new Date(startedAt.getTime() + row.duration_ms).toISOString(),
    durationMs: row.duration_ms,
    status: 'success',
    triggeredBy: mapTrigger(row.triggered_by),
    dryRun: false,
    origin: 'energi',
    scope: ['dsos', 'gridAreas'],
    totals: { dsos: row.dso_fetched, gridAreas: row.mga_fetched, brpRelations: 0 },
    changeCount: changes.length,
    error: null,
    requestCount: 0,
    steps,
    guards: [],
    counts: {
      dsos: {
        added: row.dso_inserted,
        changed: row.dso_updated,
        removed: 0,
        unchanged: Math.max(0, row.dso_fetched - row.dso_inserted - row.dso_updated),
      },
      gridAreas: {
        added: row.mga_inserted,
        changed: gridChanged,
        removed: 0,
        unchanged: Math.max(0, row.mga_fetched - row.mga_inserted - gridChanged),
      },
      brp: emptyBrpCounts(),
    },
    skipped: { dsos: [], gridAreas: [], brp: [] },
    changes: { records: changes, brp: [] },
    changesTruncated: false,
  };
}
