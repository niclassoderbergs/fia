import Link from 'next/link';

import {
  BRP_ACTION_LABEL,
  RECORD_ACTION_LABEL,
  formatDateTime,
  formatDuration,
  plural,
} from '@/lib/format';
import type { FeedEntry, RunScope } from '@/lib/types';

/** Kort riktningsetikett — flödet är tätt, "Förbrukning" tar för mycket plats. */
const DIRECTION_SHORT: Record<string, string> = {
  consumption: 'kons',
  production: 'prod',
};

const BRP_BADGE_CLASS: Record<string, string> = {
  new_retailer: 'badge-ok',
  new_relation: 'badge-neutral',
  brp_switch: 'badge-warn',
  ended: 'badge-danger',
};

const RECORD_BADGE_CLASS: Record<string, string> = {
  added: 'badge-ok',
  changed: 'badge-warn',
  removed: 'badge-danger',
};

/**
 * En rad text som säger vad dygnet innebar.
 *
 * När något ändrats redovisas BRP-byten och upphörda relationer även när de är
 * noll. De två är de enda utfallen som kan betyda att en kund flyttat
 * balansansvar — att se "0 BRP-byten" svart på vitt är ett annat besked än att
 * siffran inte nämns.
 */
function summaryLine(entry: FeedEntry): string {
  if (entry.status !== 'success') {
    return entry.error ?? 'körningen gick inte igenom';
  }

  // Historik från energi kördes som två separata jobb, så en rad täcker bara
  // den ena halvan. Redovisa aldrig siffror för det körningen inte omfattade.
  const scope = entry.scope ?? ['dsos', 'gridAreas', 'brp'];
  const covers = (part: RunScope) => scope.includes(part);

  if (entry.changeCount === 0) {
    const totals: string[] = [];
    if (covers('brp')) totals.push(plural(entry.totals.brpRelations, 'relation', 'relationer'));
    if (covers('gridAreas')) {
      totals.push(plural(entry.totals.gridAreas, 'nätområde', 'nätområden'));
    }
    if (covers('dsos') && !covers('brp')) {
      totals.push(plural(entry.totals.dsos, 'nätägare', 'nätägare'));
    }
    return `${totals.join(' · ')} · oförändrat`;
  }

  const parts: string[] = [];
  const { brp, gridAreas, dsos } = entry.counts;

  if (brp.newRetailers > 0) parts.push(plural(brp.newRetailers, 'ny elhandlare', 'nya elhandlare'));
  if (brp.newRelations > 0) parts.push(plural(brp.newRelations, 'ny relation', 'nya relationer'));

  // Byten och upphörda redovisas även vid noll — de är de enda utfallen som
  // kan betyda att balansansvar faktiskt flyttat, och "0 BRP-byten" svart på
  // vitt är ett annat besked än att siffran inte nämns.
  if (brp.newRetailers + brp.newRelations + brp.brpSwitches + brp.ended > 0) {
    parts.push(plural(brp.brpSwitches, 'BRP-byte', 'BRP-byten'));
    parts.push(plural(brp.ended, 'upphörd', 'upphörda'));
  }

  if (gridAreas.added > 0) parts.push(plural(gridAreas.added, 'nytt nätområde', 'nya nätområden'));
  if (gridAreas.changed > 0) {
    parts.push(plural(gridAreas.changed, 'ändrat nätområde', 'ändrade nätområden'));
  }
  if (gridAreas.removed > 0) {
    parts.push(plural(gridAreas.removed, 'borttaget nätområde', 'borttagna nätområden'));
  }
  if (dsos.added > 0) parts.push(plural(dsos.added, 'ny nätägare', 'nya nätägare'));
  if (dsos.changed > 0) parts.push(plural(dsos.changed, 'ändrad nätägare', 'ändrade nätägare'));
  if (dsos.removed > 0) {
    parts.push(plural(dsos.removed, 'borttagen nätägare', 'borttagna nätägare'));
  }

  return parts.join(' · ');
}

function badgeLabel(entry: FeedEntry): string {
  if (entry.status === 'blocked') return 'spärrad';
  if (entry.status === 'failed') return 'misslyckad';
  return plural(entry.changeCount, 'förändring', 'förändringar');
}

function badgeClass(entry: FeedEntry): string {
  if (entry.status === 'blocked') return 'badge-warn';
  if (entry.status === 'failed') return 'badge-danger';
  if (entry.changeCount === 0) return 'badge-neutral';
  return 'badge-ok';
}

