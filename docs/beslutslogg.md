# Beslutslogg

Senaste överst.

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
