# fia — Förändringar i avräkningsstrukturen

Förändringsbevakning av strukturen på svenska elmarknaden. Hämtar eSetts
strukturdata en gång per dygn, sparar resultatet som JSON-filer i det här
repot och publicerar en läsvy via Vercel. Vyn följer eSetts egen open
data-sida (opendata.esett.com) i namn, ordning och utseende — men med
förändringarna i centrum: startsidan är ett flöde över vad som skiljde sig
mellan dygnen, inte tabellerna.

Bara struktur. Priser, volymer och avgifter (EXP05, EXP08–EXP18) ingår
medvetet inte.

**Ingen databas.** Filerna under `data/` *är* databasen, och git är
historiken: `git log -p data/brp-relations.json` visar exakt vad som ändrats
och när.

**Ingen skrivning någonstans.** Appen läser från eSett och skriver till filer.
Den rör inte energi-systemet och kan inte påverka det.

## Så hänger det ihop

```
cron (04:30 + slumpad fördröjning)
  └─ scripts/daily-import.sh
       └─ docker compose run importer
            ├─ hämtar 7 anrop mot api.opendata.esett.com
            ├─ validerar schema, mappar, diffar mot förra körningen
            ├─ spärrar: tomt svar? saknat prisområde? massförsvinnande?
            ├─ skriver data/*.json  (bara vid faktisk förändring)
            ├─ skriver data/runs/<id>.json  (alltid, även vid fel)
            └─ git commit + push
                 └─ Vercel bygger om → kollegan ser det nya
```

## Innehållet i `data/`

Vy-slugs och gruppering är eSetts egna (`/dso`, `/mga`, `/rbr` …) så varje vy
går att slå upp mot exakt en endpoint:

| Fil | Vy | Källa |
| --- | --- | --- |
| `brp-parties.json` | Balance Responsible Parties | `EXP01/BalanceResponsibleParties?country=SE` |
| `bsps.json` | Balancing Service Providers | `EXP01/BalanceServiceProviders?country=SE` |
| `dsos.json` | Distribution System Operators | `EXP01/DistributionSystemOperators?country=SE` |
| `grid-areas.json` | Metering Grid Areas | `EXP03/MeteringGridAreas?mgaType=DISTRIBUTION` |
| `brp-relations.json` | Retailer Balance Responsibilities | `EXP04/RetailerBalanceResponsibility` per prisområde |
| `retailers.json` | Retailers | `EXP01/Retailers?country=SE` |
| `banks.json` | Settlement Banks | `EXP06/Banks` (hela Norden — endpointen saknar filter) |
| `runs/index.json` | Körningar | De senaste 400 i sammanfattning |
| `runs/<id>.json` | Körningsdetalj | Full rapport: steg, spärrar, förändringar |

Registerposterna behåller API:ets fältnamn (`reCode`, `brpName`, `bic` …) —
vyn ska gå att läsa mot API-dokumentationen utan översättningstabell.

Alla listor är sorterade i kodpunktsordning och serialiseras identiskt varje
gång. Det är avsiktligt: utan det blir varje daglig commit en diff även när
ingenting hänt, och git slutar fungera som ändringslogg.

## Komma igång

```bash
cp .env.example .env          # sätt SITE_PASSWORD och kontrollera spärrgränsen
npm install                   # eller: docker compose run --rm importer --dry-run
```

### Köra importen

```bash
./scripts/daily-import.sh --dry-run --manual   # hämtar och jämför, skriver inga datafiler
./scripts/daily-import.sh --manual             # skarp körning utan slumpfördröjning
./scripts/daily-import.sh                      # som cron kör den
```

### Cron

```cron
30 4 * * * /home/niclas/docker/fia/scripts/daily-import.sh
```

Skriptet loggar till `logs/import-ÅÅÅÅ-MM.log` och tar ett lås, så en körning
som fortfarande gör omförsök aldrig krockar med nästa.

### Webbvyn lokalt

```bash
docker compose --profile dev up web   # http://localhost:3200
```

