import { describe, expect, it } from 'vitest';

import {
  mapBanks,
  mapBrpParties,
  mapBrpRelations,
  mapBsps,
  mapDsos,
  mapGridAreas,
  mapRetailers,
  normalizeDirection,
  type ZoneBatch,
} from './mappers';
import type { EsettDsoRow, EsettMgaRow } from './schemas';

const dso = (dsoCode: string, dsoName: string): EsettDsoRow => ({
  dsoCode,
  dsoName,
  codingScheme: 'NSE',
  country: 'SE',
});

const mga = (mgaCode: string, mba: string, dsoName: string, mgaName = `Område ${mgaCode}`): EsettMgaRow => ({
  mgaCode,
  mgaName,
  mgaType: 'DISTRIBUTION',
  mba,
  dsoName,
  country: 'SE',
});

describe('mapDsos', () => {
  it('sorterar på dsoCode oavsett inkommande ordning', () => {
    const a = mapDsos([dso('55555', 'Zeta Nät'), dso('11111', 'Alfa Nät')]);
    const b = mapDsos([dso('11111', 'Alfa Nät'), dso('55555', 'Zeta Nät')]);

    expect(a.records.map((r) => r.dsoCode)).toEqual(['11111', '55555']);
    expect(a).toEqual(b);
  });

  it('skippar dubbletter och tomma koder med angivet skäl', () => {
    const result = mapDsos([dso('11111', 'Alfa'), dso('11111', 'Alfa igen'), dso('', 'Utan kod')]);

    expect(result.records).toHaveLength(1);
    expect(result.skipped).toEqual([
      { code: '11111', reason: 'dubblett på dsoCode' },
      { code: '<saknas>', reason: 'tom dsoCode' },
    ]);
  });

  it('faller tillbaka på NSE när codingScheme saknas', () => {
    const result = mapDsos([{ dsoCode: '11111', dsoName: 'Alfa', country: 'SE' }]);
    expect(result.records[0]?.codingScheme).toBe('NSE');
  });
});

describe('mapGridAreas', () => {
  const dsos = mapDsos([dso('11111', 'Alfa Nät'), dso('22222', 'Beta Nät')]).records;

  it('länkar nätägare via namn och härleder prisområde från mba', () => {
    const result = mapGridAreas([mga('SE001', 'SE3', 'Alfa Nät')], dsos);

    expect(result.records[0]).toMatchObject({
      mgaCode: 'SE001',
      biddingZone: 'SE3',
      dsoName: 'Alfa Nät',
      dsoCode: '11111',
      dsoNameAmbiguous: false,
    });
  });

  it('matchar namn oberoende av skiftläge och extra blanksteg', () => {
    const result = mapGridAreas([mga('SE001', 'SE3', '  alfa   nät ')], dsos);
    expect(result.records[0]?.dsoCode).toBe('11111');
  });

  it('väljer lägsta dsoCode deterministiskt när namnet är tvetydigt', () => {
    const ambiguous = mapDsos([dso('99999', 'Delad Nät'), dso('33333', 'Delad Nät')]).records;
    const first = mapGridAreas([mga('SE001', 'SE3', 'Delad Nät')], ambiguous);
    const second = mapGridAreas([mga('SE001', 'SE3', 'Delad Nät')], [...ambiguous].reverse());

    expect(first.records[0]?.dsoCode).toBe('33333');
    expect(first.records[0]?.dsoNameAmbiguous).toBe(true);
    // Samma svar oavsett radordning — annars pendlar länken mellan körningar.
    expect(second.records[0]).toEqual(first.records[0]);
  });

  it('lämnar dsoCode som null när nätägaren inte finns i registret', () => {
    const result = mapGridAreas([mga('SE001', 'SE3', 'Okänd Nät')], dsos);
    expect(result.records[0]?.dsoCode).toBeNull();
    expect(result.records[0]?.dsoNameAmbiguous).toBe(false);
  });

  it('skippar okända prisområden i stället för att gissa', () => {
    const result = mapGridAreas([mga('SE001', 'FI', 'Alfa Nät'), mga('SE002', 'SE1', 'Alfa Nät')], dsos);

    expect(result.records.map((r) => r.mgaCode)).toEqual(['SE002']);
    expect(result.skipped).toEqual([
      { code: 'SE001', reason: 'okänt prisområde "FI" (förväntat SE1–SE4)' },
    ]);
  });
});

