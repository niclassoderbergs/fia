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

/** Nätområden per prisområde — används i översiktens nyckeltal. */
export function countByZone(rows: Array<{ biddingZone: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.biddingZone] = (counts[row.biddingZone] ?? 0) + 1;
  return counts;
}
