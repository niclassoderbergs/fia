import DatasetHeader from '@/components/DatasetHeader';
import FilterableTable, { type Row } from '@/components/FilterableTable';
import { getGridAreas } from '@/lib/data';

export const dynamic = 'force-static';

export const metadata = { title: 'Metering Grid Areas — fia' };

export default function MgaPage() {
  const dataset = getGridAreas();

  const rows: Row[] = dataset.rows.map((area) => ({
    id: area.mgaCode,
    values: {
      mgaCode: area.mgaCode,
      name: area.name,
      biddingZone: area.biddingZone,
      dsoName: area.dsoName,
      dsoCode: area.dsoCode ?? '—',
    },
    // Gör tvetydiga länkar sökbara utan att lägga en egen kolumn på dem.
    search: area.dsoNameAmbiguous ? 'tvetydig nätägare' : '',
  }));

  const ambiguous = dataset.rows.filter((a) => a.dsoNameAmbiguous).length;
  const unlinked = dataset.rows.filter((a) => a.dsoCode === null).length;

  return (
    <>
      <DatasetHeader
        slug="mga"
        fetchedAt={dataset.fetchedAt}
        lede="Svenska nätområden av typen DISTRIBUTION, med prisområde och nätägare."
      />

      {unlinked > 0 || ambiguous > 0 ? (
        <p className="notice">
          eSett anger nätägarens <em>namn</em> på nätområdet, inte dess kod, så kopplingen är en
          namnmatchning.{' '}
          {unlinked > 0 ? `${unlinked} nätområden saknar träff i nätägarregistret. ` : ''}
          {ambiguous > 0
            ? `${ambiguous} matchar flera nätägare med identiskt namn — där väljs lägsta koden, sök på "tvetydig nätägare" för att se dem.`
            : ''}
        </p>
      ) : null}

      <FilterableTable
        columns={[
          { key: 'mgaCode', label: 'MGA-kod', mono: true },
          { key: 'name', label: 'Namn' },
          { key: 'biddingZone', label: 'Prisområde' },
          { key: 'dsoName', label: 'Nätägare' },
          { key: 'dsoCode', label: 'Nätägarkod', mono: true },
        ]}
        rows={rows}
        facets={[{ key: 'biddingZone', label: 'Prisområde', options: ['SE1', 'SE2', 'SE3', 'SE4'] }]}
        searchPlaceholder="Sök nätområde, kod eller nätägare…"
      />
    </>
  );
}
