import Link from 'next/link';

import StatusBadge from '@/components/StatusBadge';
import { getRunIndex } from '@/lib/data';
import { TRIGGER_LABEL, formatDateTime, formatDuration, formatNumber } from '@/lib/format';

export const dynamic = 'force-static';

export const metadata = { title: 'Körningar — Fia' };

export default function RunsPage() {
  const { runs } = getRunIndex();

  return (
    <>
      <h1>Körningar</h1>
      <p className="lede">
        Varje nattlig hämtning loggas här — även de som misslyckades eller stoppades av en spärr.
        Klicka på en körning för att se exakt vad som ändrades.
      </p>

      {runs.length === 0 ? (
        <div className="table-wrap">
          <p className="empty">Ingen körning har genomförts än.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tidpunkt</th>
                <th>Status</th>
                <th>Start</th>
                <th className="num">Nätområden</th>
                <th className="num">Nätägare</th>
                <th className="num">Balansansvar</th>
                <th className="num">Förändringar</th>
                <th className="num">Tid</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>
                    <Link href={`/korningar/${run.id}`}>{formatDateTime(run.startedAt)}</Link>
                  </td>
                  <td>
                    <StatusBadge status={run.status} dryRun={run.dryRun} />
                  </td>
                  <td className="muted">{TRIGGER_LABEL[run.triggeredBy] ?? run.triggeredBy}</td>
                  {/* Historiken från energi täckte bara halva kedjan — visa streck
                      för det körningen inte omfattade i stället för en nolla. */}
                  <td className="num">
                    {run.scope && !run.scope.includes('gridAreas')
                      ? '—'
                      : formatNumber(run.totals.gridAreas)}
                  </td>
                  <td className="num">
                    {run.scope && !run.scope.includes('dsos') ? '—' : formatNumber(run.totals.dsos)}
                  </td>
                  <td className="num">
                    {run.scope && !run.scope.includes('brp')
                      ? '—'
                      : formatNumber(run.totals.brpRelations)}
                  </td>
                  <td className="num">{formatNumber(run.changeCount)}</td>
                  <td className="num muted">{formatDuration(run.durationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
