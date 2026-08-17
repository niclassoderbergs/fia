// HTTP-klient mot eSett open data.
//
// Ärvd från energi-systemets esett-open-data.client.ts men härdad på de tre
// punkter handovern pekar ut som svagheter (§7): ingen retry, ingen
// backoff, ingen schemavalidering. Dessutom pacing mellan anrop — vi äger
// ingen SLA mot eSett och vill aldrig se ett 429 därifrån.
//
// API:t är publikt och kräver ingen autentisering: inga nycklar, inga
// hemligheter att rotera. Enbart läsning; vi skriver aldrig mot eSett.
// Spec: https://api.opendata.esett.com/openapi?format=json

import {
  esettDsoRowSchema,
  esettMbaOptionsResponseSchema,
  esettMgaRowSchema,
  esettRetailerBalanceRowSchema,
  parseRows,
  type EsettDsoRow,
  type EsettMbaOption,
  type EsettMgaRow,
  type EsettRetailerBalanceRow,
} from './schemas';

const DEFAULT_BASE = 'https://api.opendata.esett.com';
const DEFAULT_TIMEOUT_MS = 30_000;
/** 1 min → 4 min → 16 min. Räcker för underhållsfönster utan att pinga i onödan. */
const DEFAULT_BACKOFF_MS = [60_000, 240_000, 960_000];
const USER_AGENT = 'fia-esett-import/1.0 (+https://github.com/niclassoderbergs/fia)';

/** Status som är värda ett nytt försök — resten är permanenta fel. */
function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export interface EsettClientOptions {
  base?: string;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Minsta tid mellan två anrop. 0 i tester. */
  minDelayMs?: number;
  /** Ett steg per omförsök; tom array = ingen retry. */
  backoffMs?: number[];
  timeoutMs?: number;
  log?: (message: string) => void;
}

export interface MgaFetchResult {
  /** Svenska MGA efter filtrering. */
  rows: EsettMgaRow[];
  /** Totalt antal rader eSett returnerade (alla nordiska länder). */
  totalNordic: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class EsettOpenDataClient {
  private readonly base: string;
  private readonly fetcher: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly minDelayMs: number;
  private readonly backoffMs: number[];
  private readonly timeoutMs: number;
  private readonly log: (message: string) => void;

  /** Tidpunkt för föregående anrop — driver pacing. */
  private lastRequestAt = 0;
  /** Antal HTTP-anrop klienten gjort, inklusive omförsök. Rapporteras i körningen. */
  requestCount = 0;

  constructor(options: EsettClientOptions = {}) {
    this.base = options.base ?? DEFAULT_BASE;
    this.fetcher = options.fetcher ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.minDelayMs = options.minDelayMs ?? 0;
    this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.log = options.log ?? (() => {});
  }

  /** EXP01 — svenska nätägare. Serverside-filter på country. */
  async fetchSwedishDsos(): Promise<EsettDsoRow[]> {
    const endpoint = '/EXP01/DistributionSystemOperators?country=SE';
    const body = await this.fetchJson(endpoint);
    return parseRows(endpoint, esettDsoRowSchema, body);
  }

  /**
   * EXP03 — nätområden av typen DISTRIBUTION. Endpointen saknar
   * country-param, så alla nordiska MGA hämtas och SE filtreras här.
   */
  async fetchSwedishMgas(): Promise<MgaFetchResult> {
    const endpoint = '/EXP03/MeteringGridAreas?mgaType=DISTRIBUTION';
    const body = await this.fetchJson(endpoint);
    const all = parseRows(endpoint, esettMgaRowSchema, body);
    return { rows: all.filter((m) => m.country === 'SE'), totalNordic: all.length };
  }

  /**
   * EXP04 — EIC-koder per svenskt prisområde (SE1–SE4). Koderna matas sedan
   * in i mba-param på fetchRetailerBalanceResponsibilities.
   */
  async fetchSwedishMbaOptions(): Promise<EsettMbaOption[]> {
    const endpoint = '/EXP04/MBAOptions';
    const body = await this.fetchJson(endpoint);
    const countries = parseRows(endpoint, esettMbaOptionsResponseSchema, body);
    return countries
      .filter((c) => c.countryCode === 'SE')
      .flatMap((c) => c.mbas.map((m) => ({ code: m.code, name: m.name })));
  }

  /**
   * EXP04 — elhandlare→BRP för ETT prisområde. eSett kräver mba-param.
   * Endpointen stödjer flera mba i samma anrop, men vi tar ett i taget:
   * fyra små anrop är snällare mot källan än ett stort, och ett partiellt
   * fel blir synligt per område i stället för att dölja sig i en klump.
   */
  async fetchRetailerBalanceResponsibilities(
    mbaEic: string,
  ): Promise<EsettRetailerBalanceRow[]> {
    const endpoint = `/EXP04/RetailerBalanceResponsibility?mba=${encodeURIComponent(mbaEic)}`;
    const body = await this.fetchJson(endpoint);
    return parseRows(endpoint, esettRetailerBalanceRowSchema, body);
  }

  /** Håller minsta avstånd till föregående anrop. */
  private async pace(): Promise<void> {
    if (this.minDelayMs <= 0 || this.lastRequestAt === 0) return;
    const waited = Date.now() - this.lastRequestAt;
    if (waited < this.minDelayMs) await this.sleep(this.minDelayMs - waited);
  }

  private async fetchJson(endpoint: string): Promise<unknown> {
    const url = `${this.base}${endpoint}`;
    const maxAttempts = this.backoffMs.length + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await this.pace();
      this.lastRequestAt = Date.now();
      this.requestCount += 1;

      const label = attempt === 0 ? '' : ` (försök ${attempt + 1}/${maxAttempts})`;
      this.log(`eSett GET ${endpoint}${label}`);

      let failure: string;
      try {
        const res = await this.fetcher(url, {
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        });
        if (res.ok) return await res.json();

        failure = `${res.status} ${res.statusText}`;
        if (!isRetryable(res.status)) {
          throw new Error(`eSett GET ${endpoint} returnerade ${failure}`);
        }
      } catch (err) {
        // Permanenta HTTP-fel kastas vidare direkt; nätverksfel/timeout retas om.
        if (err instanceof Error && err.message.startsWith('eSett GET')) throw err;
        failure = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      }

      const backoff = this.backoffMs[attempt];
      if (backoff === undefined) {
        throw new Error(
          `eSett GET ${endpoint} misslyckades efter ${maxAttempts} försök — sist: ${failure}`,
        );
      }
      this.log(`eSett ${endpoint} gav ${failure} — nytt försök om ${Math.round(backoff / 1000)} s`);
      await this.sleep(backoff);
    }

    // Onåbart: loopen returnerar eller kastar. Krävs för TS-kontrollflödet.
    throw new Error(`eSett GET ${endpoint} — oväntat slut på försök`);
  }
}
