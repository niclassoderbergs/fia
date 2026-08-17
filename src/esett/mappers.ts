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
  EsettBankRow,
  EsettBrpPartyRow,
  EsettBspRow,
  EsettDsoRow,
  EsettMgaRow,
  EsettRetailerBalanceRow,
  EsettRetailerRow,
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

/**
 * Registerposter från EXP01/EXP06. Fältnamnen är eSetts egna (reCode, brpName,
 * bic …) — vyn ska matcha API:et, och ett påhittat mellannamn hade bara varit
 * en översättning till för läsaren att hålla i huvudet.
 */
export interface RetailerRecord {
  reCode: string;
  reName: string;
  codingScheme: string | null;
  country: string;
}

export interface BrpPartyRecord {
  brpCode: string;
  brpName: string;
  businessId: string | null;
  codingScheme: string | null;
  country: string;
  validityStart: string | null;
  validityEnd: string | null;
}

export interface BspRecord {
  bspCode: string;
  bspName: string;
  businessId: string | null;
  codingScheme: string | null;
  country: string;
}

export interface BankRecord {
  bic: string;
  name: string;
  country: string;
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

/**
 * Gemensam kärna för registermappning: trimma, skippa tomma koder och
 * dubbletter med skäl, sortera deterministiskt på kod.
 */
function mapRegistry<R, T>(
  rows: R[],
  getCode: (row: R) => string,
  build: (row: R, code: string) => T,
): MapResult<T> {
  const byCode = new Map<string, T>();
  const skipped: SkippedRow[] = [];

  for (const row of rows) {
    const code = getCode(row).trim();
    if (!code) {
      skipped.push({ code: '<saknas>', reason: 'tom kod' });
      continue;
    }
    if (byCode.has(code)) {
      skipped.push({ code, reason: 'dubblett på kod' });
      continue;
    }
    byCode.set(code, build(row, code));
  }

  return {
    records: [...byCode.entries()]
      .sort(([a], [b]) => cmp(a, b))
      .map(([, record]) => record),
    skipped: sortSkipped(skipped),
  };
}

const trimOrNull = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/** EXP01 /Retailers → elhandlarregistret. */
export function mapRetailers(rows: EsettRetailerRow[]): MapResult<RetailerRecord> {
  return mapRegistry(rows, (r) => r.reCode, (r, reCode) => ({
    reCode,
    reName: r.reName.trim(),
    codingScheme: trimOrNull(r.codingScheme),
    country: r.country,
  }));
}

/** EXP01 /BalanceResponsibleParties → BRP-registret, med giltighetsdatum bevarade. */
export function mapBrpParties(rows: EsettBrpPartyRow[]): MapResult<BrpPartyRecord> {
  return mapRegistry(rows, (r) => r.brpCode, (r, brpCode) => ({
    brpCode,
    brpName: r.brpName.trim(),
    businessId: trimOrNull(r.businessId),
    codingScheme: trimOrNull(r.codingScheme),
    country: r.country,
    validityStart: trimOrNull(r.validityStart),
    validityEnd: trimOrNull(r.validityEnd),
  }));
}

/** EXP01 /BalanceServiceProviders → BSP-registret. */
export function mapBsps(rows: EsettBspRow[]): MapResult<BspRecord> {
  return mapRegistry(rows, (r) => r.bspCode, (r, bspCode) => ({
    bspCode,
    bspName: r.bspName.trim(),
    businessId: trimOrNull(r.businessId),
    codingScheme: trimOrNull(r.codingScheme),
    country: r.country,
  }));
}

/** EXP06 /Banks → settlementbanker, nyckel på BIC. Hela Norden — inget SE-filter. */
export function mapBanks(rows: EsettBankRow[]): MapResult<BankRecord> {
  return mapRegistry(rows, (r) => r.bic, (r, bic) => ({
    bic,
    name: r.name.trim(),
    country: r.country.trim(),
  }));
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