export default function ChangeFeed({ entries }: { entries: FeedEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="table-wrap">
        <p className="empty">Ingen körning har genomförts än.</p>
      </div>
    );
  }

  return (
    <div className="feed">
      {entries.map((entry) => {
        const quiet = entry.status === 'success' && entry.changeCount === 0;

        return (
          <details key={entry.id} className="feed-item" data-quiet={quiet ? 'true' : 'false'}>
            <summary className="feed-summary">
              <span className="feed-date">{formatDateTime(entry.startedAt)}</span>
              <span className={`badge ${badgeClass(entry)}`}>{badgeLabel(entry)}</span>
              <span className="feed-note">{summaryLine(entry)}</span>
              {entry.origin === 'energi' ? (
                <span className="badge badge-neutral" title="Inläst historik från energi-systemet">
                  energi
                </span>
              ) : null}
              {entry.dryRun ? <span className="badge badge-neutral">torrkörning</span> : null}
              <span className="feed-duration">{formatDuration(entry.durationMs)}</span>
            </summary>

            <div className="feed-body">
              {entry.status !== 'success' ? (
                <p className={`notice ${entry.status === 'failed' ? 'notice-danger' : ''}`}>
                  {entry.status === 'blocked'
                    ? 'Stoppad av en spärr — datafilerna lämnades orörda, innehållet är kvar från föregående lyckade körning.'
                    : 'Körningen misslyckades — datafilerna lämnades orörda.'}
                  {entry.error ? (
                    <>
                      <br />
                      <span className="mono">{entry.error}</span>
                    </>
                  ) : null}
                </p>
              ) : null}

              {entry.changes.brp.map((change, i) => (
                <div className="change-row" key={`brp-${change.retailer}-${change.biddingZone}-${i}`}>
                  <span className={`badge ${BRP_BADGE_CLASS[change.action] ?? 'badge-neutral'}`}>
                    {BRP_ACTION_LABEL[change.action] ?? change.action}
                  </span>
                  <span className="change-main">{change.retailer}</span>
                  <span className="change-meta">{change.biddingZone}</span>
                  <span className="change-meta">
                    {DIRECTION_SHORT[change.direction] ?? change.direction}
                  </span>
                  <span className="change-brp">
                    {change.fromBrp ? <span>{change.fromBrp}</span> : null}
                    {change.fromBrp && change.toBrp ? <span className="arrow">→</span> : null}
                    {change.toBrp ? <strong>{change.toBrp}</strong> : null}
                  </span>
                </div>
              ))}

              {entry.changes.records.map((change, i) => (
                <div className="change-row" key={`rec-${change.entity}-${change.code}-${i}`}>
                  <span className={`badge ${RECORD_BADGE_CLASS[change.action] ?? 'badge-neutral'}`}>
                    {RECORD_ACTION_LABEL[change.action] ?? change.action}
                  </span>
                  <span className="change-main">{change.name}</span>
                  <span className="change-meta mono">{change.code}</span>
                  <span className="change-meta">
                    {change.entity === 'dso' ? 'nätägare' : 'nätområde'}
                  </span>
                  <span className="change-brp">
                    {change.fields.map((f) => (
                      <span key={f.field} className="change-field">
                        {f.field}: {f.from ?? '∅'} <span className="arrow">→</span> {f.to ?? '∅'}
                      </span>
                    ))}
                  </span>
                </div>
              ))}

              {entry.changesTruncated ? (
                <p className="muted change-foot">
                  Listan är kapad till 500 rader per typ. Hela förändringen finns i git-historiken
                  för filerna under <span className="mono">data/</span>.
                </p>
              ) : null}

              {quiet && entry.origin !== 'energi' ? (
                <p className="muted change-foot">
                  Allt hämtades och jämfördes — inget skiljde sig från föregående dygn, så inga
                  datafiler skrevs om.
                </p>
              ) : null}

              {entry.origin === 'energi' ? (
                <p className="muted change-foot">
                  Körningen kommer från energi-systemet, där nätområden och balansansvar hämtades
                  som två separata jobb. Den här raden omfattar bara{' '}
                  {entry.scope?.includes('brp') ? 'balansansvaret' : 'nätområden och nätägare'} —
                  siffror för den andra halvan hör till en annan rad.
                </p>
              ) : null}

              <p className="change-foot">
                <Link href={`/korningar/${entry.id}`}>Teknisk detalj för körningen →</Link>
              </p>
            </div>
          </details>
        );
      })}
    </div>
  );
}
