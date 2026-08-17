import DatasetHeader from '@/components/DatasetHeader';
import FilterableTable, { type Row } from '@/components/FilterableTable';
import { getDsos, getGridAreas } from '@/lib/data';
import { formatNumber } from '@/lib/format';

export const dynamic = 'force-static';

export const metadata = { title: 'Distribution System Operators — fia' };

export default function DsoPage() {
  const dataset = getDsos();
  const gridAreas = getGridAreas().rows;

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
      <DatasetHeader
        slug="dso"
        fetchedAt={dataset.fetchedAt}
        lede="Svenska nätägare (DSO). Koden är den femsiffriga NSE-koden som också används som Ediel-id."
      />

      <FilterableTable
        columns={[
          { key: 'dsoCode', label: 'dsoCode', mono: true },
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
