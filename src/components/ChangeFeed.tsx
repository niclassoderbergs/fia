import Link from 'next/link';

import { BrpChangeRow, RecordChangeRow } from '@/components/ChangeRows';
import { DATASETS, RBR } from '@/lib/datasets';
import { formatDateTime, formatDuration, plural } from '@/lib/format';
import type { FeedEntry, RecordChange, RunScope } from '@/lib/types';

/**
 * Sammanfattningsraden speglar eSett-strukturen: ett segment per dataset som
 * hade förändringar, med eSetts korta namn som prefix. Inom RBR-segmentet
 * redovisas byten och upphörda även när de är noll — de två är de enda
 * utfallen som kan betyda att balansansvar faktiskt flyttat, och "0 byten"
 * svart på vitt är ett annat besked än att siffran inte nämns.
 */
function summaryLine(entry: FeedEntry): string {
  if (entry.status !== 'success') {
    return entry.error ?? 'körningen gick inte igenom';
  }

  const scope = entry.scope ?? null;
  const covers = (part: RunScope) => scope === null || scope.includes(part);

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

  const segments: string[] = [];
  const recordsByEntity = new Map<string, RecordChange[]>();
  for (const change of entry.changes.records) {
    const list = recordsByEntity.get(change.entity);
    if (list) list.push(change);
    else recordsByEntity.set(change.entity, [change]);
  }

  for (const dataset of DATASETS) {
    if (dataset.slug === 'rbr') {
      const { brp } = entry.counts;
      const total = brp.newRetailers + brp.newRelations + brp.brpSwitches + brp.ended;
      if (total === 0) continue;
      const parts: string[] = [];
      if (brp.newRetailers > 0) {
        parts.push(plural(brp.newRetailers, 'ny elhandlare', 'nya elhandlare'));
      }
      if (brp.newRelations > 0) {
        parts.push(plural(brp.newRelations, 'ny relation', 'nya relationer'));
      }
      parts.push(plural(brp.brpSwitches, 'byte', 'byten'));
      parts.push(plural(brp.ended, 'upphörd', 'upphörda'));
      segments.push(`${dataset.short}: ${parts.join(', ')}`);
      continue;
    }

    const records = dataset.entity ? recordsByEntity.get(dataset.entity) : undefined;
    if (!records || records.length === 0) continue;
    const added = records.filter((c) => c.action === 'added').length;
    const changed = records.filter((c) => c.action === 'changed').length;
    const removed = records.filter((c) => c.action === 'removed').length;
    const parts: string[] = [];
    if (added > 0) parts.push(plural(added, 'ny', 'nya'));
    if (changed > 0) parts.push(plural(changed, 'ändrad', 'ändrade'));
    if (removed > 0) parts.push(plural(removed, 'borttagen', 'borttagna'));
    segments.push(`${dataset.short}: ${parts.join(', ')}`);
  }

  return segments.join(' · ');
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
        const recordsByEntity = new Map<string, RecordChange[]>();
        for (const change of entry.changes.records) {
          const list = recordsByEntity.get(change.entity);
          if (list) list.push(change);
          else recordsByEntity.set(change.entity, [change]);
        }

        return (
          <details key={entry.id} className="feed-item" data-quiet={quiet ? 'true' : 'false'}>
            <summary className="feed-summary">
              <span className="feed-date">{formatDateTime(entry.startedAt)}</span>
              <span className={`badge ${badgeClass(entry)}`}>{badgeLabel(entry)}</span>
              <span className="feed-note">{summaryLine(entry)}</span>
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

              {/* Grupperna följer eSetts meny — samma ordning och rubriker som
                  på deras open data-sida, med EXP-taggen bredvid. */}
              {DATASETS.map((dataset) => {
                if (dataset.slug === 'rbr') {
                  if (entry.changes.brp.length === 0) return null;
                  return (
                    <div key={dataset.slug}>
                      <div className="change-group">
                        {RBR.title} <span className="exp-tag">{RBR.exp}</span>
                      </div>
                      {entry.changes.brp.map((change, i) => (
                        <BrpChangeRow
                          key={`${change.biddingZone}-${change.retailer}-${change.direction}-${i}`}
                          change={change}
                        />
                      ))}
                    </div>
                  );
                }

                const records = dataset.entity ? recordsByEntity.get(dataset.entity) : undefined;
                if (!records || records.length === 0) return null;
                return (
                  <div key={dataset.slug}>
                    <div className="change-group">
                      {dataset.title} <span className="exp-tag">{dataset.exp}</span>
                    </div>
                    {records.map((change, i) => (
                      <RecordChangeRow
                        key={`${change.entity}-${change.code}-${i}`}
                        change={change}
                      />
                    ))}
                  </div>
                );
              })}

              {entry.changesTruncated ? (
                <p className="muted change-foot">
                  Listan är kapad till 500 rader per typ. Hela förändringen finns i git-historiken
                  för filerna under <span className="mono">data/</span>.
                </p>
              ) : null}

              {quiet && !entry.scope ? (
                <p className="muted change-foot">
                  Allt hämtades och jämfördes — inget skiljde sig från föregående dygn, så inga
                  datafiler skrevs om.
                </p>
              ) : null}

              {entry.scope ? (
                <p className="muted change-foot">
                  Äldre körning som bara omfattade{' '}
                  {entry.scope.includes('brp') ? 'balansansvaret' : 'nätområden och nätägare'} —
                  nätområden och balansansvar hämtades då i separata körningar.
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
