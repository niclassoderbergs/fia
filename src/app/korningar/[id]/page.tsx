import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BrpChangeTable, RecordChangeTable } from '@/components/ChangeRows';
import StatusBadge from '@/components/StatusBadge';
import { getRun, getRunIndex } from '@/lib/data';
import { TRIGGER_LABEL, formatDateTime, formatDuration, formatNumber } from '@/lib/format';
import type { RunScope } from '@/lib/types';

/** Läsbara namn för seedade dataset. */
const SEED_LABEL: Record<RunScope, string> = {
  dsos: 'nätägare',
  gridAreas: 'nätområden',
  brp: 'balansansvar',
  retailers: 'elhandlare',
  brpParties: 'balansansvariga',
  bsps: 'balanstjänsteleverantörer',
  banks: 'settlementbanker',
};

export const dynamic = 'force-static';

export function generateStaticParams() {
  return getRunIndex().runs.map((run) => ({ id: run.id }));
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) notFound();

  const { counts } = run;
  const scope: RunScope[] = run.scope ?? ['dsos', 'gridAreas', 'brp'];
  const covers = (part: RunScope) => scope.includes(part);
  const hasChanges = run.changes.records.length > 0 || run.changes.brp.length > 0;
  const skippedTotal =
    run.skipped.dsos.length +
    run.skipped.gridAreas.length +
    run.skipped.brp.length +
    (run.skipped.retailers?.length ?? 0) +
    (run.skipped.brpParties?.length ?? 0) +
    (run.skipped.bsps?.length ?? 0) +
    (run.skipped.banks?.length ?? 0);

  return (
    <>
      <p className="muted" style={{ marginBottom: '8px' }}>
        <Link href="/korningar">← Alla körningar</Link>
      </p>

      <h1>
        Körning {formatDateTime(run.startedAt)} <StatusBadge status={run.status} dryRun={run.dryRun} />
      </h1>
      <p className="lede">
        {TRIGGER_LABEL[run.triggeredBy] ?? run.triggeredBy} · {formatDuration(run.durationMs)}
        {run.requestCount > 0 ? ` · ${run.requestCount} anrop mot eSett` : ''} · id{' '}
        <span className="mono">{run.id}</span>
      </p>

      {run.scope ? (
        <p className="notice">
          Äldre körning som bara omfattade{' '}
          {covers('brp') ? 'balansansvaret' : 'nätområden och nätägare'} — nätområden och
          balansansvar hämtades då i separata körningar, och bara totaltiden loggades.
        </p>
      ) : null}

      {run.seeded?.length ? (
        <p className="notice">
          Körningen etablerade utgångsläget för{' '}
          {run.seeded.map((s) => SEED_LABEL[s]).join(', ')} — den första hämtningen är ingen
          förändring, så de delarna redovisas utan ändringsposter.
        </p>
      ) : null}

      {run.error ? (
        <p className={`notice ${run.status === 'failed' ? 'notice-danger' : ''}`}>
          <strong>{run.status === 'blocked' ? 'Stoppad av spärr: ' : 'Fel: '}</strong>
          <span className="mono">{run.error}</span>
          {run.status !== 'success' ? (
            <>
              <br />
              Datafilerna lämnades orörda — innehållet på övriga sidor är kvar från föregående
              lyckade körning.
            </>
          ) : null}
        </p>
      ) : null}

      {run.dryRun ? (
        <p className="notice">
          Torrkörning: allt hämtades och jämfördes, men inga datafiler skrevs och ingenting
          committades.
        </p>
      ) : null}

      {/* Bara det körningen faktiskt omfattade — en nolla för något som aldrig
          hämtades vore ett påstående om verkligheten, inte en frånvaro av data. */}
      <div className="stat-row">
        {covers('gridAreas') ? (
          <div className="stat">
            <div className="stat-label">Nätområden</div>
            <div className="stat-value">{formatNumber(run.totals.gridAreas)}</div>
            <div className="stat-note">
              +{counts.gridAreas.added} · ~{counts.gridAreas.changed} · −{counts.gridAreas.removed}
            </div>
          </div>
        ) : null}
        {covers('dsos') ? (
          <div className="stat">
            <div className="stat-label">Nätägare</div>
            <div className="stat-value">{formatNumber(run.totals.dsos)}</div>
            <div className="stat-note">
              +{counts.dsos.added} · ~{counts.dsos.changed} · −{counts.dsos.removed}
            </div>
          </div>
        ) : null}
        {covers('brp') ? (
          <div className="stat">
            <div className="stat-label">Balansansvar</div>
            <div className="stat-value">{formatNumber(run.totals.brpRelations)}</div>
            <div className="stat-note">
              {counts.brp.brpSwitches} byten · {counts.brp.newRetailers} nya · {counts.brp.ended}{' '}
              upphörda
            </div>
          </div>
        ) : null}
        {/* Registren som tillkom vid eSett-struktureringen — finns bara i nyare körningar. */}
        {(
          [
            ['Elhandlare', run.totals.retailers, counts.retailers],
            ['Balansansvariga', run.totals.brpParties, counts.brpParties],
            ['BSP', run.totals.bsps, counts.bsps],
            ['Banker', run.totals.banks, counts.banks],
          ] as const
        ).map(([label, total, diffCounts]) =>
          total === undefined ? null : (
            <div className="stat" key={label}>
              <div className="stat-label">{label}</div>
              <div className="stat-value">{formatNumber(total)}</div>
              <div className="stat-note">
                +{diffCounts?.added ?? 0} · ~{diffCounts?.changed ?? 0} · −{diffCounts?.removed ?? 0}
              </div>
            </div>
          ),
        )}
      </div>

      <h2>Spärrar</h2>
      <div className="card">
        <ul className="guard-list">
          {run.guards.length === 0 ? (
            <li className="muted">
              {run.scope
                ? 'Spärrar loggades inte för den här körningen.'
                : 'Inga spärrar utvärderades — hämtningen nådde aldrig dit.'}
            </li>
          ) : (
            run.guards.map((guard) => (
              <li key={guard.name}>
                <span className={`badge ${guard.ok ? 'badge-ok' : 'badge-danger'}`}>
                  {guard.ok ? 'OK' : 'Fälld'}
                </span>
                <strong>{guard.name}</strong>
                <span className="muted">{guard.detail}</span>
              </li>
            ))
          )}
        </ul>
      </div>

      <h2>Hämtning</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Steg</th>
              <th>Endpoint</th>
              <th className="num">Rader i svaret</th>
              <th className="num">Tid</th>
            </tr>
          </thead>
          <tbody>
            {run.steps.map((step) => (
              <tr key={step.endpoint}>
                <td>{step.name}</td>
                <td className="mono muted">{step.endpoint}</td>
                <td className="num">{formatNumber(step.fetched)}</td>
                <td className="num muted">{formatDuration(step.durationMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Förändringar</h2>
      {run.changesTruncated ? (
        <p className="notice">
          Ändringslistorna är kapade till 500 rader per typ. Hela förändringen finns i git-historiken
          för filerna under <span className="mono">data/</span>.
        </p>
      ) : null}

      {!hasChanges ? (
        <div className="table-wrap">
          <p className="empty">Inget ändrades i den här körningen.</p>
        </div>
      ) : null}

      {run.changes.brp.length > 0 ? (
        <>
          <h3>Balansansvar</h3>
          <BrpChangeTable changes={run.changes.brp} />
        </>
      ) : null}

      {run.changes.records.length > 0 ? (
        <>
          <h3>Register</h3>
          <RecordChangeTable changes={run.changes.records} showEntity />
        </>
      ) : null}

      {skippedTotal > 0 ? (
        <>
          <h2>Överhoppade rader</h2>
          <p className="muted">
            Rader eSett skickade men som inte kunde tolkas. De ingår inte i siffrorna ovan.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Typ</th>
                  <th>Kod</th>
                  <th>Skäl</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['Nätägare', run.skipped.dsos],
                    ['Nätområde', run.skipped.gridAreas],
                    ['Balansansvar', run.skipped.brp],
                    ['Elhandlare', run.skipped.retailers ?? []],
                    ['Balansansvarig', run.skipped.brpParties ?? []],
                    ['BSP', run.skipped.bsps ?? []],
                    ['Bank', run.skipped.banks ?? []],
                  ] as const
                ).flatMap(([label, rows]) =>
                  rows.map((row, i) => (
                    <tr key={`${label}-${row.code}-${i}`}>
                      <td className="muted">{label}</td>
                      <td className="mono">{row.code}</td>
                      <td>{row.reason}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}
