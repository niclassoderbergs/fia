// Formen på allt som ligger i data/. Delas av importern (som skriver) och
// webbvyn (som läser) — en enda definition, ingen risk att de glider isär.

import type { BrpChange, BrpDiffCounts } from '@/esett/brp-diff';
import type { DiffCounts, RecordChange } from '@/esett/diff';
import type {
  BankRecord,
  BrpPartyRecord,
  BrpRelation,
  BspRecord,
  DsoRecord,
  GridAreaRecord,
  RetailerRecord,
  SkippedRow,
} from '@/esett/mappers';

export type { BrpChange, BrpDiffCounts, DiffCounts, RecordChange };
export type {
  BankRecord,
  BrpPartyRecord,
  BrpRelation,
  BspRecord,
  DsoRecord,
  GridAreaRecord,
  RetailerRecord,
  SkippedRow,
};

/** En datafil: poster plus var och när de kom ifrån. */
export interface Dataset<T> {
  /** ISO-tidpunkt då körningen som skrev filen startade. */
  fetchedAt: string;
  /** Körnings-id som skrev filen — kopplar datat till sin rapport. */
  runId: string;
  /** eSett-endpoint datat kommer från. */
  source: string;
  count: number;
  rows: T[];
}

export type RunStatus = 'success' | 'blocked' | 'failed';

/**
 * `unknown` används bara för historik från energi-systemet, som aldrig satte
 * triggered_by på nätområdessidan (9 av 9 rader NULL). Att gissa "cron" hade
 * varit fel — flera av de körningarna skedde mitt på dagen.
 */
export type TriggeredBy = 'cron' | 'manual' | 'unknown';

/** Vilka delar en körning omfattade. Saknas = allt (den här appens körningar). */
export type RunScope =
  | 'dsos'
  | 'gridAreas'
  | 'brp'
  | 'retailers'
  | 'brpParties'
  | 'bsps'
  | 'banks';

/** Varifrån körningen kommer. Saknas = den här appen. */
export type RunOrigin = 'energi';

/** Ett hämtningssteg mot eSett. */
export interface RunStep {
  name: string;
  endpoint: string;
  /** Antal rader eSett svarade med (före filtrering). */
  fetched: number;
  /** null för historik där bara körningens totaltid loggades. */
  durationMs: number | null;
}

/** En spärr som utvärderats före skrivning. */
export interface GuardResult {
  name: string;
  ok: boolean;
  detail: string;
}

/** Det som listas i körningsöversikten — litet nog att ligga i ett index. */
export interface RunSummary {
  /** Sorterbart id: YYYYMMDD-HHMMSS i UTC. */
  id: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: RunStatus;
  /**
   * Ursprungssystemet satte aldrig detta fält på nätområdessidan (9 av 9
   * rader NULL) och kunde därför inte skilja cron från manuell körning.
   * Här är det obligatoriskt.
   */
  triggeredBy: TriggeredBy;
  dryRun: boolean;
  /** De fyra sista fälten tillkom när registren utökades — äldre rapporter saknar dem. */
  totals: {
    dsos: number;
    gridAreas: number;
    brpRelations: number;
    retailers?: number;
    brpParties?: number;
    bsps?: number;
    banks?: number;
  };
  changeCount: number;
  error: string | null;
  /** Sätts bara på inläst historik — våra egna körningar saknar fältet. */
  origin?: RunOrigin;
  /**
   * Vilka delar körningen omfattade. Saknas = alla. Historiken från energi
   * kördes som två separata jobb (nätområden veckovis, balansansvar dagligen),
   * så en importerad rad täcker bara den ena halvan.
   */
  scope?: RunScope[];
}

/** Full rapport per körning — allt kollegan behöver för att förstå ett dygn. */
export interface RunReport extends RunSummary {
  /** HTTP-anrop mot eSett, inklusive omförsök. */
  requestCount: number;
  steps: RunStep[];
  guards: GuardResult[];
  counts: {
    dsos: DiffCounts;
    gridAreas: DiffCounts;
    brp: BrpDiffCounts;
    retailers?: DiffCounts;
    brpParties?: DiffCounts;
    bsps?: DiffCounts;
    banks?: DiffCounts;
  };
  skipped: {
    dsos: SkippedRow[];
    gridAreas: SkippedRow[];
    brp: SkippedRow[];
    retailers?: SkippedRow[];
    brpParties?: SkippedRow[];
    bsps?: SkippedRow[];
    banks?: SkippedRow[];
  };
  changes: {
    records: RecordChange[];
    brp: BrpChange[];
  };
  /** Sätts när ändringslistorna kapats — aldrig en tyst avkortning. */
  changesTruncated: boolean;
}

export interface RunIndex {
  updatedAt: string;
  /** Nyaste först. */
  runs: RunSummary[];
}

/**
 * En rad i förändringsflödet — körningens sammanfattning plus dess faktiska
 * ändringar, men utan det tekniska (steg, spärrar, överhoppade rader) som bara
 * hör hemma på körningens egen sida.
 */
export interface FeedEntry {
  id: string;
  startedAt: string;
  status: RunStatus;
  dryRun: boolean;
  durationMs: number;
  changeCount: number;
  totals: RunSummary['totals'];
  counts: RunReport['counts'];
  changes: RunReport['changes'];
  changesTruncated: boolean;
  error: string | null;
  origin?: RunOrigin;
  scope?: RunScope[];
}
