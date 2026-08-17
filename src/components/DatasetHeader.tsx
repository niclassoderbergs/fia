import DatasetChangesOverlay from '@/components/DatasetChangesOverlay';
import { datasetBySlug } from '@/lib/datasets';
import { getDatasetChangeHistory, getLastSuccessfulRun } from '@/lib/data';
import { formatDateTime } from '@/lib/format';

/**
 * Sidhuvud för en dataset-vy: eSetts egen titel, EXP-badge, endpoint-raden
 * som kopplar vyn till API:et, färskhetsraden — och "Visa förändringar",
 * som öppnar vyns egen förändringshistorik i en overlay.
 */
export default function DatasetHeader({
  slug,
  fetchedAt,
  lede,
}: {
  slug: string;
  fetchedAt: string;
  lede: string;
}) {
  const dataset = datasetBySlug(slug);
  if (!dataset) return null;
  const checked = getLastSuccessfulRun();
  const history = getDatasetChangeHistory(slug);

  return (
    <>
      <h1>
        {dataset.title} <span className="badge badge-exp">{dataset.exp}</span>
      </h1>
      <div className="dataset-head-row">
        <p className="endpoint-line">
          <span className="method">GET</span> {dataset.endpoint}
        </p>
        <DatasetChangesOverlay title={dataset.title} exp={dataset.exp} entries={history} />
      </div>
      <p className="lede">
        {lede} Innehållet ändrades senast {formatDateTime(fetchedAt)}
        {checked ? ` och kontrollerades mot eSett ${formatDateTime(checked.startedAt)}` : ''}.
      </p>
    </>
  );
}
