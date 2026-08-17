// Webbvyns läsning av data/. Enda källan — ingen databas, ingen API-klient.
//
// Filerna ändras bara när importern pushar, och varje push bygger om appen på
// Vercel. Sidorna kan därför renderas statiskt vid build: det som ligger i
// filen när bygget kör är per definition det aktuella.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  BrpRelation,
  Dataset,
  DsoRecord,
  FeedEntry,
  GridAreaRecord,
  RunIndex,
  RunReport,
} from './types';

const DATA_DIR = join(process.cwd(), 'data');

function readJson<T>(...segments: string[]): T | null {
  try {
    return JSON.parse(readFileSync(join(DATA_DIR, ...segments), 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Tom platshållare innan första importen körts. */
function emptyDataset<T>(): Dataset<T> {
  return { fetchedAt: '', runId: '', source: '', count: 0, rows: [] };
}

export function getDsos(): Dataset<DsoRecord> {
  return readJson<Dataset<DsoRecord>>('dsos.json') ?? emptyDataset();
}

export function getGridAreas(): Dataset<GridAreaRecord> {
  return readJson<Dataset<GridAreaRecord>>('grid-areas.json') ?? emptyDataset();
}

export function getBrpRelations(): Dataset<BrpRelation> {
  return readJson<Dataset<BrpRelation>>('brp-relations.json') ?? emptyDataset();
}

export function getRunIndex(): RunIndex {
  return readJson<RunIndex>('runs', 'index.json') ?? { updatedAt: '', runs: [] };
}

/**
 * Senaste körningen som faktiskt skrev igenom.
 *
 * Behövs för att kunna säga "senast kontrollerad" separat från datasetets
 * `fetchedAt`. Datafiler skrivs bara när något ändrats, så `fetchedAt` är
 * tidpunkten då innehållet senast *ändrades* — inte när det senast
 * bekräftades mot eSett. Utan den skillnaden ser färsk data ut som gammal.
 */
export function getLastSuccessfulRun(): RunIndex['runs'][number] | null {
  return getRunIndex().runs.find((r) => r.status === 'success' && !r.dryRun) ?? null;
}

export function getRun(id: string): RunReport | null {
  // id kommer från URL:en — tillåt bara det format importern skapar.
  if (!/^\d{8}-\d{6}$/.test(id)) return null;
  return readJson<RunReport>('runs', `${id}.json`);
}

/**
 * Förändringsflödet: varje körning med sina faktiska ändringar, nyaste först.
 *
 * Läser en rapportfil per körning vid build. Det låter dyrt men är det inte —
 * ett dygn utan förändringar ger en rapport på ett par kB, och sidan
 * genereras en gång per push. Vi tar bara med det flödet visar; steg, spärrar
 * och överhoppade rader stannar på körningens egen sida.
 */
export function getChangeFeed(): FeedEntry[] {
  const empty = {
    dsos: { added: 0, changed: 0, removed: 0, unchanged: 0 },
    gridAreas: { added: 0, changed: 0, removed: 0, unchanged: 0 },
    brp: { newRetailers: 0, newRelations: 0, brpSwitches: 0, ended: 0, unchanged: 0 },
  };

  return getRunIndex().runs.map((summary) => {
    const report = getRun(summary.id);
    return {
      id: summary.id,
      startedAt: summary.startedAt,
      status: summary.status,
      dryRun: summary.dryRun,
      durationMs: summary.durationMs,
      changeCount: summary.changeCount,
      totals: summary.totals,
      // Rapportfilen kan ha rensats bort medan indexet finns kvar — då visar
      // vi ändå raden, med sammanfattningen vi har.
      counts: report?.counts ?? empty,
      changes: report?.changes ?? { records: [], brp: [] },
      changesTruncated: report?.changesTruncated ?? false,
      error: summary.error,
    };
  });
}

/** Nätområden per prisområde — används i översiktens nyckeltal. */
export function countByZone(rows: Array<{ biddingZone: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.biddingZone] = (counts[row.biddingZone] ?? 0) + 1;
  return counts;
}
