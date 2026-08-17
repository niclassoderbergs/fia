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
  mapBanks,
  mapBrpParties,
  mapBrpRelations,
  mapBsps,
  mapDsos,
  mapGridAreas,
  mapRetailers,
  type BankRecord,
  type BiddingZone,
  type BrpPartyRecord,
  type BrpRelation,
  type BspRecord,
  type DsoRecord,
  type GridAreaRecord,
  type RetailerRecord,
  type ZoneBatch,
} from '@/esett/mappers';
import { diffRecords } from '@/esett/diff';
import { diffBrpRelations } from '@/esett/brp-diff';
import { cmp } from '@/esett/sort';
import { plural } from '@/lib/format';
import { allPassed, failureSummary, guardAllZones, guardNonEmpty, guardShrink } from './guards';
import { buildCommitMessage, commitData, push } from './git';
import { DataStore, DATA_FILES, runIdFromDate } from './store';
import type { Dataset, GuardResult, RunReport, RunScope, RunStep } from '@/lib/types';

/** Läsbara namn för seedade dataset i commit-meddelandet. */
const SEED_LABELS: Record<RunScope, string> = {
  dsos: 'nätägare',
  gridAreas: 'nätområden',
  brp: 'balansansvar',
  retailers: 'elhandlare',
  brpParties: 'balansansvariga',
  bsps: 'BSP',
  banks: 'banker',
};

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
  const runId = runIdFromDate(startedAt);
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
  let retailers: ReturnType<typeof mapRetailers> = { records: [], skipped: [] };
  let brpParties: ReturnType<typeof mapBrpParties> = { records: [], skipped: [] };
  let bsps: ReturnType<typeof mapBsps> = { records: [], skipped: [] };
  let banks: ReturnType<typeof mapBanks> = { records: [], skipped: [] };
  let foundZones: string[] = [];

  const timed = async <T>(name: string, endpoint: string, fn: () => Promise<T>, count: (r: T) => number): Promise<T> => {
    const t0 = Date.now();
    const result = await fn();
    steps.push({ name, endpoint, fetched: count(result), durationMs: Date.now() - t0 });
    return result;
  };

  try {
    // --- Hämtning -----------------------------------------------------------
    // Ordningen speglar eSetts exportgrupper: EXP01-registren, EXP03, EXP06,
    // sist EXP04 som behöver EIC-koderna.
    const rawDsos = await timed(
      'Nätägare (DSO)',
      '/EXP01/DistributionSystemOperators?country=SE',
      () => client.fetchSwedishDsos(),
      (r) => r.length,
    );
    const rawRetailers = await timed(
      'Elhandlare (Retailers)',
      '/EXP01/Retailers?country=SE',
      () => client.fetchSwedishRetailers(),
      (r) => r.length,
    );
    const rawBrpParties = await timed(
      'Balansansvariga (BRP)',
      '/EXP01/BalanceResponsibleParties?country=SE',
      () => client.fetchSwedishBrpParties(),
      (r) => r.length,
    );
    const rawBsps = await timed(
      'Balanstjänsteleverantörer (BSP)',
      '/EXP01/BalanceServiceProviders?country=SE',
      () => client.fetchSwedishBsps(),
      (r) => r.length,
    );
    const rawMgas = await timed(
      'Nätområden (MGA)',
      '/EXP03/MeteringGridAreas?mgaType=DISTRIBUTION',
      () => client.fetchSwedishMgas(),
      (r) => r.totalNordic,
    );
    const rawBanks = await timed(
      'Settlementbanker',
      '/EXP06/Banks',
      () => client.fetchSettlementBanks(),
      (r) => r.length,
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
    retailers = mapRetailers(rawRetailers);
    brpParties = mapBrpParties(rawBrpParties);
    bsps = mapBsps(rawBsps);
    banks = mapBanks(rawBanks);

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
  const prevRetailers = store.previousRows<RetailerRecord>(DATA_FILES.retailers);
  const prevBrpParties = store.previousRows<BrpPartyRecord>(DATA_FILES.brpParties);
  const prevBsps = store.previousRows<BspRecord>(DATA_FILES.bsps);
  const prevBanks = store.previousRows<BankRecord>(DATA_FILES.banks);

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

  const retailerDiff =
    status === 'success'
      ? diffRecords(prevRetailers, retailers.records, {
          entity: 'retailer',
          key: (r) => r.reCode,
          label: (r) => r.reName,
          fields: [
            { key: 'reName', label: 'namn' },
            { key: 'codingScheme', label: 'kodschema' },
          ],
        })
      : emptyDiff;

  const brpPartyDiff =
    status === 'success'
      ? diffRecords(prevBrpParties, brpParties.records, {
          entity: 'brp_party',
          key: (r) => r.brpCode,
          label: (r) => r.brpName,
          fields: [
            { key: 'brpName', label: 'namn' },
            { key: 'businessId', label: 'organisationsnummer' },
            { key: 'validityStart', label: 'giltig från' },
            { key: 'validityEnd', label: 'giltig till' },
            { key: 'codingScheme', label: 'kodschema' },
          ],
        })
      : emptyDiff;

  const bspDiff =
    status === 'success'
      ? diffRecords(prevBsps, bsps.records, {
          entity: 'bsp',
          key: (r) => r.bspCode,
          label: (r) => r.bspName,
          fields: [
            { key: 'bspName', label: 'namn' },
            { key: 'businessId', label: 'organisationsnummer' },
            { key: 'codingScheme', label: 'kodschema' },
          ],
        })
      : emptyDiff;

  const bankDiff =
    status === 'success'
      ? diffRecords(prevBanks, banks.records, {
          entity: 'bank',
          key: (r) => r.bic,
          label: (r) => r.name,
          fields: [
            { key: 'name', label: 'namn' },
            { key: 'country', label: 'land' },
          ],
        })
      : emptyDiff;

  // --- Spärrar --------------------------------------------------------------
  if (status === 'success') {
    guards.push(
      guardNonEmpty('Nätägare', dsos.records.length),
      guardNonEmpty('Nätområden', gridAreas.records.length),
      guardNonEmpty('Balansansvar', brp.records.length),
      guardNonEmpty('Elhandlare', retailers.records.length),
      guardNonEmpty('Balansansvariga', brpParties.records.length),
      guardNonEmpty('Balanstjänsteleverantörer', bsps.records.length),
      guardNonEmpty('Settlementbanker', banks.records.length),
      guardAllZones(foundZones),
      guardShrink('Nätägare', prevDsos.length, dsoDiff.counts.removed, env.maxShrinkPct),
      guardShrink('Nätområden', prevGridAreas.length, gridAreaDiff.counts.removed, env.maxShrinkPct),
      guardShrink('Balansansvar', prevBrp.length, brpDiff.counts.ended, env.maxShrinkPct),
      guardShrink('Elhandlare', prevRetailers.length, retailerDiff.counts.removed, env.maxShrinkPct),
      guardShrink('Balansansvariga', prevBrpParties.length, brpPartyDiff.counts.removed, env.maxShrinkPct),
      guardShrink('Balanstjänsteleverantörer', prevBsps.length, bspDiff.counts.removed, env.maxShrinkPct),
      guardShrink('Settlementbanker', prevBanks.length, bankDiff.counts.removed, env.maxShrinkPct),
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
      retailerDiff.changes.length > 0 || prevRetailers.length === 0
        ? store.write(DATA_FILES.retailers, dataset('/EXP01/Retailers', retailers.records))
        : false,
      brpPartyDiff.changes.length > 0 || prevBrpParties.length === 0
        ? store.write(DATA_FILES.brpParties, dataset('/EXP01/BalanceResponsibleParties', brpParties.records))
        : false,
      bspDiff.changes.length > 0 || prevBsps.length === 0
        ? store.write(DATA_FILES.bsps, dataset('/EXP01/BalanceServiceProviders', bsps.records))
        : false,
      bankDiff.changes.length > 0 || prevBanks.length === 0
        ? store.write(DATA_FILES.banks, dataset('/EXP06/Banks', banks.records))
        : false,
    ];
    log(`datafiler skrivna: ${wrote.filter(Boolean).length} av ${wrote.length}`);
  }

  const finishedAt = new Date();

  // Första hämtningen av ett dataset är ett utgångsläge, inte en förändring —
  // att lista varje post som "tillagd" vore brus som dränker verkliga
  // förändringar. Datafilerna skrivs, men seedade dataset döljs ur körningens
  // ändringslista och räknas inte i changeCount.
  const seeded: RunScope[] = [];
  if (status === 'success') {
    if (prevDsos.length === 0 && dsos.records.length > 0) seeded.push('dsos');
    if (prevGridAreas.length === 0 && gridAreas.records.length > 0) seeded.push('gridAreas');
    if (prevBrp.length === 0 && brp.records.length > 0) seeded.push('brp');
    if (prevRetailers.length === 0 && retailers.records.length > 0) seeded.push('retailers');
    if (prevBrpParties.length === 0 && brpParties.records.length > 0) seeded.push('brpParties');
    if (prevBsps.length === 0 && bsps.records.length > 0) seeded.push('bsps');
    if (prevBanks.length === 0 && banks.records.length > 0) seeded.push('banks');
  }
  const unlessSeeded = <T>(key: RunScope, changes: T[]): T[] =>
    seeded.includes(key) ? [] : changes;
  const zeroDiff = { added: 0, changed: 0, removed: 0, unchanged: 0 };

  const reportDsoChanges = unlessSeeded('dsos', dsoDiff.changes);
  const reportGridChanges = unlessSeeded('gridAreas', gridAreaDiff.changes);
  const reportBrpChanges = unlessSeeded('brp', brpDiff.changes);
  const reportRetailerChanges = unlessSeeded('retailers', retailerDiff.changes);
  const reportBrpPartyChanges = unlessSeeded('brpParties', brpPartyDiff.changes);
  const reportBspChanges = unlessSeeded('bsps', bspDiff.changes);
  const reportBankChanges = unlessSeeded('banks', bankDiff.changes);

  const allChanges = [
    ...reportDsoChanges,
    ...reportGridChanges,
    ...reportRetailerChanges,
    ...reportBrpPartyChanges,
    ...reportBspChanges,
    ...reportBankChanges,
  ];
  const changeCount = allChanges.length + reportBrpChanges.length;
  const truncated = allChanges.length > MAX_CHANGES_IN_REPORT || reportBrpChanges.length > MAX_CHANGES_IN_REPORT;

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
      retailers: retailers.records.length,
      brpParties: brpParties.records.length,
      bsps: bsps.records.length,
      banks: banks.records.length,
    },
    changeCount,
    error,
    requestCount: client.requestCount,
    steps,
    guards,
    ...(seeded.length > 0 ? { seeded } : {}),
    counts: {
      dsos: seeded.includes('dsos') ? zeroDiff : dsoDiff.counts,
      gridAreas: seeded.includes('gridAreas') ? zeroDiff : gridAreaDiff.counts,
      brp: seeded.includes('brp')
        ? { newRetailers: 0, newRelations: 0, brpSwitches: 0, ended: 0, unchanged: 0 }
        : brpDiff.counts,
      retailers: seeded.includes('retailers') ? zeroDiff : retailerDiff.counts,
      brpParties: seeded.includes('brpParties') ? zeroDiff : brpPartyDiff.counts,
      bsps: seeded.includes('bsps') ? zeroDiff : bspDiff.counts,
      banks: seeded.includes('banks') ? zeroDiff : bankDiff.counts,
    },
    skipped: {
      dsos: dsos.skipped,
      gridAreas: gridAreas.skipped,
      brp: brp.skipped,
      retailers: retailers.skipped,
      brpParties: brpParties.skipped,
      bsps: bsps.skipped,
      banks: banks.skipped,
    },
    changes: {
      records: allChanges.slice(0, MAX_CHANGES_IN_REPORT),
      brp: reportBrpChanges.slice(0, MAX_CHANGES_IN_REPORT),
    },
    changesTruncated: truncated,
  };
  store.saveRun(report);
  log(`rapport ${runId}: status=${status}, ${changeCount} förändringar, ${client.requestCount} anrop`);

  // --- Commit + push --------------------------------------------------------
  if (!dryRun && env.gitCommit) {
    const c = report.counts.brp;
    const d = report.counts.dsos;
    const g = report.counts.gridAreas;
    const lines: string[] = [];
    if (seeded.length > 0) {
      lines.push(`första hämtningen av ${seeded.map((s) => SEED_LABELS[s]).join(', ')}`);
    }
    if (d.added) lines.push(plural(d.added, 'ny nätägare', 'nya nätägare'));
    if (d.changed) lines.push(plural(d.changed, 'ändrad nätägare', 'ändrade nätägare'));
    if (d.removed) lines.push(plural(d.removed, 'borttagen nätägare', 'borttagna nätägare'));
    if (g.added) lines.push(plural(g.added, 'nytt nätområde', 'nya nätområden'));
    if (g.changed) lines.push(plural(g.changed, 'ändrat nätområde', 'ändrade nätområden'));
    if (g.removed) lines.push(plural(g.removed, 'borttaget nätområde', 'borttagna nätområden'));
    if (c.newRetailers) lines.push(plural(c.newRetailers, 'ny elhandlare', 'nya elhandlare'));
    if (c.newRelations) {
      lines.push(plural(c.newRelations, 'ny BRP-relation', 'nya BRP-relationer'));
    }
    if (c.brpSwitches) lines.push(plural(c.brpSwitches, 'BRP-byte', 'BRP-byten'));
    if (c.ended) {
      lines.push(plural(c.ended, 'upphörd BRP-relation', 'upphörda BRP-relationer'));
    }
    // Registerposter (EXP01/EXP06): en rad per registret och utfall, bara nollskilda.
    for (const [diff, one, many] of [
      [{ counts: report.counts.retailers ?? zeroDiff }, 'elhandlarpost', 'elhandlarposter'],
      [{ counts: report.counts.brpParties ?? zeroDiff }, 'BRP-post', 'BRP-poster'],
      [{ counts: report.counts.bsps ?? zeroDiff }, 'BSP-post', 'BSP-poster'],
      [{ counts: report.counts.banks ?? zeroDiff }, 'bankpost', 'bankposter'],
    ] as const) {
      if (diff.counts.added) lines.push(plural(diff.counts.added, `ny ${one}`, `nya ${many}`));
      if (diff.counts.changed) {
        lines.push(plural(diff.counts.changed, `ändrad ${one}`, `ändrade ${many}`));
      }
      if (diff.counts.removed) {
        lines.push(plural(diff.counts.removed, `borttagen ${one}`, `borttagna ${many}`));
      }
    }

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
