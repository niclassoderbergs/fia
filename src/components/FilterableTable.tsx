'use client';

import { useMemo, useState } from 'react';

export interface Column {
  key: string;
  label: string;
  /** Högerställ och använd siffertypsnitt. */
  numeric?: boolean;
  /** Monospace — för koder. */
  mono?: boolean;
}

export interface Facet {
  key: string;
  label: string;
  options: string[];
}

export interface Row {
  id: string;
  /** Värden per kolumnnyckel. Redan formaterade på servern. */
  values: Record<string, string>;
  /** Rådata som fritextsökningen läser, utöver de synliga värdena. */
  search?: string;
}

interface Props {
  columns: Column[];
  rows: Row[];
  facets?: Facet[];
  searchPlaceholder?: string;
  /** Visas när filtret inte matchar något. */
  emptyLabel?: string;
}

/**
 * Tabell med fritextsök och facettfilter, allt i webbläsaren.
 *
 * Hela datamängden skickas med sidan — 1 785 relationer är några hundra kB och
 * sidan är ändå statiskt genererad. Det gör filtreringen omedelbar och
 * betyder att appen inte behöver något API alls.
 */
export default function FilterableTable({
  columns,
  rows,
  facets = [],
  searchPlaceholder = 'Sök…',
  emptyLabel = 'Inga rader matchar filtret.',
}: Props) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Record<string, string>>({});

  const haystacks = useMemo(
    () =>
      new Map(
        rows.map((row) => [
          row.id,
          `${Object.values(row.values).join(' ')} ${row.search ?? ''}`.toLowerCase(),
        ]),
      ),
    [rows],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const terms = needle.length > 0 ? needle.split(/\s+/) : [];

    return rows.filter((row) => {
      for (const [key, value] of Object.entries(selected)) {
        if (value && row.values[key] !== value) return false;
      }
      if (terms.length === 0) return true;
      const haystack = haystacks.get(row.id) ?? '';
      return terms.every((t) => haystack.includes(t));
    });
  }, [rows, query, selected, haystacks]);

  return (
    <>
      <div className="toolbar">
        <input
          type="search"
          value={query}
          placeholder={searchPlaceholder}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={searchPlaceholder}
        />
        {facets.map((facet) => (
          <select
            key={facet.key}
            value={selected[facet.key] ?? ''}
            aria-label={facet.label}
            onChange={(e) =>
              setSelected((prev) => ({ ...prev, [facet.key]: e.target.value }))
            }
          >
            <option value="">{facet.label}: alla</option>
            {facet.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ))}
        <span className="result-count">
          {filtered.length === rows.length
            ? `${rows.length} rader`
            : `${filtered.length} av ${rows.length} rader`}
        </span>
      </div>

      <div className="table-wrap">
        {filtered.length === 0 ? (
          <p className="empty">{emptyLabel}</p>
        ) : (
          <table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={c.numeric ? 'num' : undefined}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id}>
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={[c.numeric ? 'num' : '', c.mono ? 'mono' : '']
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {row.values[c.key] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
