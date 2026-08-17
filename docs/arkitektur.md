# Arkitektur

> Status: CANONICAL · Senast verifierad 2026-08-17 mot skarp körning
> (174 DSO, 278 nätområden, 1 785 relationer ur 145 509 hämtade rader) och
> testsvit 56/56.

Utbrytning av eSett-integrationen ur energi-systemet till en fristående,
filbaserad app. Kompletterar handoverdokumentet — här står vad som faktiskt
byggdes och varför det skiljer sig.

## Runtime-flöde

| Steg | Fil |
| --- | --- |
| Cron-wrapper, lås, loggning | [scripts/daily-import.sh](../scripts/daily-import.sh) |
| Orkestrering av körningen | [src/importer/run.ts](../src/importer/run.ts) |
| HTTP mot eSett: retry, backoff, pacing | [src/esett/client.ts](../src/esett/client.ts) |
| Schemavalidering | [src/esett/schemas.ts](../src/esett/schemas.ts) |
| DTO → våra poster | [src/esett/mappers.ts](../src/esett/mappers.ts) |
| Diff av register | [src/esett/diff.ts](../src/esett/diff.ts) |
| Diff av balansansvar | [src/esett/brp-diff.ts](../src/esett/brp-diff.ts) |
| Spärrar före skrivning | [src/importer/guards.ts](../src/importer/guards.ts) |
| Läs/skriv `data/` | [src/importer/store.ts](../src/importer/store.ts) |
| Commit och push | [src/importer/git.ts](../src/importer/git.ts) |
| Webbvyns läsning | [src/lib/data.ts](../src/lib/data.ts) |
| Lösenordsgrind | [src/middleware.ts](../src/middleware.ts) |

Elva HTTP-anrop per körning: fyra EXP01-register (DSO, Retailers, BRP, BSP),
EXP03 (MGA), EXP06 (banker), EXP04 MBAOptions samt EXP04
RetailerBalanceResponsibility en gång per prisområde. Inga credentials —
API:t är publikt och kräver ingen autentisering.

Vyn speglar eSetts egen open data-sida: samma titlar, slugs och ordning
(`src/lib/datasets.ts` är enda källan), deras färgpalett och header-gradient
(extraherade ur produktions-CSS:en 2026-08-17), och API:ets fältnamn som
kolumnrubriker. Bara strukturdata — priser, volymer och avgifter (EXP05,
EXP08–EXP18) ingår inte.

## Vad som ärvdes och vad som ersattes

**Ärvt i stort sett rakt av:** HTTP-klientens endpoint-kunskap, mappers
(zon-härledning, skip-skäl), fält-för-fält-diffen och BRP-diffens fyra utfall
(`new_retailer` / `new_relation` / `brp_switch` / `ended`).

**Ersatt: SCD-2-lagringen.** I energi-systemet krävdes `valid_from`/`valid_to`,
ett partiellt unikt index och en strikt ordning ("stäng före du öppnar") för
att bevara historik i en tabell. Med filer i git är historiken redan bevarad —
`git log -p data/brp-relations.json` är ändringsloggen. Kvar blev bara den
rena frågan: vad skiljer dagens snapshot från gårdagens?

**Invarianterna i handoverns §6 gäller inte här.** ADR-0046, zon-erorna,
`grid_owner_id`-backfillen och `actor.email` handlar alla om *skrivningar in i
energi-systemets databas*. Den här appen skriver bara filer. Skulle någon
senare låta energi-systemet konsumera `data/` gäller de igen fullt ut, och då
i den konsumerande änden.

## Härdningar mot handoverns §7

| Svaghet i ursprunget | Vad som gjordes |
| --- | --- |
| Ingen retry — ett 5xx = hela dygnets hämtning uteblir | Omförsök vid 408/429/5xx/timeout med backoff 1/4/16 min. Permanenta 4xx retryas inte. |
| Ingen sanity-check vid massförändring | Tre spärrar: tomt svar, ofullständig prisområdesuppsättning, och andel försvunna poster över gräns. Fälld spärr → `blocked`, datafiler orörda. |
| Ingen schemavalidering → tyst massradering vid fältnamnsbyte | Zod per rad. Alla trasiga rader samlas och rapporteras; körningen failar högt. |
| Dedupp "sista vinner", beroende av eSetts radordning | Alla BRP för samma nyckel behålls; primärvärdet väljs deterministiskt och övriga hamnar i `conflicts`. |
| `energyDirectionType` föll tyst tillbaka på consumption | Okända värden hamnar i `skipped` och syns i rapporten. |
| `triggered_by` sattes aldrig | Obligatoriskt fält: `cron` eller `manual`. |
| Misslyckade körningar lämnade inget spår | Rapporten skrivs alltid, som sista steg, oavsett utfall. |
| Klienten saknade tester | 14 tester på klienten, varav retry-, 404- och schemadriftsfallen. |

Kvar som medvetna begränsningar: namn som naturlig nyckel i EXP04 (eSett bär
inget annat), och att vi bara vet när *vi* såg en förändring — inte när den
trädde i kraft.

## Determinism

Allt som hamnar i en fil sorteras med [`cmp`](../src/esett/sort.ts) —
kodpunktsordning, inte `localeCompare`. `localeCompare` läser systemets
ICU-data, så två maskiner kan sortera samma poster olika och skapa falska
diffar. Serialiseringen är alltid `JSON.stringify(v, null, 2)` plus radbrytning,
och `DataStore.write` skriver bara när innehållet faktiskt skiljer sig.

Konsekvensen är att en dag utan förändringar ger noll ändrade datafiler — bara
en ny körningsrapport.

## Atomicitet

Den gamla importen körde allt i en databastransaktion. Med filer finns ingen
sådan garanti, så ordningen gör jobbet i stället: hämtning och mappning sker
helt i minnet, spärrarna utvärderas, och *först därefter* skrivs datafilerna.
Ett avbrott dessförinnan hinner aldrig lämna ett halvskrivet tillstånd. Skulle
processen dö mitt i skrivningen fångas det av nästa körning, som diffar mot
det som faktiskt ligger på disk.

## Webbvyn

Next.js App Router, allt statiskt genererat vid build. Datat kan per definition
inte ändras mellan två deployer — det ändras bara när importern pushar, och
varje push utlöser ett nytt bygge på Vercel.

Filtrering och sökning sker helt i webbläsaren
([FilterableTable](../src/components/FilterableTable.tsx)); hela datamängden
följer med sidan. Därför finns inget API och ingen serverdel att drifta.

Inloggningen är en delad lösenordsgrind i middleware. Cookien bär en SHA-256
av lösenordet, aldrig lösenordet självt, och byte av `SITE_PASSWORD` ogiltigför
alla utfärdade cookies. Saknas variabeln svarar appen 503 — en felkonfigurerad
deploy ska vara låst, inte öppen.
