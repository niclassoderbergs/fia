import DatasetHeader from '@/components/DatasetHeader';
import FilterableTable, { type Row } from '@/components/FilterableTable';
import { getBrpParties } from '@/lib/data';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-static';

export const metadata = { title: 'Balance Responsible Parties — fia' };

export default function BrpPage() {
  const dataset = getBrpParties();

  const rows: Row[] = dataset.rows.map((r) => ({
    id: r.brpCode,
    values: {
      brpCode: r.brpCode,
      brpName: r.brpName,
      businessId: r.businessId ?? '—',
      validityStart: r.validityStart ? formatDate(r.validityStart) : '—',
      validityEnd: r.validityEnd ? formatDate(r.validityEnd) : 'tills vidare',
    },
  }));

  // Verifierat vid seedningen 2026-08-17: ALLA rader bar samma slutdatum
  // (årsskiftet) — det är eSetts rullande administrativa horisont, inte en
  // utträdessignal. Signalen är ett datum som AVVIKER från horisonten.
  const horizon = dataset.rows.reduce<string | null>(
    (max, r) => (r.validityEnd !== null && (max === null || r.validityEnd > max) ? r.validityEnd : max),
    null,
  );
  const outliers = dataset.rows.filter(
    (r) => r.validityEnd !== null && horizon !== null && r.validityEnd < horizon,
  );

  return (
    <>
      <DatasetHeader
        slug="brp"
        fetchedAt={dataset.fetchedAt}
        lede="Svenska balansansvariga parter. Det enda av eSetts register som bär giltighetsdatum."
      />

      {outliers.length > 0 ? (
        <p className="notice">
          {outliers.length} balansansvariga har ett slutdatum <em>tidigare</em> än registrets
          gemensamma horisont{horizon ? ` (${formatDate(horizon)})` : ''} — en möjlig signal om
          utträde. Elhandlare med någon av dem som BRP behöver en ny motpart innan datumet
          passeras; jämför mot Retailer Balance Responsibilities.
        </p>
      ) : (
        <p className="lede">
          Samtliga poster bär samma slutdatum{horizon ? ` (${formatDate(horizon)})` : ''} — eSetts
          rullande administrativa horisont, inte en signal om utträde. Det som betyder något är ett
          datum som avviker nedåt; då flaggas det här.
        </p>
      )}

      <FilterableTable
        columns={[
          { key: 'brpCode', label: 'brpCode', mono: true },
          { key: 'brpName', label: 'Namn' },
          { key: 'businessId', label: 'Organisationsnummer', mono: true },
          { key: 'validityStart', label: 'Giltig från' },
          { key: 'validityEnd', label: 'Giltig till' },
        ]}
        rows={rows}
        searchPlaceholder="Sök balansansvarig, kod eller organisationsnummer…"
      />
    </>
  );
}
