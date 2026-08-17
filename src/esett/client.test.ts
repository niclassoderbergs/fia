import { describe, expect, it } from 'vitest';

import { EsettOpenDataClient } from './client';
import { EsettSchemaError } from './schemas';

/** Ett svar i kön: färdig Response, eller ett fel som fetch ska kasta. */
type Reply = Response | Error;

function json(body: unknown, status = 200, statusText = 'OK'): Response {
  return new Response(JSON.stringify(body), { status, statusText });
}

function makeClient(replies: Reply[], minDelayMs = 0) {
  const sleeps: number[] = [];
  const urls: string[] = [];
  let index = 0;

  const client = new EsettOpenDataClient({
    base: 'https://esett.test',
    minDelayMs,
    backoffMs: [10, 20],
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    fetcher: async (input) => {
      urls.push(String(input));
      const reply = replies[index++];
      if (reply === undefined) throw new Error(`oväntat extra anrop (#${index})`);
      if (reply instanceof Error) throw reply;
      return reply;
    },
  });

  return { client, sleeps, urls, calls: () => index };
}

const dso = { dsoCode: '11111', dsoName: 'Alfa Nät', codingScheme: 'NSE', country: 'SE' };

describe('EsettOpenDataClient — hämtning', () => {
  it('anropar rätt endpoint och returnerar validerade rader', async () => {
    const { client, urls } = makeClient([json([dso])]);
    const rows = await client.fetchSwedishDsos();

    expect(urls).toEqual([
      'https://esett.test/EXP01/DistributionSystemOperators?country=SE',
    ]);
    expect(rows).toEqual([dso]);
  });

  it('filtrerar MGA på country=SE men rapporterar hela svarets storlek', async () => {
    const mga = (mgaCode: string, country: string) => ({
      mgaCode,
      mgaName: `Område ${mgaCode}`,
      mgaType: 'DISTRIBUTION',
      mba: 'SE3',
      dsoName: 'Alfa Nät',
      country,
    });
    const { client } = makeClient([json([mga('SE1', 'SE'), mga('FI1', 'FI'), mga('NO1', 'NO')])]);

    const result = await client.fetchSwedishMgas();
    expect(result.rows.map((r) => r.mgaCode)).toEqual(['SE1']);
    expect(result.totalNordic).toBe(3);
  });

  it('plattar ut MBAOptions till svenska prisområden med EIC-koder', async () => {
    const { client } = makeClient([
      json([
        { countryCode: 'FI', mbas: [{ code: 'FI-EIC', name: 'FI' }] },
        {
          countryCode: 'SE',
          mbas: [
            { code: '10Y1001A1001A44P', name: 'SE1' },
            { code: '10Y1001A1001A46L', name: 'SE3' },
          ],
        },
      ]),
    ]);

    expect(await client.fetchSwedishMbaOptions()).toEqual([
      { code: '10Y1001A1001A44P', name: 'SE1' },
      { code: '10Y1001A1001A46L', name: 'SE3' },
    ]);
  });

  it('hämtar EXP01-registren med serverside SE-filter', async () => {
    const { client, urls } = makeClient([
      json([{ reCode: 'RE1', reName: 'Alfa El', country: 'SE' }]),
      json([{ brpCode: 'B1', brpName: 'Kraft', country: 'SE' }]),
      json([{ bspCode: 'S1', bspName: 'Balans', country: 'SE' }]),
    ]);

    await client.fetchSwedishRetailers();
    await client.fetchSwedishBrpParties();
    await client.fetchSwedishBsps();

    expect(urls).toEqual([
      'https://esett.test/EXP01/Retailers?country=SE',
      'https://esett.test/EXP01/BalanceResponsibleParties?country=SE',
      'https://esett.test/EXP01/BalanceServiceProviders?country=SE',
    ]);
  });

  it('hämtar settlementbanker utan filter — endpointen saknar parametrar', async () => {
    const { client, urls } = makeClient([
      json([{ bic: 'ESSESESS', name: 'SEB', country: 'SE' }]),
    ]);

    const banks = await client.fetchSettlementBanks();
    expect(urls).toEqual(['https://esett.test/EXP06/Banks']);
    expect(banks).toHaveLength(1);
  });

  it('url-kodar EIC-koden i mba-parametern', async () => {
    const { client, urls } = makeClient([json([])]);
    await client.fetchRetailerBalanceResponsibilities('10Y+A/B');

    expect(urls[0]).toContain('mba=10Y%2BA%2FB');
  });
});