describe('registermappning (EXP01/EXP06)', () => {
  it('sorterar elhandlare på reCode och skippar dubbletter', () => {
    const result = mapRetailers([
      { reCode: 'RE2', reName: 'Beta El', codingScheme: 'NSE', country: 'SE' },
      { reCode: 'RE1', reName: 'Alfa El', codingScheme: 'NSE', country: 'SE' },
      { reCode: 'RE1', reName: 'Alfa El igen', codingScheme: 'NSE', country: 'SE' },
    ]);

    expect(result.records.map((r) => r.reCode)).toEqual(['RE1', 'RE2']);
    expect(result.skipped).toEqual([{ code: 'RE1', reason: 'dubblett på kod' }]);
  });

  it('behåller BRP-registrets giltighetsdatum och normaliserar tomt till null', () => {
    const result = mapBrpParties([
      {
        brpCode: 'BRP1',
        brpName: 'Kraft AB',
        businessId: '556677-8899',
        codingScheme: 'NSE',
        country: 'SE',
        validityStart: '2020-01-01T00:00:00',
        validityEnd: '',
      },
    ]);

    expect(result.records[0]).toMatchObject({
      brpCode: 'BRP1',
      businessId: '556677-8899',
      validityStart: '2020-01-01T00:00:00',
      validityEnd: null,
    });
  });

  it('mappar BSP med organisationsnummer', () => {
    const result = mapBsps([
      { bspCode: 'BSP1', bspName: 'Balans AB', businessId: '11', codingScheme: null, country: 'SE' },
    ]);
    expect(result.records[0]).toMatchObject({ bspCode: 'BSP1', codingScheme: null });
  });

  it('nycklar banker på BIC och sorterar deterministiskt', () => {
    const rows = [
      { bic: 'NDEAFIHH', name: 'Nordea', country: 'FI' },
      { bic: 'ESSESESS', name: 'SEB', country: 'SE' },
    ];
    const forward = mapBanks(rows);
    const reversed = mapBanks([...rows].reverse());

    expect(forward.records.map((r) => r.bic)).toEqual(['ESSESESS', 'NDEAFIHH']);
    expect(reversed).toEqual(forward);
  });
});

describe('normalizeDirection', () => {
  it('accepterar båda riktningarna oavsett skiftläge', () => {
    expect(normalizeDirection('Consumption')).toBe('consumption');
    expect(normalizeDirection('PRODUCTION')).toBe('production');
  });

  it('avvisar okända värden i stället för att falla tillbaka på consumption', () => {
    // Ursprungssystemet lät allt som inte var exakt "production" bli
    // consumption — en tyst fallback som döljer schemadrift (handover §7).
    expect(normalizeDirection('Förbrukning')).toBeNull();
    expect(normalizeDirection('')).toBeNull();
  });
});

describe('mapBrpRelations', () => {
  const batch = (biddingZone: string, rows: Array<[string, string, string, string]>): ZoneBatch => ({
    biddingZone: biddingZone as ZoneBatch['biddingZone'],
    rows: rows.map(([reName, brpName, mgaName, energyDirectionType]) => ({
      reName,
      brpName,
      mgaName,
      energyDirectionType,
    })),
  });

  it('deduppar samma relation över flera nätområden och samlar områdesnamnen', () => {
    const result = mapBrpRelations([
      batch('SE3', [
        ['Elhandlare AB', 'BRP Nord', 'Område A', 'Consumption'],
        ['Elhandlare AB', 'BRP Nord', 'Område B', 'Consumption'],
      ]),
    ]);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      biddingZone: 'SE3',
      retailerName: 'Elhandlare AB',
      direction: 'consumption',
      brpName: 'BRP Nord',
      mgaNames: ['Område A', 'Område B'],
      conflicts: [],
    });
  });

  it('behåller alla BRP vid konflikt i stället för att låta sista raden vinna', () => {
    const rows: Array<[string, string, string, string]> = [
      ['Elhandlare AB', 'BRP Syd', 'Område B', 'Consumption'],
      ['Elhandlare AB', 'BRP Nord', 'Område A', 'Consumption'],
    ];
    const forward = mapBrpRelations([batch('SE3', rows)]);
    const reversed = mapBrpRelations([batch('SE3', [...rows].reverse())]);

    expect(forward.records[0]).toMatchObject({
      brpName: 'BRP Nord',
      mgaNames: ['Område A'],
      conflicts: [{ brpName: 'BRP Syd', mgaNames: ['Område B'] }],
    });
    // eSetts radordning är inte deterministisk — vårt utfall måste vara det.
    expect(reversed.records).toEqual(forward.records);
  });

  it('skiljer på riktning inom samma elhandlare och prisområde', () => {
    const result = mapBrpRelations([
      batch('SE3', [
        ['Elhandlare AB', 'BRP Nord', 'Område A', 'Consumption'],
        ['Elhandlare AB', 'BRP Prod', 'Område A', 'Production'],
      ]),
    ]);

    expect(result.records.map((r) => `${r.direction}:${r.brpName}`)).toEqual([
      'consumption:BRP Nord',
      'production:BRP Prod',
    ]);
  });

  it('skippar rader med okänd riktning eller tomma namn', () => {
    const result = mapBrpRelations([
      batch('SE3', [
        ['Elhandlare AB', 'BRP Nord', 'Område A', 'Nonsens'],
        ['', 'BRP Nord', 'Område A', 'Consumption'],
      ]),
    ]);

    expect(result.records).toEqual([]);
    expect(result.skipped).toEqual([
      { code: 'SE3/<saknas>', reason: 'tom reName eller brpName' },
      { code: 'SE3/Elhandlare AB', reason: 'okänd energyDirectionType "Nonsens"' },
    ]);
  });

  it('sorterar på prisområde, elhandlare och riktning', () => {
    const result = mapBrpRelations([
      batch('SE4', [['Beta', 'BRP', 'Om', 'Consumption']]),
      batch('SE1', [['Alfa', 'BRP', 'Om', 'Production']]),
      batch('SE1', [['Alfa', 'BRP', 'Om', 'Consumption']]),
    ]);

    expect(result.records.map((r) => `${r.biddingZone}/${r.retailerName}/${r.direction}`)).toEqual([
      'SE1/Alfa/consumption',
      'SE1/Alfa/production',
      'SE4/Beta/consumption',
    ]);
  });
});
