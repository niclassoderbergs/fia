// Rena mappers: eSett-DTO → våra kanoniska poster. Inga sidoeffekter, inga
// filer, ingen I/O — allt här är enhetstestbart.
//
// Ärvd från energi-systemets esett-mappers.ts. Skillnaden är att målet inte
// längre är DB-kolumner utan JSON-poster som ska diffas i git. Därför gäller
// två extra krav som den gamla koden inte hade:
//
//   1. Deterministisk ordning i allt som lämnar en mapper. En osorterad lista
//      ger brus i varje commit-diff och gör historiken oläsbar.
//   2. Inga tysta fallbacks. Det ursprungliga systemet lät allt som inte var
//      exakt "production" bli consumption (handover §7); här hamnar okända
//      värden i skipped och syns i körningsrapporten.

import { cmp } from './sort';
import type {
  EsettDsoRow,
  EsettMgaRow,
  EsettRetailerBalanceRow,
} from './schemas';

export { cmp };

export type BiddingZone = 'SE1' | 'SE2' | 'SE3' | 'SE4';
export type Direction = 'consumption' | 'production';

export const BIDDING_ZONES: readonly BiddingZone[] = ['SE1', 'SE2', 'SE3', 'SE4'];
const VALID_ZONES: ReadonlySet<string> = new Set(BIDDING_ZONES);

/** En nätägare i vårt register. */
export interface DsoRecord {
  dsoCode: string;
  name: string;
  codingScheme: string;
  country: string;
}

/** Ett nätområde i vårt register. */
export interface GridAreaRecord {
  mgaCode: string;
  name: string;
  biddingZone: BiddingZone;
  /** Nätägarens namn så som eSett anger det på MGA-raden. */
  dsoName: string;
  /** Upplöst via namnmatch mot DSO-registret. null = namnet finns inte där. */
  dsoCode: string | null;
  /** true när flera nätägare bär exakt samma namn — länken är då ett val, inte ett faktum. */
  dsoNameAmbiguous: boolean;
}

/** En elhandlare→BRP-relation, deduppad per (prisområde, elhandlare, riktning). */
export interface BrpRelation {
  biddingZone: BiddingZone;
  retailerName: string;
  direction: Direction;
  /** Balansansvarig. Deterministiskt vald när flera förekommer (se conflicts). */
  brpName: string;
  /** Nätområden där relationen till brpName setts. Sorterade. */
  mgaNames: string[];
  /**
   * Övriga BRP för samma nyckel — uppstår när samma elhandlare har olika
   * balansansvarig i olika nätområden inom ett prisområde. Ursprungssystemet
   * lät "sista raden vinna" här, vilket gjorde utfallet beroende av eSetts
   * radordning (handover §7). Vi behåller i stället allt och visar konflikten.
   */
  conflicts: Array<{ brpName: string; mgaNames: string[] }>;
}

/** En rad vi medvetet inte tog med, med skäl. Hamnar i körningsrapporten. */
export interface SkippedRow {
  code: string;
  reason: string;
}

export interface MapResult<T> {
  records: T[];
  skipped: SkippedRow[];
}

/** Nyckel för namnmatch: trimmad, whitespace-normaliserad, gemener. */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Normaliserar eSetts energyDirectionType. Okända värden avvisas i stället för
 * att falla tillbaka på consumption — en tyst fallback döljer schemadrift.
 */
export function normalizeDirection(raw: string): Direction | null {
  const v = raw.trim().toLowerCase();
  if (v === 'production') return 'production';
  if (v === 'consumption') return 'consumption';
  return null;
}

/** eSett-DSO → vår nätägarpost. Dubbletter på dsoCode slås ihop, första vinner. */
export function mapDsos(rows: EsettDsoRow[]): MapResult<DsoRecord> {
  const byCode = new Map<string, DsoRecord>();
  const skipped: SkippedRow[] = [];

  for (const row of rows) {
    const code = row.dsoCode.trim();
    if (!code) {
      skipped.push({ code: '<saknas>', reason: 'tom dsoCode' });
      continue;
    }
    if (byCode.has(code)) {
      skipped.push({ code, reason: 'dubblett på dsoCode' });
      continue;
    }
    byCode.set(code, {
      dsoCode: code,
      name: row.dsoName.trim(),
      codingScheme: row.codingScheme?.trim() || 'NSE',
      country: row.country,
    });
  }

  return {
    records: [...byCode.values()].sort((a, b) => cmp(a.dsoCode, b.dsoCode)),
    skipped: sortSkipped(skipped),
  };
}

/**
 * eSett-MGA → vårt nätområdesregister, med nätägaren upplöst.
 *
 * eSett bär nätägarens NAMN på MGA-raden, inte dess kod, så länken är en
 * namnmatch. Namn är inte unika → urvalet måste vara deterministiskt (lägsta
 * dsoCode), annars pendlar länken mellan dubbletter vid varje körning och
 * varje commit-diff ser ut som en förändring.
 */
