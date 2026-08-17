# Beslutslogg

Senaste överst.

## 2026-08-17 — Förändringsflöde som startsida + historiken från energi inläst

Två saker föll ut av samma insikt: kollegans uppgift är att se **deltat mellan
dygnen**, inte att bläddra i registren. Vyn hade fel tyngdpunkt, och den hade
dessutom bara två dygn att visa.

**Beslut:**

- **Startsidan är ett kronologiskt flöde**, ett dygn per rad, utfällbart. De
  utfällbara raderna använder native `<details>` och filtret som döljer tysta
  dygn är en ren CSS-syskonselektor — sidan förblir helt statisk, ingen
  klientkod tillkom.
- **BRP-byten och upphörda relationer redovisas även när de är noll.** De är de
  enda utfallen som kan betyda att balansansvar faktiskt flyttat. Samma val som
  energis admin-vy gjorde.
- **Historiken lästes in i stället för att börja om från noll.** 59 körningar
  från 2026-06-09 och framåt, ur `esett_brp_import_run` (50) och
  `esett_import_run` (9).
- **Inläst historik märks ut, inte tvättas ren.** `origin: "energi"` och en
  `scope` per rad, eftersom energi körde nätområden och balansansvar som två
  skilda jobb. Vyn visar streck för det en körning inte omfattade — en nolla
  hade varit ett påstående om verkligheten i stället för en frånvaro av data.
- **Ingen databasdrivare tillkom.** Inläsningen går via en JSON-dump
  (`scripts/dump-energi-runs.sh`) som en ren transformering läser. Att appen
  lever på filer är hela poängen med den; en `pg`-koppling hade motsagt det.
- **`linked` behölls som eget utfall.** Energi hade "nätägarkopplingen sattes"
  som egen händelse. Att platta till den mot `changed` hade gjort historiken
  otrogen sitt ursprung, så unionen utökades i stället.
- **`triggered_by` blir `unknown`, inte `cron`.** Nätområdessidan satte aldrig
  fältet, och flera av körningarna skedde mitt på dagen — att anta schemalagt
  hade varit en gissning presenterad som fakta.

**Levererat:** `src/components/ChangeFeed.tsx`, ny startsida,
`src/importer/backfill-map.ts` + `backfill.ts`, `scripts/dump-energi-runs.sh`,
15 nya tester (71 totalt), samt `plural()` så räkneord böjs rätt ("1 ändrat
nätområde", inte "1 ändrade nätområden").

**Live-verifiering:** 61 rader i flödet, varav 10 med förändring. Äldsta
2026-06-09. Startsidan 62 kB gzip. Bygget 71 statiska sidor.

**Öppen tråd:** historiken importerades vid ett tillfälle. Fortsätter energi
köra sina jobb parallellt driftar de två serierna isär — vid något läge bör
energis eSett-jobb stängas av, vilket kräver deploy eftersom kill-switchen är
hårdkodad.

## 2026-08-17 — Utbrytning av eSett-integrationen till fristående app

eSett-integrationen bröts ut ur energi-systemet till en egen app enligt
handoverdokumentet. Kravet: körs lokalt på servern varje dygn, resultatet
pushas till GitHub, ingen databas, och en kollega ska kunna logga in och läsa
resultatet utan att kunna ändra något.

**Beslut:**

- **Både (A) nätområdesregistret och (B) balansansvaret togs med.** Handovern
  varnar för att (A) inte är utbrytbar, men den varningen gäller att *ta över
  skrivningen* i energi-systemets kärntabeller. Den här appen läser från eSett
  och skriver till filer — energi-systemet fortsätter köra sin egen import
  orört och märker ingenting. Därmed gäller inga av §6-invarianterna här.
- **Filer i git ersätter SCD-2.** `valid_from`/`valid_to`, det partiella unika
  indexet och "stäng före du öppnar" fanns för att bevara historik i en tabell.
  Git bevarar den gratis. Priset är att allt som skrivs måste vara
  deterministiskt serialiserat — annars blir varje dygn en falsk diff.
- **Kodpunktsordning, inte `localeCompare`.** Sorteringen får inte bero på
  vilken ICU-version maskinen har. Visningsordningen i webbvyn använder svensk
  kollation; filerna gör det aldrig.
- **Delat lösenord i middleware framför OAuth.** Appen visar öppen data och
  kollegan kan inte ändra något — grinden håller vyn intern, den skyddar inga
  hemligheter. Cookien bär en hash, aldrig lösenordet.
- **Statisk generering i stället för API.** Datat ändras bara när importern
  pushar, och varje push bygger om på Vercel. Det finns alltså ingen tidpunkt
  då en dynamisk rendering hade visat något annat än bygget.
- **Spärrar före skrivning, rapport alltid.** Det farligaste utfallet är inte
  att en körning misslyckas, utan att ett partiellt eSett-svar med 200 OK
  tolkas som att allt upphört. Spärrarna stoppar skrivningen; rapporten skrivs
  ändå, så en stoppad körning syns i vyn.
- **`IMPORT_MAX_SHRINK_PCT` lämnades som konfiguration med 10 % som
  startvärde.** Nivån är en policy, inte något koden kan härleda — den ska
  sättas av er, inte gissas av implementationen.

**Levererat:**

- `src/esett/` — klient (retry, backoff, pacing, User-Agent), zod-schemas,
  mappers, två diff-moduler, delad sorteringsprimitiv
- `src/importer/` — orkestrering, spärrar, filstore, git-integration
- `src/app/` — översikt, nätområden, nätägare, balansansvar, körningar +
  körningsdetalj, inloggning
- `docker/` + `docker-compose.yml` + `scripts/daily-import.sh` — dygnskörning
  med lås och loggrotation per månad
- 56 tester (mappers 15, klient 14, spärrar 12, diff 8, brp-diff 7)

**Live-verifiering (2026-08-17):**

- Skarp körning mot `api.opendata.esett.com`: 174 nätägare, 278 svenska
  nätområden av 486 nordiska, 1 785 relationer ur 145 509 hämtade rader.
  Samma siffror som handovern uppger.
- Noll överhoppade rader → zod-schemana matchar eSetts faktiska svar.
- Samtliga sju spärrar OK. `next build`: tio sidor, alla statiska.

**Senarelagt / öppna trådar:**

- Ingen övervakning utöver exit-koden från cron-skriptet. Vill ni ha larm när
  eSett varit nere en hel natt får det byggas.
- `apps/web/lib/static-data/grid-areas.json` i energi-systemet är en manuellt
  underhållen fallback-snapshot av nätområdeslistan. Den driftar från den här
  appens data om ingen tar ansvar för den — beslut om ägarskap saknas.
- Handoverns §8: `esett-opendata-import.md` i energi-wikin är stale på två
  punkter och bör rättas eller arkiveras nu när integrationen flyttat.
