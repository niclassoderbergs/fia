// Förändringsdetektion för elhandlare→BRP (eSett EXP04).
//
// Ärvd från energi-systemets esett-brp-diff.ts med samma fyra utfall, men
// utan SCD-2-maskineriet. I DB-versionen behövdes valid_from/valid_to,
// toOpen/toClose och en strikt ordning ("stäng före du öppnar") för att inte
// bryta ett partiellt unikt index. Med filer i git finns inget index att
// bryta och historiken ligger redan i commit-loggen — kvar blir bara den
// rena frågan: vad skiljer dagens snapshot från gårdagens?
//
// Kom ihåg vad datat INTE bär (handover §7): EXP04 saknar både koder och
// datum. Namnet är den enda nyckeln. Ett firmanamnsbyte ser därför ut som
// "ended + new_retailer". Bygg aldrig larm som antar att ended = marknads-
// utträde.

import type { BrpRelation } from './mappers';
import { relationKey } from './mappers';
import { cmp } from './sort';

export type BrpChangeAction = 'new_retailer' | 'new_relation' | 'brp_switch' | 'ended';

export interface BrpChange {
  action: BrpChangeAction;
  biddingZone: string;
  retailer: string;
  direction: string;
  /** Föregående BRP — finns vid brp_switch och ended. */
  fromBrp?: string;
  /** Ny BRP — finns vid new_retailer, new_relation och brp_switch. */
  toBrp?: string;
}

export interface BrpDiffCounts {
  newRetailers: number;
  newRelations: number;
  brpSwitches: number;
  ended: number;
  unchanged: number;
}

export interface BrpDiffResult {
  changes: BrpChange[];
  counts: BrpDiffCounts;
}

/**
 * Diffar gårdagens relationer mot dagens snapshot.
 *
 * new_retailer  — elhandlaren fanns inte alls i föregående snapshot
 * new_relation  — känd elhandlare, nytt prisområde eller ny riktning
 * brp_switch    — samma nyckel, ny balansansvarig
 * ended         — nyckeln finns inte längre i snapshoten
 */
export function diffBrpRelations(
  previous: BrpRelation[],
  current: BrpRelation[],
): BrpDiffResult {
  const prevByKey = new Map(previous.map((r) => [relationKey(r), r]));
  const currByKey = new Map(current.map((r) => [relationKey(r), r]));
  const knownRetailers = new Set(previous.map((r) => r.retailerName));

  const changes: BrpChange[] = [];
  const counts: BrpDiffCounts = {
    newRetailers: 0,
    newRelations: 0,
    brpSwitches: 0,
    ended: 0,
    unchanged: 0,
  };

  for (const row of current) {
    const before = prevByKey.get(relationKey(row));

    if (!before) {
      const base = {
        biddingZone: row.biddingZone,
        retailer: row.retailerName,
        direction: row.direction,
        toBrp: row.brpName,
      };
      if (knownRetailers.has(row.retailerName)) {
        counts.newRelations += 1;
        changes.push({ action: 'new_relation', ...base });
      } else {
        // Första gången namnet ses → ny elhandlare. Markera känd så resten av
        // dess relationer (andra områden/riktningar) räknas som nya RELATIONER.
        knownRetailers.add(row.retailerName);
        counts.newRetailers += 1;
        changes.push({ action: 'new_retailer', ...base });
      }
      continue;
    }

    if (before.brpName !== row.brpName) {
      counts.brpSwitches += 1;
      changes.push({
        action: 'brp_switch',
        biddingZone: row.biddingZone,
        retailer: row.retailerName,
        direction: row.direction,
        fromBrp: before.brpName,
        toBrp: row.brpName,
      });
    } else {
      counts.unchanged += 1;
    }
  }

  for (const row of previous) {
    if (!currByKey.has(relationKey(row))) {
      counts.ended += 1;
      changes.push({
        action: 'ended',
        biddingZone: row.biddingZone,
        retailer: row.retailerName,
        direction: row.direction,
        fromBrp: row.brpName,
      });
    }
  }

  changes.sort(
    (a, b) =>
      cmp(a.biddingZone, b.biddingZone) ||
      cmp(a.retailer, b.retailer) ||
      cmp(a.direction, b.direction) ||
      cmp(a.action, b.action),
  );

  return { changes, counts };
}