export function mapGridAreas(
  mgas: EsettMgaRow[],
  dsos: DsoRecord[],
): MapResult<GridAreaRecord> {
  const codesByName = new Map<string, string[]>();
  for (const dso of dsos) {
    const key = normalizeName(dso.name);
    if (!key) continue;
    const list = codesByName.get(key);
    if (list) list.push(dso.dsoCode);
    else codesByName.set(key, [dso.dsoCode]);
  }
  for (const list of codesByName.values()) list.sort((a, b) => cmp(a, b));

  const byCode = new Map<string, GridAreaRecord>();
  const skipped: SkippedRow[] = [];

  for (const row of mgas) {
    const code = row.mgaCode.trim();
    if (!code) {
      skipped.push({ code: '<saknas>', reason: 'tom mgaCode' });
      continue;
    }
    if (!VALID_ZONES.has(row.mba)) {
      skipped.push({ code, reason: `okänt prisområde "${row.mba}" (förväntat SE1–SE4)` });
      continue;
    }
    if (byCode.has(code)) {
      skipped.push({ code, reason: 'dubblett på mgaCode' });
      continue;
    }

    const dsoName = row.dsoName.trim();
    const matches = codesByName.get(normalizeName(dsoName)) ?? [];
    byCode.set(code, {
      mgaCode: code,
      name: row.mgaName.trim(),
      biddingZone: row.mba as BiddingZone,
      dsoName,
      dsoCode: matches[0] ?? null,
      dsoNameAmbiguous: matches.length > 1,
    });
  }

  return {
    records: [...byCode.values()].sort((a, b) => cmp(a.mgaCode, b.mgaCode)),
    skipped: sortSkipped(skipped),
  };
}

/** Rådata per prisområde, så som den hämtas ett anrop i taget. */
export interface ZoneBatch {
  biddingZone: BiddingZone;
  rows: EsettRetailerBalanceRow[];
}

/**
 * EXP04-rader → deduppade relationer per (prisområde, elhandlare, riktning).
 *
 * Flera nätområden i samma prisområde ger normalt samma BRP och kollapsar till
 * en rad. Skiljer de sig behålls alla: den lägsta BRP-namnet blir primärvärde
 * (deterministiskt) och resten hamnar i conflicts.
 */
export function mapBrpRelations(batches: ZoneBatch[]): MapResult<BrpRelation> {
  // nyckel → BRP-namn → nätområden
  const grouped = new Map<string, Map<string, Set<string>>>();
  const meta = new Map<string, { zone: BiddingZone; retailer: string; direction: Direction }>();
  const skipped: SkippedRow[] = [];

  for (const batch of batches) {
    for (const row of batch.rows) {
      const retailer = row.reName.trim();
      const brp = row.brpName.trim();
      const direction = normalizeDirection(row.energyDirectionType);

      if (!retailer || !brp) {
        skipped.push({
          code: `${batch.biddingZone}/${retailer || '<saknas>'}`,
          reason: 'tom reName eller brpName',
        });
        continue;
      }
      if (direction === null) {
        skipped.push({
          code: `${batch.biddingZone}/${retailer}`,
          reason: `okänd energyDirectionType "${row.energyDirectionType}"`,
        });
        continue;
      }

      const key = relationKey({ biddingZone: batch.biddingZone, retailerName: retailer, direction });
      meta.set(key, { zone: batch.biddingZone, retailer, direction });

      let byBrp = grouped.get(key);
      if (!byBrp) {
        byBrp = new Map();
        grouped.set(key, byBrp);
      }
      const mgas = byBrp.get(brp) ?? new Set<string>();
      const mgaName = row.mgaName.trim();
      if (mgaName) mgas.add(mgaName);
      byBrp.set(brp, mgas);
    }
  }

  const records: BrpRelation[] = [];
  for (const [key, byBrp] of grouped) {
    const m = meta.get(key);
    if (!m) continue;

    const brpNames = [...byBrp.keys()].sort((a, b) => cmp(a, b));
    const primary = brpNames[0];
    if (primary === undefined) continue;

    records.push({
      biddingZone: m.zone,
      retailerName: m.retailer,
      direction: m.direction,
      brpName: primary,
      mgaNames: sortedNames(byBrp.get(primary)),
      conflicts: brpNames.slice(1).map((brpName) => ({
        brpName,
        mgaNames: sortedNames(byBrp.get(brpName)),
      })),
    });
  }

  records.sort(
    (a, b) =>
      cmp(a.biddingZone, b.biddingZone) ||
      cmp(a.retailerName, b.retailerName) ||
      cmp(a.direction, b.direction),
  );

  return { records, skipped: sortSkipped(skipped) };
}

/** Naturlig nyckel för en relation. */
export function relationKey(r: {
  biddingZone: string;
  retailerName: string;
  direction: string;
}): string {
  return `${r.biddingZone}\u0000${r.retailerName}\u0000${r.direction}`;
}

function sortedNames(set: Set<string> | undefined): string[] {
  return [...(set ?? [])].sort((a, b) => cmp(a, b));
}

function sortSkipped(rows: SkippedRow[]): SkippedRow[] {
  return rows.sort((a, b) => cmp(a.code, b.code) || cmp(a.reason, b.reason));
}
