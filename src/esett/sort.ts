/**
 * Deterministisk strängjämförelse i kodpunktsordning.
 *
 * Medvetet INTE `localeCompare`: den läser systemets ICU-data, och två
 * maskiner med olika ICU-bygge kan sortera samma poster olika. Det skulle ge
 * falska diffar i git bara för att importen kördes någon annanstans. Allt som
 * hamnar i en fil under data/ sorteras med den här — filens ordning ska bero
 * på datat, ingenting annat.
 *
 * Visningsordning i webbvyn får däremot gärna vara svensk (å/ä/ö sist enligt
 * svensk kollation) — den påverkar inga filer.
 */
export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
