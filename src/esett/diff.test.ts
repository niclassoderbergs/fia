import { describe, expect, it } from 'vitest';

import { diffFields, diffRecords, type DiffSpec } from './diff';

interface Row {
  code: string;
  name: string;
  zone: string;
  dsoCode: string | null;
}

const row = (code: string, name: string, zone = 'SE3', dsoCode: string | null = '11111'): Row => ({
  code,
  name,
  zone,
  dsoCode,
});

const spec: DiffSpec<Row> = {
  entity: 'grid_area',
  key: (r) => r.code,
  label: (r) => r.name,
  fields: [
    { key: 'name', label: 'namn' },
    { key: 'zone', label: 'prisområde' },
    { key: 'dsoCode', label: 'nätägarkod' },
  ],
};

describe('diffFields', () => {
  it('returnerar bara fält som faktiskt skiljer sig', () => {
    const changes = diffFields(row('A', 'Gammalt'), row('A', 'Nytt'), spec.fields);
    expect(changes).toEqual([{ field: 'namn', from: 'Gammalt', to: 'Nytt' }]);
  });

  it('behandlar null och saknat värde likadant', () => {
    const changes = diffFields(row('A', 'N', 'SE3', null), row('A', 'N', 'SE3', null), spec.fields);
    expect(changes).toEqual([]);
  });

  it('rapporterar övergången mellan null och värde åt båda håll', () => {
    expect(diffFields(row('A', 'N', 'SE3', null), row('A', 'N', 'SE3', '222'), spec.fields)).toEqual([
      { field: 'nätägarkod', from: null, to: '222' },
    ]);
    expect(diffFields(row('A', 'N', 'SE3', '222'), row('A', 'N', 'SE3', null), spec.fields)).toEqual([
      { field: 'nätägarkod', from: '222', to: null },
    ]);
  });
});

describe('diffRecords', () => {
  it('räknar oförändrade poster utan att logga dem', () => {
    const rows = [row('A', 'Alfa'), row('B', 'Beta')];
    const result = diffRecords(rows, rows, spec);

    expect(result.changes).toEqual([]);
    expect(result.counts).toEqual({ added: 0, changed: 0, removed: 0, unchanged: 2 });
  });

  it('skiljer på tillagd, ändrad och borttagen', () => {
    const result = diffRecords(
      [row('A', 'Alfa'), row('B', 'Beta')],
      [row('A', 'Alfa omdöpt'), row('C', 'Gamma')],
      spec,
    );

    expect(result.counts).toEqual({ added: 1, changed: 1, removed: 1, unchanged: 0 });
    expect(result.changes.map((c) => `${c.code}:${c.action}`)).toEqual([
      'A:changed',
      'B:removed',
      'C:added',
    ]);
  });

  it('tar med fältdiffen på ändrade poster men inte på nya', () => {
    const result = diffRecords([row('A', 'Alfa')], [row('A', 'Alfa', 'SE4'), row('B', 'Beta')], spec);

    const changed = result.changes.find((c) => c.code === 'A');
    const added = result.changes.find((c) => c.code === 'B');
    expect(changed?.fields).toEqual([{ field: 'prisområde', from: 'SE3', to: 'SE4' }]);
    expect(added?.fields).toEqual([]);
  });

  it('ignorerar fält som inte står i spec:en', () => {
    // dsoNameAmbiguous-liknande härledda fält ska inte skapa brus i loggen.
    const previous = [{ ...row('A', 'Alfa'), extra: 1 } as Row & { extra: number }];
    const current = [{ ...row('A', 'Alfa'), extra: 2 } as Row & { extra: number }];
    const result = diffRecords(previous, current, spec as DiffSpec<Row & { extra: number }>);

    expect(result.changes).toEqual([]);
  });

  it('ger samma rapport oavsett radordning i indata', () => {
    const previous = [row('A', 'Alfa'), row('B', 'Beta')];
    const current = [row('B', 'Beta ny'), row('A', 'Alfa')];

    const forward = diffRecords(previous, current, spec);
    const reversed = diffRecords([...previous].reverse(), [...current].reverse(), spec);
    expect(reversed).toEqual(forward);
  });
});
