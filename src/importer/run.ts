// Importens huvudflöde. Körs dagligen via cron på servern:
//
//   hämta från eSett → mappa → diffa mot förra körningen → spärrar →
//   skriv data/ → commit → push (Vercel deployar).
//
// Designval som skiljer sig från ursprungssystemet, med skäl:
//
// - Rapporten skrivs ÄVEN när körningen misslyckas. I energi-systemet skrevs
//   körningsraden inuti transaktionen, så en misslyckad körning lämnade inget
//   spår (handover §7). Här är rapporten det första som alltid landar.
// - Spärrar före skrivning (guards.ts) — tomma/partiella eSett-svar får inte
//   bli en massradering.
// - Ingen atomisk transaktion finns med filer. I stället: datafilerna skrivs
//   först när ALLA steg lyckats och alla spärrar passerat. Fram till dess är
//   enda skrivningen rapporten. Halvfärdigt tillstånd kan alltså inte
//   committas.
//
// Flaggor: --dry-run (hämta + diffa men skriv bara rapport, ingen commit),
//          --manual (märk körningen som manuellt startad, hoppa över jitter).

import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { EsettOpenDataClient } from '@/esett/client';
import {
  mapBrpRelations,
  mapDsos,
  mapGridAreas,
  type BiddingZone,
  type BrpRelation,
  type DsoRecord,
  type GridAreaRecord,
  type ZoneBatch,
} from '@/esett/mappers';
import { diffRecords } from '@/esett/diff';
import { diffBrpRelations } from '@/esett/brp-diff';
import { cmp } from '@/esett/sort';
import { allPassed, failureSummary, guardAllZones, guardNonEmpty, guardShrink } from './guards';
import { buildCommitMessage, commitData, push } from './git';
import { DataStore, DATA_FILES } from './store';
import type { Dataset, GuardResult, RunReport, RunStep } from '@/lib/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Ändringslistor i rapporten kapas här — kapningen flaggas alltid i rapporten. */
const MAX_CHANGES_IN_REPORT = 500;

interface Env {
  baseUrl: string;
  minDelayMs: number;
  backoffMs: number[];
  jitterMaxMinutes: number;
  maxShrinkPct: number;
  gitCommit: boolean;
  gitPush: boolean;
  gitRemote: string;
  gitBranch: string;
}

function readEnv(): Env {
  const num = (name: string, fallback: number): number => {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0) throw new Error(`${name}="${raw}" är inte ett giltigt tal`);
    return v;
  };
  const backoffRaw = process.env['ESETT_RETRY_BACKOFF_MS'] ?? '60000,240000,960000';
  const backoffMs = backoffRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const v = Number(s);
      if (!Number.isFinite(v) || v < 0) {
        throw new Error(`ESETT_RETRY_BACKOFF_MS innehåller ogiltigt värde "${s}"`);
      }
      return v;
    });

  return {
    baseUrl: process.env['ESETT_BASE_URL'] ?? 'https://api.opendata.esett.com',
    minDelayMs: num('ESETT_MIN_DELAY_MS', 45_000),
    backoffMs,
    jitterMaxMinutes: num('IMPORT_JITTER_MAX_MINUTES', 45),
    maxShrinkPct: num('IMPORT_MAX_SHRINK_PCT', 0.1),
    gitCommit: (process.env['IMPORT_GIT_COMMIT'] ?? 'true') === 'true',
    gitPush: (process.env['IMPORT_GIT_PUSH'] ?? 'true') === 'true',
    gitRemote: process.env['IMPORT_GIT_REMOTE'] ?? 'origin',
    gitBranch: process.env['IMPORT_GIT_BRANCH'] ?? 'main',
  };
}

function runIdFrom(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15);
}