describe('EsettOpenDataClient — robusthet', () => {
  it('gör om anropet vid 500 och lyckas på andra försöket', async () => {
    const { client, sleeps, calls } = makeClient([json({}, 500, 'Server Error'), json([dso])]);

    expect(await client.fetchSwedishDsos()).toEqual([dso]);
    expect(calls()).toBe(2);
    expect(sleeps).toEqual([10]);
  });

  it('gör om anropet vid 429', async () => {
    const { client, calls } = makeClient([json({}, 429, 'Too Many Requests'), json([dso])]);

    await client.fetchSwedishDsos();
    expect(calls()).toBe(2);
  });

  it('gör om anropet vid nätverksfel och timeout', async () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    const { client, calls } = makeClient([timeout, json([dso])]);

    await client.fetchSwedishDsos();
    expect(calls()).toBe(2);
  });

  it('gör INTE om anropet vid 404 — permanenta fel ska inte tjata', async () => {
    const { client, calls, sleeps } = makeClient([json({}, 404, 'Not Found')]);

    await expect(client.fetchSwedishDsos()).rejects.toThrow('404 Not Found');
    expect(calls()).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('ger upp efter sista backoff-steget och säger hur många försök som gjordes', async () => {
    const { client, calls, sleeps } = makeClient([
      json({}, 503, 'Unavailable'),
      json({}, 503, 'Unavailable'),
      json({}, 503, 'Unavailable'),
    ]);

    await expect(client.fetchSwedishDsos()).rejects.toThrow('efter 3 försök');
    expect(calls()).toBe(3);
    expect(sleeps).toEqual([10, 20]);
  });

  it('håller minsta paus mellan två anrop', async () => {
    const { client, sleeps } = makeClient([json([dso]), json([dso])], 45_000);

    await client.fetchSwedishDsos();
    await client.fetchSwedishDsos();

    // Första anropet väntar inte; det andra pausar nästan hela intervallet.
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(44_000);
  });

  it('räknar alla HTTP-anrop inklusive omförsök', async () => {
    const { client } = makeClient([json({}, 500, 'Server Error'), json([dso])]);
    await client.fetchSwedishDsos();

    expect(client.requestCount).toBe(2);
  });
});

describe('EsettOpenDataClient — schemadrift', () => {
  it('kastar med alla trasiga rader när eSett byter fältnamn', async () => {
    // Det här är scenariot som utan validering ger tyst massradering:
    // dsoCode → distributionSystemOperatorCode gör varje rad undefined.
    const { client } = makeClient([
      json([
        { distributionSystemOperatorCode: '11111', dsoName: 'Alfa', country: 'SE' },
        { distributionSystemOperatorCode: '22222', dsoName: 'Beta', country: 'SE' },
      ]),
    ]);

    const error = await client.fetchSwedishDsos().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EsettSchemaError);

    const schemaError = error as EsettSchemaError;
    expect(schemaError.invalid).toHaveLength(2);
    expect(schemaError.total).toBe(2);
    expect(schemaError.invalid[0]?.issues.join()).toContain('dsoCode');
  });

  it('kastar när svaret inte är en lista', async () => {
    const { client } = makeClient([json({ error: 'maintenance' })]);

    await expect(client.fetchSwedishDsos()).rejects.toThrow('inte en array');
  });

  it('accepterar tomma listor — spärren mot tomt svar hör hemma i importen', async () => {
    const { client } = makeClient([json([])]);
    expect(await client.fetchSwedishDsos()).toEqual([]);
  });
});
