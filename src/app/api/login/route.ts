import { NextResponse, type NextRequest } from 'next/server';

import { AUTH_COOKIE, SESSION_MAX_AGE_SECONDS, safeEqual, sessionToken } from '@/lib/auth';

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
    const back = new URL('/login', request.url);
    back.searchParams.set('fel', '1');
    if (next !== '/') back.searchParams.set('next', next);
    return NextResponse.redirect(back, { status: 303 });
  }

  const response = NextResponse.redirect(new URL(next, request.url), { status: 303 });
  response.cookies.set(AUTH_COOKIE, expected, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
