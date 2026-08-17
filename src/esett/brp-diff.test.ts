import { describe, expect, it } from 'vitest';

import { diffBrpRelations } from './brp-diff';
import type { BrpRelation } from './mappers';

const rel = (
  biddingZone: string,
  retailerName: string,
  brpName: string,
  direction: 'consumption' | 'production' = 'consumption',
): BrpRelation => ({
  biddingZone: biddingZone as BrpRelation['biddingZone'],
  retailerName,
  direction,
  brpName,
  mgaNames: [],
  conflicts: [],
});

describe('diffBrpRelations', () => {
  it('rapporterar ingen förändring när snapshoten är identisk', () => {
    const snapshot = [rel('SE3', 'Alfa El', 'BRP Nord')];
    const result = diffBrpRelations(snapshot, snapshot);

    expect(result.changes).toEqual([]);
    expect(result.counts.unchanged).toBe(1);
  });

  it('kallar första förekomsten av ett elhandlarnamn för new_retailer', () => {
    const result = diffBrpRelations([], [rel('SE3', 'Alfa El', 'BRP Nord')]);

    expect(result.changes).toEqual([
      {
        action: 'new_retailer',
        biddingZone: 'SE3',
        retailer: 'Alfa El',
        direction: 'consumption',
        toBrp: 'BRP Nord',
      },
    ]);
    expect(result.counts).toMatchObject({ newRetailers: 1, newRelations: 0 });
  });

  it('räknar elhandlarens övriga områden som nya relationer, inte nya elhandlare', () => {
    const result = diffBrpRelations(
      [],
      [rel('SE1', 'Alfa El', 'BRP Nord'), rel('SE3', 'Alfa El', 'BRP Nord')],
    );

    expect(result.counts).toMatchObject({ newRetailers: 1, newRelations: 1 });
  });

  it('upptäcker BRP-byte på samma nyckel', () => {
    const result = diffBrpRelations(
      [rel('SE3', 'Alfa El', 'BRP Nord')],
      [rel('SE3', 'Alfa El', 'BRP Syd')],
    );

    expect(result.changes).toEqual([
      {
        action: 'brp_switch',
        biddingZone: 'SE3',
        retailer: 'Alfa El',
        direction: 'consumption',
        fromBrp: 'BRP Nord',
        toBrp: 'BRP Syd',
      },
    ]);
    expect(result.counts.brpSwitches).toBe(1);
  });

  it('markerar försvunna nycklar som ended', () => {
    const result = diffBrpRelations([rel('SE3', 'Alfa El', 'BRP Nord')], []);

    expect(result.changes).toEqual([
      {
        action: 'ended',
        biddingZone: 'SE3',
        retailer: 'Alfa El',
        direction: 'consumption',
        fromBrp: 'BRP Nord',
      },
    ]);
    expect(result.counts.ended).toBe(1);
  });

  it('ser ett firmanamnsbyte som ended + new_retailer', () => {
    // EXP04 saknar både koder och datum — namnet är enda nyckeln. Det här är
    // en känd begränsning, inte en bugg: larm får aldrig tolka ended som
    // marknadsutträde (handover §7).
    const result = diffBrpRelations(
      [rel('SE3', 'Gamla Namnet AB', 'BRP Nord')],
      [rel('SE3', 'Nya Namnet AB', 'BRP Nord')],
    );

    expect(result.changes.map((c) => c.action).sort()).toEqual(['ended', 'new_retailer']);
  });

  it('ger samma resultat oavsett radordning i indata', () => {
    const previous = [rel('SE1', 'Alfa El', 'BRP Nord'), rel('SE3', 'Beta El', 'BRP Syd')];
    const current = [rel('SE3', 'Beta El', 'BRP Nord'), rel('SE1', 'Alfa El', 'BRP Nord')];

    const forward = diffBrpRelations(previous, current);
    const reversed = diffBrpRelations([...previous].reverse(), [...current].reverse());

    expect(reversed).toEqual(forward);
  });
});
