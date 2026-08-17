import { describe, expect, it } from 'vitest';

import {
  brpRunToReport,
  gridRunToReport,
  mapRecordChange,
  mapTrigger,
  type EnergiBrpRun,
  type EnergiGridRun,
} from './backfill-map';

const brpRow = (over: Partial<EnergiBrpRun> = {}): EnergiBrpRun => ({
  created_at: '2026-08-17T04:30:03.787009+02:00',
  duration_ms: 3790,
  rows_fetched: 145509,
  relations_seen: 1785,
  new_retailers: 0,
  new_relations: 0,
  brp_switches: 0,
  ended: 0,
  triggered_by: 'cron',
  changes: [],
  ...over,
});

const gridRow = (over: Partial<EnergiGridRun> = {}): EnergiGridRun => ({
  created_at: '2026-08-17T04:00:00.16908+02:00',
  duration_ms: 260,
  dso_fetched: 174,
  dso_inserted: 0,
  dso_updated: 0,
  mga_fetched: 278,
  mga_inserted: 0,
  mga_updated: 1,
  mga_linked: 0,
  mga_skipped: 0,
  triggered_by: null,
  changes: [],
  ...over,
});

describe('mapTrigger', () => {
  it('översätter energis ord för manuell körning', () => {
    expect(mapTrigger('admin')).toBe('manual');
    expect(mapTrigger('manual')).toBe('manual');
  });

  it('behåller cron', () => {
    expect(mapTrigger('cron')).toBe('cron');
  });

  it('gissar inte när fältet saknas', () => {
    // Nätområdessidan satte aldrig triggered_by. Att anta "cron" hade varit
    // fel — flera av de körningarna skedde mitt på dagen.
    expect(mapTrigger(null)).toBe('unknown');
    expect(mapTrigger('')).toBe('unknown');
    expect(mapTrigger('något-okänt')).toBe('unknown');
  });
});

describe('mapRecordChange', () => {
  it('översätter actor till dso', () => {
    const result = mapRecordChange({
      entity: 'actor',
      code: '16400',
      name: 'Vattenfall',
      action: 'updated',
      fields: [],
    });
    expect(result?.entity).toBe('dso');
    expect(result?.action).toBe('changed');
  });

  it('städar bort linked-händelser — intern testdata-bokföring, inte eSett-förändringar', () => {
    const result = mapRecordChange({
      entity: 'grid_area',
      code: '—',
      name: '[z06] Område 060124913',
      action: 'linked',
      fields: [{ field: 'DSO-koppling', from: null, to: 'Test-DSO 13000' }],
    });
    expect(result).toBeNull();
  });

  it('översätter inserted till added', () => {
    expect(
      mapRecordChange({ entity: 'grid_area', code: 'X', name: 'X', action: 'inserted', fields: [] })
        ?.action,
    ).toBe('added');
  });
});

describe('brpRunToReport', () => {
  it('ger ett sorterbart id i UTC ur tidsstämpeln', () => {
    // 04:30:03 i Stockholm (+02) är 02:30:03 UTC.
    expect(brpRunToReport(brpRow()).id).toBe('20260817-023003');
  });

  it('märker ut ursprung och att bara balansansvaret omfattades', () => {
    const report = brpRunToReport(brpRow());
    expect(report.origin).toBe('energi');
    expect(report.scope).toEqual(['brp']);
    expect(report.totals).toEqual({ dsos: 0, gridAreas: 0, brpRelations: 1785 });
  });

  it('summerar förändringarna ur räknarna', () => {
    const report = brpRunToReport(
      brpRow({ new_retailers: 3, new_relations: 9, brp_switches: 1, ended: 2 }),
    );
    expect(report.changeCount).toBe(15);
    expect(report.counts.brp).toMatchObject({
      newRetailers: 3,
      newRelations: 9,
      brpSwitches: 1,
      ended: 2,
    });
  });

  it('flaggar kapning när ändringsloggen slog i energis tak på 500', () => {
    const changes = Array.from({ length: 500 }, () => ({
      action: 'new_relation' as const,
      biddingZone: 'SE3',
      retailer: 'X',
      direction: 'consumption',
      toBrp: 'Y',
    }));
    expect(brpRunToReport(brpRow({ changes })).changesTruncated).toBe(true);
    expect(brpRunToReport(brpRow({ changes: changes.slice(0, 12) })).changesTruncated).toBe(false);
  });

  it('döljer utgångsläget: seed-körningen får inga ändringsposter', () => {
    // Första hämtningen loggade varje relation som "ny" — det är ett
    // utgångsläge, ingen förändring.
    const report = brpRunToReport(
      brpRow({
        new_retailers: 237,
        new_relations: 1504,
        changes: [
          {
            action: 'new_retailer',
            biddingZone: 'SE1',
            retailer: 'X',
            direction: 'consumption',
            toBrp: 'Y',
          },
        ],
      }),
      { seed: true },
    );

    expect(report.seeded).toEqual(['brp']);
    expect(report.changeCount).toBe(0);
    expect(report.changes.brp).toEqual([]);
    expect(report.counts.brp).toEqual({
      newRetailers: 0,
      newRelations: 0,
      brpSwitches: 0,
      ended: 0,
      unchanged: 0,
    });
    // Totalen påverkas inte — datat fanns ju.
    expect(report.totals.brpRelations).toBe(1785);
  });

  it('påstår inte att det gjordes några anrop vi kan räkna', () => {
    expect(brpRunToReport(brpRow()).requestCount).toBe(0);
    expect(brpRunToReport(brpRow()).guards).toEqual([]);
  });
});

describe('gridRunToReport', () => {
  it('märker ut att balansansvaret inte omfattades', () => {
    const report = gridRunToReport(gridRow());
    expect(report.scope).toEqual(['dsos', 'gridAreas']);
    expect(report.totals.brpRelations).toBe(0);
  });

  it('lämnar stegtider som null i stället för att hitta på dem', () => {
    // Bara körningens totaltid loggades i energi.
    const report = gridRunToReport(gridRow());
    expect(report.steps.map((s) => s.durationMs)).toEqual([null, null]);
    expect(report.durationMs).toBe(260);
  });

  it('räknar inte länkningar som förändringar', () => {
    const report = gridRunToReport(
      gridRow({
        mga_updated: 2,
        mga_linked: 13,
        changes: [
          { entity: 'grid_area', code: 'A', name: 'A', action: 'updated', fields: [] },
          { entity: 'grid_area', code: 'B', name: 'B', action: 'updated', fields: [] },
          { entity: 'grid_area', code: '—', name: '[z06] Test', action: 'linked', fields: [] },
        ],
      }),
    );
    expect(report.counts.gridAreas.changed).toBe(2);
    expect(report.counts.gridAreas.unchanged).toBe(278 - 2);
    expect(report.changeCount).toBe(2);
    expect(report.changes.records.map((c) => c.action)).toEqual(['changed', 'changed']);
  });

  it('ger unknown som trigger när energi inte satte fältet', () => {
    expect(gridRunToReport(gridRow()).triggeredBy).toBe('unknown');
  });
});
