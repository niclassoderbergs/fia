'use client';

import { useRef } from 'react';

import { BrpChangeRow, RecordChangeRow } from '@/components/ChangeRows';
import type { DatasetChangeEntry } from '@/lib/data';
import { formatDateTime, plural } from '@/lib/format';

/**
 * "Visa förändringar"-knappen på en dataset-sida, med historiken i en modal.
 *
 * Native <dialog> ger modalbeteende gratis (ESC, fokusfälla, ::backdrop) —
 * enda klientlogiken är open/close. Historiken kommer förfiltrerad från
 * servern via getDatasetChangeHistory, så overlayn visar bara det som berör
 * vyn man står i.
 */
export default function DatasetChangesOverlay({
  title,
  exp,
  entries,
}: {
  title: string;
  exp: string;
  entries: DatasetChangeEntry[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const total = entries.reduce((sum, e) => sum + e.records.length + e.brp.length, 0);

  return (
    <>
      <button type="button" onClick={() => dialogRef.current?.showModal()}>
        Visa förändringar{total > 0 ? ` (${total})` : ''}
      </button>

      <dialog
        ref={dialogRef}
        className="changes-dialog"
        aria-label={`Förändringar — ${title}`}
        onClick={(e) => {
          // Klick på backdropen (= själva dialog-elementet, inte innehållet) stänger.
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <div className="dialog-head">
          <span className="dialog-title">
            Förändringar — {title} <span className="exp-tag">{exp}</span>
          </span>
          <button
            type="button"
            className="dialog-close"
            aria-label="Stäng"
            onClick={() => dialogRef.current?.close()}
          >
            ×
          </button>
        </div>

        <div className="dialog-body">
          {entries.length === 0 ? (
            <p className="empty">
              Inga förändringar har loggats för den här vyn ännu. Varje natt jämförs innehållet mot
              föregående körning — dyker något upp hamnar det här.
            </p>
          ) : (
            entries.map((entry) => (
              <section key={entry.runId} className="dialog-run">
                <div className="dialog-run-head">
                  <span className="feed-date">{formatDateTime(entry.startedAt)}</span>
                  <span className="badge badge-neutral">
                    {plural(entry.records.length + entry.brp.length, 'förändring', 'förändringar')}
                  </span>
                  {entry.origin === 'energi' ? (
                    <span
                      className="badge badge-neutral"
                      title="Inläst historik från energi-systemet"
                    >
                      energi
                    </span>
                  ) : null}
                  <a className="dialog-run-link" href={`/korningar/${entry.runId}`}>
                    körningen →
                  </a>
                </div>
                {entry.brp.map((change, i) => (
                  <BrpChangeRow
                    key={`${change.biddingZone}-${change.retailer}-${change.direction}-${i}`}
                    change={change}
                  />
                ))}
                {entry.records.map((change, i) => (
                  <RecordChangeRow key={`${change.code}-${i}`} change={change} />
                ))}
                {entry.changesTruncated ? (
                  <p className="muted change-foot">
                    Körningens ändringslista är kapad till 500 rader — hela förändringen finns i
                    git-historiken för <span className="mono">data/</span>.
                  </p>
                ) : null}
              </section>
            ))
          )}
        </div>
      </dialog>
    </>
  );
}
