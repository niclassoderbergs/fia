import Link from 'next/link';

import StatusBadge from '@/components/StatusBadge';
import { countByZone, getBrpRelations, getDsos, getGridAreas, getRunIndex } from '@/lib/data';
import { formatDateTime, formatDuration, formatNumber } from '@/lib/format';

export const dynamic = 'force-static';

export default function OverviewPage() {
  const gridAreas = getGridAreas();
  const dsos = getDsos();
  const brp = getBrpRelations();
  const runs = getRunIndex().runs;
  const latest = runs[0];

  const zones = countByZone(gridAreas.rows);
  const conflicts = brp.rows.filter((r) => r.conflicts.length > 0).length;
  const unlinked = gridAreas.rows.filter((r) => r.dsoCode === null).length;

  if (!latest) {
    return (
      <>
        <h1>Översikt</h1>
        <p className="lede">Ingen import har körts än. Kör <span className="mono">npm run import</span> på servern.</p>
      </>
    );
  }

  return (
    <>
      <h1>Översikt</h1>
      <p className="lede">
        Registret hämtas från eSett open data varje natt och sparas som filer i det här repot.
        Sidan visar innehållet i den senast lyckade körningen.
      </p>

      {latest.status !== 'success' ? (
        <p className={`notice ${latest.status === 'failed' ? 'notice-danger' : ''}`}>
          <strong>Senaste körningen ({formatDateTime(latest.startedAt)}) gick inte igenom.</strong>{' '}
          Siffrorna nedan är därför oförändrade sedan senast lyckade körning.{' '}
          {latest.error ? <span className="mono">{latest.error}</span> : null}{' '}
          <Link href={`/korningar/${latest.id}`}>Se körningen →</Link>
        </p>
      ) : null}

      <div className="stat-row">
        <div className="stat">
          <div className="stat-label">Nätområden</div>
          <div className="stat-value">{formatNumber(gridAreas.count)}</div>
          <div className="stat-note">
            {['SE1', 'SE2', 'SE3', 'SE4'].map((z) => `${z} ${zones[z] ?? 0}`).join(' · ')}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Nätägare</div>
          <div className="stat-value">{formatNumber(dsos.count)}</div>
          <div className="stat-note">
            {unlinked > 0 ? `${unlinked} nätområden utan träff` : 'alla nätområden länkade'}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Balansansvar</div>
          <div className="stat-value">{formatNumber(brp.count)}</div>
          <div className="stat-note">
            {conflicts > 0 ? `${conflicts} med delad BRP` : 'inga delade relationer'}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Senaste körning</div>
          <div className="stat-value" style={{ fontSize: '18px', paddingTop: '6px' }}>
            <StatusBadge status={latest.status} dryRun={latest.dryRun} />
          </div>
          <div className="stat-note">{formatDateTime(latest.startedAt)}</div>
        </div>
      </div>

      <h2>Senaste körningarna</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tidpunkt</th>
              <th>Status</th>
              <th>Start</th>
              <th className="num">Förändringar</th>
              <th className="num">Tid</th>
            </tr>
          </thead>
          <tbody>
            {runs.slice(0, 10).map((run) => (
              <tr key={run.id}>
                <td>
                  <Link href={`/korningar/${run.id}`}>{formatDateTime(run.startedAt)}</Link>
                </td>
                <td>
                  <StatusBadge status={run.status} dryRun={run.dryRun} />
                </td>
                <td className="muted">{run.triggeredBy === 'cron' ? 'Schemalagd' : 'Manuell'}</td>
                <td className="num">{formatNumber(run.changeCount)}</td>
                <td className="num muted">{formatDuration(run.durationMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: '12px' }}>
        <Link href="/korningar">Alla körningar →</Link>
      </p>
    </>
  );
}
