// Delad lösenordsgrind.
//
// Appen visar bara information — kollegan kan inte ändra någonting, och all
// data kommer från eSetts öppna API. Skyddet finns för att hålla vyn intern,
// inte för att skydda hemligheter. Därför räcker ett delat lösenord.
//
// Cookien bär aldrig lösenordet, bara en hash av det. Läcker cookien går den
// inte att baklängesöversätta till lösenordet, och byter ni SITE_PASSWORD
// blir alla utfärdade cookies ogiltiga automatiskt.

export const AUTH_COOKIE = 'fia_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Härleder sessionsvärdet ur lösenordet. Körs både i middleware (edge) och i login-routen. */
export async function sessionToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`fia:v1:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Jämförelse utan tidsläckage — längden får skilja, innehållet jämförs alltid helt. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
