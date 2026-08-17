// Schemavalidering av eSett open data-svaren.
//
// Ursprungssystemet gjorde `res.json() as T` utan validering. Det är den
// farligaste luckan i hela integrationen: byter eSett namn på ett fält blir
// varje rad `undefined`, filtreras bort tyst, och en komplett massradering
// ser ut som en normal körning. Här failar en sådan drift i stället högt.
//
// OBS: Zod strippar odeklarerade fält tyst (default `.strip()`). Vill du
// bevara ett nytt fält från eSett räcker det INTE att lägga till det i
// TypeScript-typen — det måste deklareras här också.

import { z } from 'zod';

/** EXP01 /DistributionSystemOperators — en nätägare (DSO). */
export const esettDsoRowSchema = z.object({
  dsoCode: z.string().min(1),
  dsoName: z.string(),
  codingScheme: z.string().optional(),
  country: z.string().min(1),
});
export type EsettDsoRow = z.infer<typeof esettDsoRowSchema>;

/** EXP03 /MeteringGridAreas — ett nätområde (MGA). */
export const esettMgaRowSchema = z.object({
  mgaCode: z.string().min(1),
  mgaName: z.string(),
  mgaType: z.string().optional(),
  /** Prisområde SE1–SE4. Blir vår bidding zone. */
  mba: z.string(),
  /** eSett bär nätägarens NAMN här, inte dess kod — därav namnmatchningen. */
  dsoName: z.string(),
  country: z.string().min(1),
});
export type EsettMgaRow = z.infer<typeof esettMgaRowSchema>;

/** EXP04 /MBAOptions — grupperat per land, med EIC-koder per prisområde. */
export const esettMbaOptionsResponseSchema = z.object({
  countryCode: z.string().min(1),
  mbas: z.array(
    z.object({
      /** EIC-kod, t.ex. 10Y1001A1001A46L för SE3. Matas in i mba-param. */
      code: z.string().min(1),
      /** Läsbart områdesnamn, t.ex. "SE3". */
      name: z.string().min(1),
    }),
  ),
});

/** Ett MBA-område efter utplattning. */
export interface EsettMbaOption {
  code: string;
  name: string;
}

/**
 * EXP04 /RetailerBalanceResponsibility — en elhandlare→BRP-relation.
 * Bär bara namn: inga koder, inga giltighetsdatum. Därav snapshot + diff.
 */
export const esettRetailerBalanceRowSchema = z.object({
  /** Elhandlarens namn. Del av den naturliga nyckeln → måste finnas. */
  reName: z.string().min(1),
  /** Balansansvarig parts namn. Det vi bevakar förändringar i. */
  brpName: z.string().min(1),
  /** Nätområdesnamn. Behålls så vi ser VILKA områden en relation gäller. */
  mgaName: z.string(),
  /** "Consumption" | "Production" — normaliseras i mappers. */
  energyDirectionType: z.string(),
});
export type EsettRetailerBalanceRow = z.infer<typeof esettRetailerBalanceRowSchema>;

/** En rad som inte klarade schemat, med tillräckligt sammanhang för felsökning. */
export interface InvalidRow {
  index: number;
  issues: string[];
  /** Råraden, trunkerad — hamnar i körningsrapporten. */
  raw: string;
}

export class EsettSchemaError extends Error {
  constructor(
    readonly endpoint: string,
    readonly invalid: InvalidRow[],
    readonly total: number,
  ) {
    super(
      `eSett ${endpoint}: ${invalid.length} av ${total} rader matchar inte förväntat schema ` +
        `(första: ${invalid[0]?.issues.join('; ') ?? 'okänt'})`,
    );
    this.name = 'EsettSchemaError';
  }
}

/**
 * Validerar en array rad för rad och samlar ALLA fel innan den kastar.
 * En körning som stupar på schemadrift ska kunna visa exakt vad som drev.
 */
export function parseRows<T>(
  endpoint: string,
  schema: z.ZodType<T>,
  body: unknown,
): T[] {
  if (!Array.isArray(body)) {
    throw new EsettSchemaError(
      endpoint,
      [{ index: -1, issues: ['svaret är inte en array'], raw: truncate(body) }],
      0,
    );
  }

  const ok: T[] = [];
  const invalid: InvalidRow[] = [];

  body.forEach((row, index) => {
    const result = schema.safeParse(row);
    if (result.success) {
      ok.push(result.data);
    } else {
      invalid.push({
        index,
        issues: result.error.issues.map((i) => `${i.path.join('.') || '<rot>'}: ${i.message}`),
        raw: truncate(row),
      });
    }
  });

  if (invalid.length > 0) throw new EsettSchemaError(endpoint, invalid, body.length);
  return ok;
}

function truncate(value: unknown): string {
  const s = (() => {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  })();
  return s.length > 300 ? `${s.slice(0, 300)}…` : s;
}
