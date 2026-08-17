import DatasetHeader from '@/components/DatasetHeader';
import FilterableTable, { type Row } from '@/components/FilterableTable';
import { getBsps } from '@/lib/data';

export const dynamic = 'force-static';

export const metadata = { title: 'Balancing Service Providers — fia' };

export default function BspPage() {
  const dataset = getBsps();

  const rows: Row[] = dataset.rows.map((r) => ({
    id: r.bspCode,
    values: {
      bspCode: r.bspCode,
      bspName: r.bspName,
      businessId: r.businessId ?? '—',
    },
  }));

  return (
    <>
      <DatasetHeader
        slug="bsp"
        fetchedAt={dataset.fetchedAt}
        lede="Svenska balanstjänsteleverantörer — aktörerna som säljer balanskapacitet till Svenska kraftnät."
      />

      <FilterableTable
        columns={[
          { key: 'bspCode', label: 'bspCode', mono: true },
          { key: 'bspName', label: 'Namn' },
          { key: 'businessId', label: 'Organisationsnummer', mono: true },
        ]}
        rows={rows}
        searchPlaceholder="Sök balanstjänsteleverantör…"
      />
    </>
  );
}
