import type { Metadata } from 'next';
import Link from 'next/link';

import SideNav from '@/components/SideNav';
import { getRunIndex } from '@/lib/data';
import { formatDateTime } from '@/lib/format';

import './globals.css';

export const metadata: Metadata = {
  title: 'fia — eSett',
  description: 'Förändringsbevakning av eSett open data — strukturen på svenska elmarknaden',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const latest = getRunIndex().runs[0];

  return (
    <html lang="sv">
      <body>
        <header className="masthead">
          <div className="masthead-inner">
            <Link href="/" className="wordmark">
              fia<span>eSett open data · förändringsbevakning</span>
            </Link>
          </div>
        </header>
        <div className="shell">
          <SideNav />
          <main>{children}</main>
          <footer className="pagefoot">
            Data från eSett open data (api.opendata.esett.com).{' '}
            {latest
              ? `Senaste körning ${formatDateTime(latest.startedAt)}.`
              : 'Ingen körning har genomförts än.'}
          </footer>
        </div>
      </body>
    </html>
  );
}
