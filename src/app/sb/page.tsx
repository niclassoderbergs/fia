import DatasetHeader from '@/components/DatasetHeader';
import FilterableTable, { type Row } from '@/components/FilterableTable';
import { getBanks } from '@/lib/data';
import { sortSv } from '@/lib/format';

export const dynamic = 'force-static';

export const metadata = { title: 'Settlement Banks — fia' };

export default function SbPage() {
  const dataset = getBanks();

  const rows: Row[] = dataset.rows.map((r) => ({
    id: r.bic,
    values: {
      bic: r.bic,
      name: r.name,
      country: r.country,
    },
  }));

  const countries = [...new Set(dataset.rows.map((r) => r.country))].sort(sortSv);

  return (
    <>
      <DatasetHeader
        slug="sb"
        fetchedAt={dataset.fetchedAt}
        lede="Banker godkända för säkerheter och avräkning mot eSett. Listan gäller hela Norden — bankerna betjänar alla länder, så den filtreras inte på Sverige."
      />

      <FilterableTable
        columns={[
          { key: 'bic', label: 'BIC', mono: true },
          { key: 'name', label: 'Namn' },
          { key: 'country', label: 'Land' },
        ]}
        rows={rows}
        facets={[{ key: 'country', label: 'Land', options: countries }]}
        searchPlaceholder="Sök bank eller BIC…"
      />
    </>
  );
}
