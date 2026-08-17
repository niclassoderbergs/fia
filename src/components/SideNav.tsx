'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { DATASETS } from '@/lib/datasets';

/**
 * Sidomenyn — samma platta lista och ordning som eSetts egen drawer, med
 * EXP-taggen synlig så varje vy går att slå upp mot sin exportgrupp.
 * Klientkomponent enbart för aria-current; sidorna förblir statiska.
 */
export default function SideNav() {
  const pathname = usePathname();
  const current = (href: string) =>
    (href === '/' ? pathname === '/' : pathname.startsWith(href)) ? 'page' : undefined;

  return (
    <nav className="sidenav" aria-label="Datavyer">
      <Link href="/" aria-current={current('/')}>
        Förändringar
      </Link>
      <div className="sidenav-group">Open data · struktur</div>
      {DATASETS.map((d) => (
        <Link key={d.slug} href={`/${d.slug}`} aria-current={current(`/${d.slug}`)}>
          {d.title}
          <span className="exp-tag">{d.exp}</span>
        </Link>
      ))}
      <div className="sidenav-group">System</div>
      <Link href="/korningar" aria-current={current('/korningar')}>
        Körningar
      </Link>
    </nav>
  );
}
