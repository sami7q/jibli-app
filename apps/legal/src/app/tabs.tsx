'use client';

import type { ReactElement } from 'react';
import { usePathname } from 'next/navigation';

/**
 * The three documents, with the current one marked.
 *
 * The only client component on the site, and it exists because the alternative
 * was a tab bar that never highlights — which reads as broken rather than as
 * minimal. `usePathname` is the whole reason; the pages themselves stay
 * statically prerendered.
 *
 * `aria-current` before the styling: a screen reader announcing "current page"
 * is the part that has to work, and the orange underline is what sighted
 * readers get from the same attribute.
 */
const PAGES = [
  { href: '/privacy', label: 'الخصوصية' },
  { href: '/terms', label: 'الشروط' },
  { href: '/delete-account', label: 'حذف الحساب' },
] as const;

export function Tabs(): ReactElement {
  const pathname = usePathname();

  return (
    <nav aria-label="المستندات">
      <ul className="tabs">
        {PAGES.map((page) => {
          const current = pathname === page.href;
          return (
            <li key={page.href}>
              <a href={page.href} {...(current ? { 'aria-current': 'page' as const } : {})}>
                {page.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
