// Tabellrenderare för förändringar — delade mellan startsidans flöde,
// dataset-overlayerna och körningsdetaljsidan, så en förändring ser likadan
// ut var den än visas och kolumnerna alltid bär sina rubriker. Utan rubriker
// blev vyn tvetydig: en elhandlare som är sin egen BRP visar samma namn i
// båda kolumnerna. Rena komponenter utan hooks: fungerar i både server- och
// klientkontext.

import {
  BRP_ACTION_LABEL,
  DIRECTION_LABEL,
  ENTITY_LABEL,
  RECORD_ACTION_LABEL,
} from '@/lib/format';
import type { BrpChange, RecordChange } from '@/lib/types';

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

/** Balansansvarsförändringar (RBR) med kolumnrubriker. */
export function BrpChangeTable({ changes }: { changes: BrpChange[] }) {
  if (changes.length === 0) return null;
  return (
    <div className="table-wrap change-table">
      <table>
        <thead>
          <tr>
            <th>Händelse</th>
            <th>Elhandlare</th>
            <th>Prisområde</th>
            <th>Riktning</th>
            <th>Balansansvarig</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((change, i) => (
            <tr key={`${change.biddingZone}-${change.retailer}-${change.direction}-${i}`}>
              <td>
                <span className={`badge ${BRP_BADGE_CLASS[change.action] ?? 'badge-neutral'}`}>
                  {BRP_ACTION_LABEL[change.action] ?? change.action}
                </span>
              </td>
              <td>{change.retailer}</td>
              <td>{change.biddingZone}</td>
              <td className="muted">{DIRECTION_LABEL[change.direction] ?? change.direction}</td>
              <td>
                {change.fromBrp ? <span>{change.fromBrp}</span> : null}
                {change.fromBrp && change.toBrp ? <span className="arrow">→</span> : null}
                {change.toBrp ? <strong>{change.toBrp}</strong> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Registerförändringar (nätägare, nätområden, elhandlare …) med kolumnrubriker. */
export function RecordChangeTable({
  changes,
  showEntity = false,
}: {
  changes: RecordChange[];
  /** Visa typ-kolumn — behövs bara där flera dataset blandas (körningsdetaljen). */
  showEntity?: boolean;
}) {
  if (changes.length === 0) return null;
  return (
    <div className="table-wrap change-table">
      <table>
        <thead>
          <tr>
            <th>Händelse</th>
            {showEntity ? <th>Typ</th> : null}
            <th>Namn</th>
            <th>Kod</th>
            <th>Ändrade fält</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((change, i) => (
            <tr key={`${change.entity}-${change.code}-${i}`}>
              <td>
                <span className={`badge ${RECORD_BADGE_CLASS[change.action] ?? 'badge-neutral'}`}>
                  {RECORD_ACTION_LABEL[change.action] ?? change.action}
                </span>
              </td>
              {showEntity ? (
                <td className="muted">{ENTITY_LABEL[change.entity] ?? change.entity}</td>
              ) : null}
              <td>{change.name}</td>
              <td className="mono">{change.code}</td>
              <td className="muted">
                {change.fields.length === 0
                  ? '—'
                  : change.fields.map((f) => (
                      <div key={f.field}>
                        {f.field}: {f.from ?? '∅'} <span className="arrow">→</span> {f.to ?? '∅'}
                      </div>
                    ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
