import { NextResponse, type NextRequest } from 'next/server';

import { AUTH_COOKIE, safeEqual, sessionToken } from '@/lib/auth';

/**
 * Släpper bara in den som har en giltig sessionscookie.
 *
 * Failar stängt: saknas SITE_PASSWORD i miljön kommer ingen in alls. En
 * felkonfigurerad deploy ska vara låst, inte öppen.
 */
export async function middleware(request: NextRequest) {
  const password = process.env['SITE_PASSWORD'];
  if (!password) {
    return new NextResponse(
      'SITE_PASSWORD är inte satt i miljön — appen är låst tills den konfigurerats.',
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }

  const cookie = request.cookies.get(AUTH_COOKIE)?.value ?? '';
  if (safeEqual(cookie, await sessionToken(password))) return NextResponse.next();

  const login = new URL('/login', request.url);
  // Spara vart användaren var på väg så vi kan skicka tillbaka efter inloggning.
  const target = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (target !== '/') login.searchParams.set('next', target);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|login|api/login).*)'],
};
