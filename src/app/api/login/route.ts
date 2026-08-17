import { NextResponse, type NextRequest } from 'next/server';

import { AUTH_COOKIE, SESSION_MAX_AGE_SECONDS, safeEqual, sessionToken } from '@/lib/auth';

/**
 * Relativ omdirigering.
 *
 * NextResponse.redirect kräver en absolut URL, och den enda värdadressen som
 * finns att bygga den av är request.url — som i en route handler är serverns
 * egen bindningsadress, inte klientens värdnamn. Bakom en proxy blir det
 * lätt fel (observerat: 0.0.0.0). En relativ Location är tillåten enligt
 * RFC 7231 och löses av webbläsaren mot adressen användaren faktiskt är på.
 */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

/**
 * Tar emot lösenordet, sätter sessionscookien och skickar tillbaka användaren
 * dit hen var på väg. Routen ligger utanför middleware-matchern, annars skulle
 * inloggningen kräva att man redan var inloggad.
 */
export async function POST(request: NextRequest) {
  const password = process.env['SITE_PASSWORD'];
  if (!password) {
    return new NextResponse('SITE_PASSWORD är inte satt i miljön.', { status: 503 });
  }

  const form = await request.formData();
  const submitted = String(form.get('password') ?? '');
  const rawNext = String(form.get('next') ?? '/');
  // Bara interna sökvägar — annars blir formuläret en öppen vidarebefordran.
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  const expected = await sessionToken(password);
  if (!safeEqual(await sessionToken(submitted), expected)) {
    const back = next === '/' ? '/login?fel=1' : `/login?fel=1&next=${encodeURIComponent(next)}`;
    return redirectTo(back);
  }

  const response = redirectTo(next);
  response.cookies.set(AUTH_COOKIE, expected, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
