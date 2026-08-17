import DatasetHeader from '@/components/DatasetHeader';
import FilterableTable, { type Row } from '@/components/FilterableTable';
import { getRetailers } from '@/lib/data';

export const dynamic = 'force-static';

export const metadata = { title: 'Retailers — fia' };

export default function RetailersPage() {
  const dataset = getRetailers();

  const rows: Row[] = dataset.rows.map((r) => ({
    id: r.reCode,
    values: {
      reCode: r.reCode,
      reName: r.reName,
      codingScheme: r.codingScheme ?? '—',
    },
  }));

  return (
    <>
      <DatasetHeader
        slug="retailers"
        fetchedAt={dataset.fetchedAt}
        lede="Svenska elhandlare i eSetts register — med kod, till skillnad från balansansvarsdatat (EXP04) som bara bär namn."
      />

      <FilterableTable
        columns={[
          { key: 'reCode', label: 'reCode', mono: true },
          { key: 'reName', label: 'Namn' },
          { key: 'codingScheme', label: 'Kodschema' },
        ]}
        rows={rows}
        searchPlaceholder="Sök elhandlare eller kod…"
      />
    </>
  );
}