### Tester

```bash
docker compose run --rm --entrypoint npx importer vitest run
```

## Historiken från energi

Körningshistoriken före utbrytningen ligger inläst i `data/runs/`. Den kom från
energi-systemets `esett_brp_import_run` och `esett_import_run`:

```bash
./scripts/dump-energi-runs.sh            # SELECT ur energis databas → JSON
npm run backfill /tmp/energi-esett-runs.json
```

Inläsningen är idempotent och rör aldrig en körning appen själv gjort. Den är
gjord en gång; skripten finns kvar för att resultatet ska gå att härleda.

Inlästa körningar märks med `origin: "energi"` och en `scope` — energi körde
nätområden veckovis och balansansvar dagligen som **två separata jobb**, så en
importerad rad täcker bara den ena halvan. Vyn visar streck, inte nollor, för
det en körning inte omfattade.

Tre saker fanns helt enkelt inte i källan och hittas därför inte på:
`triggered_by` saknas på nätområdessidan (blir `unknown`, inte `cron`),
stegtider loggades aldrig per endpoint (blir `null`, inte en gissning), och
spärrar fanns inte alls. Misslyckade körningar lämnade inget spår i de
tabellerna — historiken innehåller alltså bara lyckade körningar, vilket är
precis det den här appen gör tvärtom.

## Drift och konfiguration

Allt styrs via `.env` (se `.env.example`). De som spelar mest roll:

| Variabel | Vad den gör |
| --- | --- |
| `SITE_PASSWORD` | Delat lösenord till webbvyn. Sätts även i Vercel. Saknas det är sajten helt låst. |
| `ESETT_MIN_DELAY_MS` | Minsta paus mellan två anrop mot eSett. Vi äger ingen SLA mot dem. |
| `ESETT_RETRY_BACKOFF_MS` | Omförsök vid 429/5xx/timeout. Tomt värde stänger av retry. |
| `IMPORT_JITTER_MAX_MINUTES` | Slumpat startfönster så vi inte anropar på sekunden varje dygn. |
| `IMPORT_MAX_SHRINK_PCT` | Massförändringsspärren. **Er policy att sätta** — se nedan. |
| `IMPORT_GIT_PUSH` | `false` stänger av push (körningen committar ändå lokalt). |

### Massförändringsspärren

Svarar eSett `200 OK` med en tom eller halv lista ser det ut som att alla
relationer upphört. Spärren vägrar skriva när fler än `IMPORT_MAX_SHRINK_PCT`
av posterna försvunnit sedan förra körningen — körningen får status `blocked`,
datafilerna lämnas orörda och rapporten säger varför.

Andelen är en policy, inte en sanning. Standardvärdet 10 % är en startpunkt,
inte en rekommendation: sätt den nivå ni faktiskt vill bli stoppade vid.

## Vad datat inte kan svara på

EXP04 (balansansvar) bär bara **namn** — inga koder och inga giltighetsdatum.
Konsekvenser att känna till innan någon bygger larm på det här:

- Ett firmanamnsbyte hos en elhandlare ser exakt ut som "relationen upphörde
  och en ny elhandlare tillkom". *Upphörd betyder inte marknadsutträde.*
- Relationen saknar startdatum. Vi vet när **vi** såg förändringen, inte när
  den trädde i kraft.
- Samma elhandlare kan ha olika BRP i olika nätområden inom ett prisområde.
  De relationerna visas med samtliga BRP i stället för att en får vinna.

Kopplingen nätområde → nätägare är också en namnmatchning, eftersom eSett
anger nätägarens namn och inte dess kod på MGA-raden. Namn är inte unika; vid
flera träffar väljs lägsta koden deterministiskt och raden flaggas.

## Ursprung

Integrationen är utbruten ur energi-systemet. HTTP-klienten, mappers och båda
diff-modulerna är ärvda därifrån; SCD-2-lagringen är det inte — den behövs
inte när git bär historiken. Se [docs/arkitektur.md](docs/arkitektur.md) för
vad som ändrades och varför.
