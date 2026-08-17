// Radrenderare för förändringar — delade mellan förändringsflödet på
// startsidan och per-datasetens overlay, så en förändring ser likadan ut var
// den än visas. Rena komponenter utan hooks: fungerar i både server- och
// klientkontext.

import { BRP_ACTION_LABEL, RECORD_ACTION_LABEL } from '@/lib/format';
import type { BrpChange, RecordChange } from '@/lib/types';

/** Kort riktningsetikett — raderna är täta, "Förbrukning" tar för mycket plats. */
export const DIRECTION_SHORT: Record<string, string> = {
  consumption: 'kons',
  production: 'prod',
};

export const BRP_BADGE_CLASS: Record<string, string> = {
  new_retailer: 'badge-ok',
  new_relation: 'badge-neutral',
  brp_switch: 'badge-warn',
  ended: 'badge-danger',
};

export const RECORD_BADGE_CLASS: Record<string, string> = {
  added: 'badge-ok',
  changed: 'badge-warn',
  removed: 'badge-danger',
};

export function RecordChangeRow({ change }: { change: RecordChange }) {
  return (
    <div className="change-row">
      <span className={`badge ${RECORD_BADGE_CLASS[change.action] ?? 'badge-neutral'}`}>
        {RECORD_ACTION_LABEL[change.action] ?? change.action}
      </span>
      <span className="change-main">{change.name}</span>
      <span className="change-meta mono">{change.code}</span>
      <span className="change-brp">
        {change.fields.map((f) => (
          <span key={f.field} className="change-field">
            {f.field}: {f.from ?? '∅'} <span className="arrow">→</span> {f.to ?? '∅'}
          </span>
        ))}
      </span>
    </div>
  );
}

export function BrpChangeRow({ change }: { change: BrpChange }) {
  return (
    <div className="change-row">
      <span className={`badge ${BRP_BADGE_CLASS[change.action] ?? 'badge-neutral'}`}>
        {BRP_ACTION_LABEL[change.action] ?? change.action}
      </span>
      <span className="change-main">{change.retailer}</span>
      <span className="change-meta">{change.biddingZone}</span>
      <span className="change-meta">{DIRECTION_SHORT[change.direction] ?? change.direction}</span>
      <span className="change-brp">
        {change.fromBrp ? <span>{change.fromBrp}</span> : null}
        {change.fromBrp && change.toBrp ? <span className="arrow">→</span> : null}
        {change.toBrp ? <strong>{change.toBrp}</strong> : null}
      </span>
    </div>
  );
}
