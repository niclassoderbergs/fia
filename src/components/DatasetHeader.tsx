import { datasetBySlug } from '@/lib/datasets';
import { getLastSuccessfulRun } from '@/lib/data';
import { formatDateTime } from '@/lib/format';

/**
 * Sidhuvud för en dataset-vy: eSetts egen titel, EXP-badge, endpoint-raden
 * som kopplar vyn till API:et, och färskhetsraden.
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

  return (
    <>
      <h1>
        {dataset.title} <span className="badge badge-exp">{dataset.exp}</span>
      </h1>
      <p className="endpoint-line">
        <span className="method">GET</span> {dataset.endpoint}
      </p>
      <p className="lede">
        {lede} Innehållet ändrades senast {formatDateTime(fetchedAt)}
        {checked ? ` och kontrollerades mot eSett ${formatDateTime(checked.startedAt)}` : ''}.
      </p>
    </>
  );
}
