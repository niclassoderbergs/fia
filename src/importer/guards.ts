// Spärrar som körs FÖRE någon datafil skrivs.
//
// Handover §7 pekar ut det farligaste scenariot: eSett svarar 200 OK men med
// tom eller partiell lista. Utan spärr tolkas det som "alla relationer har
// upphört" och en enda körning raderar hela registret — som en helt normal
// commit. Spärrarna gör att en sådan körning i stället stannar med status
// `blocked`, lämnar datafilerna orörda och skriver en rapport som säger varför.

import { BIDDING_ZONES } from '@/esett/mappers';
import type { GuardResult } from '@/lib/types';

/** Tomt svar är alltid fel — eSett har aldrig noll svenska nätområden eller relationer. */
export function guardNonEmpty(name: string, count: number): GuardResult {
  return {
    name: `${name}: icke-tomt svar`,
    ok: count > 0,
    detail:
      count > 0
        ? `${count} poster`
        : 'eSett svarade med noll poster — behandlas som partiellt fel, inte som en tömning',
  };
}

/**
 * Alla fyra svenska prisområden måste vara med. Strikt likhet, ingen tröskel:
 * saknas SE2 i svaret är BRP-snapshoten ofullständig, och varje relation i
 * SE2 skulle annars se ut att ha upphört.
 */
export function guardAllZones(foundZones: string[]): GuardResult {
  const found = new Set(foundZones);
  const missing = BIDDING_ZONES.filter((z) => !found.has(z));
  return {
    name: 'Prisområden: SE1–SE4 kompletta',
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? `alla fyra hämtade (${BIDDING_ZONES.join(', ')})`
        : `saknar ${missing.join(', ')} — snapshoten är ofullständig`,
  };
}

/**
 * Massförändringsspärr: vägrar skriva när för stor andel av posterna
 * försvunnit sedan förra körningen.
 *
 * Mäts på antal FÖRSVUNNA nycklar, inte på nettoförändring — 100 borttagna
 * och 100 tillagda är noll netto men fortfarande 100 poster som försvann.
 *
 * `maxShrinkPct` är en policy, inte en sanning. Den sätts i .env och ska vara
 * ett tal ni kan stå för; koden hittar inte på någon "lagom" nivå.
 */
export function guardShrink(
  name: string,
  previousTotal: number,
  removed: number,
  maxShrinkPct: number,
): GuardResult {
  const label = `${name}: massförändringsspärr`;

  if (previousTotal === 0) {
    return { name: label, ok: true, detail: 'ingen tidigare körning att jämföra mot' };
  }
  if (removed === 0) {
    return { name: label, ok: true, detail: 'inga poster försvann' };
  }

  const pct = removed / previousTotal;
  const asPct = (v: number) => `${(v * 100).toFixed(1).replace('.', ',')} %`;
  return {
    name: label,
    ok: pct <= maxShrinkPct,
    detail:
      `${removed} av ${previousTotal} poster försvann (${asPct(pct)}), ` +
      `gräns ${asPct(maxShrinkPct)}`,
  };
}

/** Sant bara när samtliga spärrar passerat. */
export function allPassed(guards: GuardResult[]): boolean {
  return guards.every((g) => g.ok);
}

/** Sammanfattning av de spärrar som fällde — går in i körningens felsträng. */
export function failureSummary(guards: GuardResult[]): string {
  return guards
    .filter((g) => !g.ok)
    .map((g) => `${g.name} — ${g.detail}`)
    .join(' | ');
}
