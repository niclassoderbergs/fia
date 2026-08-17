import { describe, expect, it } from 'vitest';

import { allPassed, failureSummary, guardAllZones, guardNonEmpty, guardShrink } from './guards';

describe('guardNonEmpty', () => {
  it('släpper igenom ett svar med poster', () => {
    expect(guardNonEmpty('Nätområden', 278).ok).toBe(true);
  });

  it('fäller ett tomt svar — det är ett partiellt fel, inte en tömning', () => {
    const result = guardNonEmpty('Balansansvar', 0);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('partiellt fel');
  });
});

describe('guardAllZones', () => {
  it('kräver alla fyra prisområden', () => {
    expect(guardAllZones(['SE1', 'SE2', 'SE3', 'SE4']).ok).toBe(true);
  });

  it('fäller när ett prisområde saknas och pekar ut vilket', () => {
    // Utan den här spärren skulle varje relation i SE2 se ut att ha upphört.
    const result = guardAllZones(['SE1', 'SE3', 'SE4']);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('SE2');
  });

  it('bryr sig inte om ordningen', () => {
    expect(guardAllZones(['SE4', 'SE2', 'SE1', 'SE3']).ok).toBe(true);
  });
});

describe('guardShrink', () => {
  it('släpper igenom första körningen när det inte finns något att jämföra med', () => {
    expect(guardShrink('Nätområden', 0, 0, 0.1).ok).toBe(true);
  });

  it('släpper igenom när inget försvunnit', () => {
    expect(guardShrink('Nätområden', 278, 0, 0.1).ok).toBe(true);
  });

  it('släpper igenom en minskning inom gränsen', () => {
    const result = guardShrink('Nätområden', 100, 10, 0.1);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('10,0 %');
  });

  it('fäller en minskning över gränsen', () => {
    const result = guardShrink('Balansansvar', 1785, 900, 0.1);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('900 av 1785');
  });

  it('mäter försvunna poster, inte nettoförändring', () => {
    // 50 borttagna och 50 tillagda ger noll netto men är fortfarande 50 som
    // försvann — det ska fällas vid 10 % gräns på 100 poster.
    expect(guardShrink('Nätägare', 100, 50, 0.1).ok).toBe(false);
  });
});

describe('sammanvägning', () => {
  it('kräver att samtliga spärrar passerat', () => {
    expect(allPassed([guardNonEmpty('A', 1), guardAllZones(['SE1', 'SE2', 'SE3', 'SE4'])])).toBe(true);
    expect(allPassed([guardNonEmpty('A', 1), guardNonEmpty('B', 0)])).toBe(false);
  });

  it('sammanfattar bara de spärrar som fällde', () => {
    const summary = failureSummary([
      guardNonEmpty('Nätområden', 278),
      guardNonEmpty('Balansansvar', 0),
    ]);

    expect(summary).toContain('Balansansvar');
    expect(summary).not.toContain('Nätområden');
  });
});
