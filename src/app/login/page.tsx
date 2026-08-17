import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Logga in — fia' };

export const dynamic = 'force-static';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ fel?: string; next?: string }>;
}) {
  const { fel, next } = await searchParams;

  return (
    <div className="login-shell">
      <div className="login-card">
        <h1>fia</h1>
        <p className="muted" style={{ margin: 0 }}>
          Förändringar i avräkningsstrukturen — aktörer, nätområden och balansansvar från eSett
          open data.
        </p>

        <form method="post" action="/api/login">
          {next ? <input type="hidden" name="next" value={next} /> : null}
          {fel ? <p className="error-note">Fel lösenord. Försök igen.</p> : null}
          <input
            type="password"
            name="password"
            placeholder="Lösenord"
            aria-label="Lösenord"
            autoComplete="current-password"
            autoFocus
            required
          />
          <button type="submit">Logga in</button>
        </form>
      </div>
    </div>
  );
}
