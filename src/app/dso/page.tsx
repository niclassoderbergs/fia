import FilterableTable, { type Row } from '@/components/FilterableTable';
import { getDsos, getGridAreas, getLastSuccessfulRun } from '@/lib/data';
import { formatDateTime, formatNumber } from '@/lib/format';

export const dynamic = 'force-static';

export const metadata = { title: 'Nätägare — fia' };

export default function DsosPage() {
  const dataset = getDsos();
  const gridAreas = getGridAreas().rows;
  const checked = getLastSuccessfulRun();

  const areasByDso = new Map<string, number>();
  for (const area of gridAreas) {
    if (area.dsoCode === null) continue;
    areasByDso.set(area.dsoCode, (areasByDso.get(area.dsoCode) ?? 0) + 1);
  }

  const rows: Row[] = dataset.rows.map((dso) => ({
    id: dso.dsoCode,
    values: {
      dsoCode: dso.dsoCode,
      name: dso.name,
      codingScheme: dso.codingScheme,
      areas: formatNumber(areasByDso.get(dso.dsoCode) ?? 0),
    },
  }));

  return (
    <>
      <h1>Nätägare</h1>
      <p className="lede">
        Svenska nätägare (DSO) enligt eSett, från <span className="mono">{dataset.source}</span>.
        Koden är den femsiffriga NSE-koden som också används som Ediel-id. Innehållet ändrades
        senast {formatDateTime(dataset.fetchedAt)}
        {checked ? ` och kontrollerades mot eSett ${formatDateTime(checked.startedAt)}` : ''}.
      </p>

      <FilterableTable
        columns={[
          { key: 'dsoCode', label: 'Kod', mono: true },
          { key: 'name', label: 'Namn' },
          { key: 'codingScheme', label: 'Kodschema' },
          { key: 'areas', label: 'Nätområden', numeric: true },
        ]}
        rows={rows}
        searchPlaceholder="Sök nätägare eller kod…"
      />
    </>
  );
}