/** Datum i Europe/Stockholm för commit-rubriken. */
function stockholmDate(date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    dateStyle: 'short',
  }).format(date);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const manual = process.argv.includes('--manual');
  const env = readEnv();
  const store = new DataStore(join(ROOT, 'data'));
  const log = (msg: string) => console.log(`[fia-import] ${msg}`);

  // Slumpad startfördröjning så cron-körningen inte träffar eSett på samma
  // sekund varje dygn. Manuella körningar väntar inte.
  if (!manual && !dryRun && env.jitterMaxMinutes > 0) {
    const waitMs = randomInt(0, env.jitterMaxMinutes * 60_000 + 1);
    log(`jitter: väntar ${Math.round(waitMs / 1000)} s innan start`);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  const startedAt = new Date();
  const runId = runIdFrom(startedAt);
  const client = new EsettOpenDataClient({
    base: env.baseUrl,
    minDelayMs: env.minDelayMs,
    backoffMs: env.backoffMs,
    log,
  });

  const steps: RunStep[] = [];
  const guards: GuardResult[] = [];
  let status: RunReport['status'] = 'failed';
  let error: string | null = null;

  let dsos: ReturnType<typeof mapDsos> = { records: [], skipped: [] };
  let gridAreas: ReturnType<typeof mapGridAreas> = { records: [], skipped: [] };
  let brp: ReturnType<typeof mapBrpRelations> = { records: [], skipped: [] };
  let foundZones: string[] = [];

  const timed = async <T>(name: string, endpoint: string, fn: () => Promise<T>, count: (r: T) => number): Promise<T> => {
    const t0 = Date.now();
    const result = await fn();
    steps.push({ name, endpoint, fetched: count(result), durationMs: Date.now() - t0 });
    return result;
  };

  try {
    // --- Hämtning -----------------------------------------------------------
    const rawDsos = await timed(
      'Nätägare (DSO)',
      '/EXP01/DistributionSystemOperators?country=SE',
      () => client.fetchSwedishDsos(),
      (r) => r.length,
    );
    const rawMgas = await timed(
      'Nätområden (MGA)',
      '/EXP03/MeteringGridAreas?mgaType=DISTRIBUTION',
      () => client.fetchSwedishMgas(),
      (r) => r.totalNordic,
    );
    const mbaOptions = await timed(
      'Prisområden (MBA)',
      '/EXP04/MBAOptions',
      () => client.fetchSwedishMbaOptions(),
      (r) => r.length,
    );

    const zoneBatches: ZoneBatch[] = [];
    for (const mba of [...mbaOptions].sort((a, b) => cmp(a.name, b.name))) {
      const rows = await timed(
        `Balansansvar ${mba.name}`,
        `/EXP04/RetailerBalanceResponsibility?mba=${mba.code}`,
        () => client.fetchRetailerBalanceResponsibilities(mba.code),
        (r) => r.length,
      );
      zoneBatches.push({ biddingZone: mba.name as BiddingZone, rows });
    }
    foundZones = zoneBatches.map((b) => b.biddingZone);

    // --- Mappning -----------------------------------------------------------
    dsos = mapDsos(rawDsos);
    gridAreas = mapGridAreas(rawMgas.rows, dsos.records);
    brp = mapBrpRelations(zoneBatches);

    status = 'success';
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    log(`FEL: ${error}`);
  }

  // --- Diff mot förra körningen (även vid fel — då mot tomma nya listor är
  // meningslöst, så diffen görs bara när hämtningen lyckades) ---------------
  const prevDsos = store.previousRows<DsoRecord>(DATA_FILES.dsos);
  const prevGridAreas = store.previousRows<GridAreaRecord>(DATA_FILES.gridAreas);
  const prevBrp = store.previousRows<BrpRelation>(DATA_FILES.brpRelations);

  const emptyDiff = { changes: [], counts: { added: 0, changed: 0, removed: 0, unchanged: 0 } };
  const emptyBrpDiff = {
    changes: [],
    counts: { newRetailers: 0, newRelations: 0, brpSwitches: 0, ended: 0, unchanged: 0 },
  };

  const dsoDiff =
    status === 'success'
      ? diffRecords(prevDsos, dsos.records, {
          entity: 'dso',
          key: (r) => r.dsoCode,
          label: (r) => r.name,
          fields: [
            { key: 'name', label: 'namn' },
            { key: 'codingScheme', label: 'kodschema' },
          ],
        })
      : emptyDiff;

  const gridAreaDiff =
    status === 'success'
      ? diffRecords(prevGridAreas, gridAreas.records, {
          entity: 'grid_area',
          key: (r) => r.mgaCode,
          label: (r) => r.name,
          fields: [
            { key: 'name', label: 'namn' },
            { key: 'biddingZone', label: 'prisområde' },
            { key: 'dsoName', label: 'nätägare' },
            { key: 'dsoCode', label: 'nätägarkod' },
          ],
        })
      : emptyDiff;

  const brpDiff = status === 'success' ? diffBrpRelations(prevBrp, brp.records) : emptyBrpDiff;

  // --- Spärrar --------------------------------------------------------------
  if (status === 'success') {
    guards.push(
      guardNonEmpty('Nätägare', dsos.records.length),
      guardNonEmpty('Nätområden', gridAreas.records.length),
      guardNonEmpty('Balansansvar', brp.records.length),
      guardAllZones(foundZones),
      guardShrink('Nätägare', prevDsos.length, dsoDiff.counts.removed, env.maxShrinkPct),
      guardShrink('Nätområden', prevGridAreas.length, gridAreaDiff.counts.removed, env.maxShrinkPct),
      guardShrink('Balansansvar', prevBrp.length, brpDiff.counts.ended, env.maxShrinkPct),
    );
    if (!allPassed(guards)) {
      status = 'blocked';
      error = failureSummary(guards);
      log(`SPÄRRAD: ${error}`);
    }
  }

  // --- Skrivning ------------------------------------------------------------
  const writeData = status === 'success' && !dryRun;
  const fetchedAt = startedAt.toISOString();

  if (writeData) {
    const dataset = <T>(source: string, rows: T[]): Dataset<T> => ({
      fetchedAt,
      runId,
      source,
      count: rows.length,
      rows,
    });
    // Datafiler skrivs bara vid faktisk förändring — annars vore fetchedAt/runId
    // ensamma om att ändras och varje dygn gav en meningslös diff.
    const wrote = [
      dsoDiff.changes.length > 0 || prevDsos.length === 0
        ? store.write(DATA_FILES.dsos, dataset('/EXP01/DistributionSystemOperators', dsos.records))
        : false,
      gridAreaDiff.changes.length > 0 || prevGridAreas.length === 0
        ? store.write(DATA_FILES.gridAreas, dataset('/EXP03/MeteringGridAreas', gridAreas.records))
        : false,
      brpDiff.changes.length > 0 || prevBrp.length === 0
        ? store.write(DATA_FILES.brpRelations, dataset('/EXP04/RetailerBalanceResponsibility', brp.records))
        : false,
    ];
    log(`datafiler skrivna: ${wrote.filter(Boolean).length} av 3`);
  }

  const finishedAt = new Date();
  const allChanges = [...dsoDiff.changes, ...gridAreaDiff.changes];
  const changeCount = allChanges.length + brpDiff.changes.length;
  const truncated = allChanges.length > MAX_CHANGES_IN_REPORT || brpDiff.changes.length > MAX_CHANGES_IN_REPORT;

  const report: RunReport = {
    id: runId,
    startedAt: fetchedAt,
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    status,
    triggeredBy: manual ? 'manual' : 'cron',
    dryRun,
    totals: {
      dsos: dsos.records.length,
      gridAreas: gridAreas.records.length,
      brpRelations: brp.records.length,
    },
    changeCount,
    error,
    requestCount: client.requestCount,
    steps,
    guards,
    counts: { dsos: dsoDiff.counts, gridAreas: gridAreaDiff.counts, brp: brpDiff.counts },
    skipped: { dsos: dsos.skipped, gridAreas: gridAreas.skipped, brp: brp.skipped },
    changes: {
      records: allChanges.slice(0, MAX_CHANGES_IN_REPORT),
      brp: brpDiff.changes.slice(0, MAX_CHANGES_IN_REPORT),
    },
    changesTruncated: truncated,
  };
  store.saveRun(report);
  log(`rapport ${runId}: status=${status}, ${changeCount} förändringar, ${client.requestCount} anrop`);

  // --- Commit + push --------------------------------------------------------
  if (!dryRun && env.gitCommit) {
    const c = brpDiff.counts;
    const lines: string[] = [];
    if (dsoDiff.counts.added) lines.push(`${dsoDiff.counts.added} nya nätägare`);
    if (dsoDiff.counts.changed) lines.push(`${dsoDiff.counts.changed} ändrade nätägare`);
    if (dsoDiff.counts.removed) lines.push(`${dsoDiff.counts.removed} borttagna nätägare`);
    if (gridAreaDiff.counts.added) lines.push(`${gridAreaDiff.counts.added} nya nätområden`);
    if (gridAreaDiff.counts.changed) lines.push(`${gridAreaDiff.counts.changed} ändrade nätområden`);
    if (gridAreaDiff.counts.removed) lines.push(`${gridAreaDiff.counts.removed} borttagna nätområden`);
    if (c.newRetailers) lines.push(`${c.newRetailers} nya elhandlare`);
    if (c.newRelations) lines.push(`${c.newRelations} nya BRP-relationer`);
    if (c.brpSwitches) lines.push(`${c.brpSwitches} BRP-byten`);
    if (c.ended) lines.push(`${c.ended} upphörda BRP-relationer`);

    const message = buildCommitMessage({
      dateLabel: stockholmDate(startedAt),
      status,
      lines,
    });
    const sha = commitData(ROOT, message);
    if (sha) {
      log(`commit ${sha.slice(0, 8)}`);
    } else {
      log('inga ändringar under data/ — ingen commit');
    }

    // Pushen får misslyckas utan att körningen räknas som misslyckad: datat
    // ligger committat lokalt och följer med nästa dygns push. Vi loggar
    // tydligt och sätter exit-koden så cron kan larma, men kastar inte —
    // en nätverksstrul ska inte se ut som en kraschad import.
    if (env.gitPush) {
      try {
        push({ cwd: ROOT, remote: env.gitRemote, branch: env.gitBranch });
        log(`pushad till ${env.gitRemote}/${env.gitBranch} — Vercel deployar`);
      } catch (err) {
        const detail = err instanceof Error ? err.message.split('\n')[0] : String(err);
        log(`PUSH MISSLYCKADES: ${detail}`);
        log('datat är committat lokalt och pushas med nästa körning');
        process.exitCode = 1;
      }
    }
  }

  // Misslyckad körning → exit 1 så cron-wrappern kan larma på exit-koden.
  if (status === 'failed') process.exitCode = 1;
}

main().catch((err) => {
  console.error('[fia-import] oväntat fel:', err);
  process.exitCode = 1;
});
