// Formatering för visning. Allt i Europe/Stockholm och svensk notation.
//
// Tidszonen anges alltid explicit: bygget körs på Vercel i UTC, så utan
// timeZone skulle tiderna bli en timme fel för läsaren.

const dateTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm',
  dateStyle: 'short',
  timeStyle: 'short',
});

const dateOnly = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm',
  dateStyle: 'medium',
});

export function formatDateTime(iso: string): string {
  if (!iso) return '—';
  return dateTime.format(new Date(iso));
}

export function formatDate(iso: string): string {
  if (!iso) return '—';
  return dateOnly.format(new Date(iso));
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('sv-SE').format(n);
}

/**
 * Räkneord med rätt böjning: "1 ändrat nätområde" men "13 ändrade nätområden".
 * Noll tar pluralformen, vilket är rätt på svenska ("0 BRP-byten").
 */
export function plural(count: number, one: string, many: string): string {
  return `${formatNumber(count)} ${count === 1 ? one : many}`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 90) return `${seconds.toFixed(1).replace('.', ',')} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds % 60)} s`;
}

export const DIRECTION_LABEL: Record<string, string> = {
  consumption: 'Förbrukning',
  production: 'Produktion',
};

export const STATUS_LABEL: Record<string, string> = {
  success: 'Lyckad',
  blocked: 'Spärrad',
  failed: 'Misslyckad',
};

export const BRP_ACTION_LABEL: Record<string, string> = {
  new_retailer: 'Ny elhandlare',
  new_relation: 'Ny relation',
  brp_switch: 'BRP-byte',
  ended: 'Upphörd',
};

export const RECORD_ACTION_LABEL: Record<string, string> = {
  added: 'Tillagd',
  changed: 'Ändrad',
  removed: 'Borttagen',
  // Förekommer bara i historik från energi-systemet.
  linked: 'Länkad',
};

export const TRIGGER_LABEL: Record<string, string> = {
  cron: 'Schemalagd',
  manual: 'Manuell',
  unknown: 'Okänd',
};

/** Läsbar etikett per entity-värde i RecordChange-poster. */
export const ENTITY_LABEL: Record<string, string> = {
  dso: 'Nätägare',
  grid_area: 'Nätområde',
  retailer: 'Elhandlare',
  brp_party: 'Balansansvarig',
  bsp: 'Balanstjänsteleverantör',
  bank: 'Settlementbank',
};

/** Svensk kollation för visningslistor. Påverkar aldrig filer i data/. */
export function sortSv(a: string, b: string): number {
  return a.localeCompare(b, 'sv');
}
