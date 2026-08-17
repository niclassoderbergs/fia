import type { Metadata } from 'next';
import Link from 'next/link';

import { getRunIndex } from '@/lib/data';
import { formatDateTime } from '@/lib/format';

import './globals.css';

export const metadata: Metadata = {
  title: 'fia — eSett',
  description: 'Nätområden, nätägare och balansansvar från eSett open data',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const latest = getRunIndex().runs[0];

  return (
    <html lang="sv">
      <body>
        <header className="masthead">
          <div className="masthead-inner">
            <Link href="/" className="wordmark">
              fia<span>eSett open data</span>
            </Link>
            <nav className="nav">
              <Link href="/">Översikt</Link>
              <Link href="/natomraden">Nätområden</Link>
              <Link href="/natagare">Nätägare</Link>
              <Link href="/balansansvar">Balansansvar</Link>
              <Link href="/korningar">Körningar</Link>
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer className="pagefoot">
          Data hämtad från eSett open data.{' '}
          {latest
            ? `Senaste körning ${formatDateTime(latest.startedAt)}.`
            : 'Ingen körning har genomförts än.'}
        </footer>
      </body>
    </html>
  );
}
