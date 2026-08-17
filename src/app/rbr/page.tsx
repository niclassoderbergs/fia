import DatasetHeader from '@/components/DatasetHeader';
import FilterableTable, { type Row } from '@/components/FilterableTable';
import { getBrpRelations } from '@/lib/data';
import { DIRECTION_LABEL, formatNumber, sortSv } from '@/lib/format';

export const dynamic = 'force-static';

export const metadata = { title: 'Retailer Balance Responsibilities — Fia' };

export default function RbrPage() {
  const dataset = getBrpRelations();

  const rows: Row[] = dataset.rows.map((rel) => ({
    id: `${rel.biddingZone}|${rel.retailerName}|${rel.direction}`,
    values: {
      biddingZone: rel.biddingZone,
      retailerName: rel.retailerName,
      brpName:
        rel.conflicts.length > 0
          ? `${rel.brpName} (+${rel.conflicts.map((c) => c.brpName).join(', ')})`
          : rel.brpName,
      direction: DIRECTION_LABEL[rel.direction] ?? rel.direction,
      areas: formatNumber(rel.mgaNames.length),
    },
    // Nätområdesnamnen syns inte som kolumn men ska gå att söka på.
    search: rel.mgaNames.join(' '),
  }));

  const brpNames = [...new Set(dataset.rows.map((r) => r.brpName))].sort(sortSv);
  const conflicts = dataset.rows.filter((r) => r.conflicts.length > 0);

  return (
    <>
      <DatasetHeader
        slug="rbr"
        fetchedAt={dataset.fetchedAt}
        lede="Vilken balansansvarig (BRP) varje elhandlare har, per prisområde och riktning. Sök på ett nätområdesnamn för att se relationerna som gäller där."
      />

      <p className="notice">
        eSett anger de här relationerna med <strong>namn</strong> — utan koder och utan
        giltighetsdatum. Ett firmanamnsbyte hos en elhandlare ser därför likadant ut som att en
        relation upphört och en ny tillkommit. Tolka aldrig &quot;upphörd&quot; som att elhandlaren
        lämnat marknaden.
        {conflicts.length > 0
          ? ` ${conflicts.length} relationer har olika BRP i olika nätområden inom samma prisområde — de visas med samtliga BRP.`
          : ''}
      </p>

      <FilterableTable
        columns={[
          { key: 'biddingZone', label: 'Prisområde' },
          { key: 'retailerName', label: 'Elhandlare' },
          { key: 'brpName', label: 'Balansansvarig' },
          { key: 'direction', label: 'Riktning' },
          { key: 'areas', label: 'Nätområden', numeric: true },
        ]}
        rows={rows}
        facets={[
          { key: 'biddingZone', label: 'Prisområde', options: ['SE1', 'SE2', 'SE3', 'SE4'] },
          { key: 'direction', label: 'Riktning', options: ['Förbrukning', 'Produktion'] },
          { key: 'brpName', label: 'Balansansvarig', options: brpNames },
        ]}
        searchPlaceholder="Sök elhandlare, balansansvarig eller nätområde…"
      />
    </>
  );
}
