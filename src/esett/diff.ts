// Fält-för-fält-diff mellan förra körningens poster och den nya snapshoten.
//
// Ärvd från energi-systemets esett-diff.ts. Där drev diffen en ändringslogg i
// DB; här drev den två saker: (1) körningsrapporten som kollegan läser i
// webbvyn, och (2) beslutet att över huvud taget skriva om en fil. Skriver vi
// bara när något faktiskt skiljer sig blir git-historiken en sann
// ändringslogg i stället för en rad identiska dagliga commits.

import { cmp } from './sort';

/** Ett ändrat fält på en post. */
export interface FieldChange {
  field: string;
  from: string | null;
  to: string | null;
}

/**
 * `linked` skapas aldrig av den här appen — den finns bara i körningar
 * importerade från energi-systemet, där "nätägarkopplingen sattes" var ett eget
 * utfall. Den behålls i unionen hellre än plattas till `changed`, så historiken
 * säger samma sak som den gjorde i sitt ursprung.
 */
export type ChangeAction = 'added' | 'changed' | 'removed' | 'linked';

/** En förändrad post i ändringsloggen. */
export interface RecordChange {
  entity: string;
  /** Naturlig nyckel — dsoCode eller mgaCode. */
  code: string;
  name: string;
  action: ChangeAction;
  /** Ändrade fält. Tom för added/removed. */
  fields: FieldChange[];
}

export interface DiffCounts {
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
}

export interface DiffResult {
  changes: RecordChange[];
  counts: DiffCounts;
}

export interface DiffSpec<T> {
  entity: string;
  key: (row: T) => string;
  label: (row: T) => string;
  /** Fält som jämförs, med läsbar etikett. Fält utanför listan ignoreras. */
  fields: Array<{ key: keyof T & string; label: string }>;
}

/** Normaliserar ett värde till sträng | null för stabil jämförelse. */
function norm(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

/**
 * Jämför två poster fält för fält och returnerar bara de som skiljer sig.
 */
export function diffFields<T>(
  previous: T,
  current: T,
  fields: Array<{ key: keyof T & string; label: string }>,
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const { key, label } of fields) {
    const from = norm(previous[key]);
    const to = norm(current[key]);
    if (from !== to) changes.push({ field: label, from, to });
  }
  return changes;
}

/**
 * Diffar två listor poster mot varandra på naturlig nyckel.
 * Resultatet är sorterat på kod → samma indata ger alltid samma rapport.
 */
export function diffRecords<T>(previous: T[], current: T[], spec: DiffSpec<T>): DiffResult {
  const prevByKey = new Map(previous.map((r) => [spec.key(r), r]));
  const currByKey = new Map(current.map((r) => [spec.key(r), r]));

  const changes: RecordChange[] = [];
  const counts: DiffCounts = { added: 0, changed: 0, removed: 0, unchanged: 0 };

  for (const row of current) {
    const code = spec.key(row);
    const before = prevByKey.get(code);
    if (!before) {
      counts.added += 1;
      changes.push({ entity: spec.entity, code, name: spec.label(row), action: 'added', fields: [] });
      continue;
    }
    const fields = diffFields(before, row, spec.fields);
    if (fields.length === 0) {
      counts.unchanged += 1;
    } else {
      counts.changed += 1;
      changes.push({ entity: spec.entity, code, name: spec.label(row), action: 'changed', fields });
    }
  }

  for (const row of previous) {
    const code = spec.key(row);
    if (!currByKey.has(code)) {
      counts.removed += 1;
      changes.push({ entity: spec.entity, code, name: spec.label(row), action: 'removed', fields: [] });
    }
  }

  changes.sort((a, b) => cmp(a.code, b.code) || cmp(a.action, b.action));
  return { changes, counts };
}
