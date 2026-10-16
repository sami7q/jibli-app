import type { ReactElement, ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { Cairo, IBM_Plex_Mono } from 'next/font/google';
import { CONTACT_EMAIL, SUPPORT_PHONE } from './contact';
import { Tabs } from './tabs';
import './globals.css';

/**
 * The public legal site.
 *
 * Three pages behind no login, no database and no API: the privacy policy, the
 * terms, and the account-deletion route Google Play requires as a *web* page in
 * addition to the one inside the app. They are separated from the two portals
 * on purpose — the portal config sends `no-store` on every response and proxies
 * `/api/*`, and a policy page that cannot be cached and depends on a backend is
 * a policy page that is down when the backend is.
 */

const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-cairo',
});

/**
 * For the stored field names, and nothing else.
 *
 * `phone_e164` beside «رقم الهاتف» is Latin inside an Arabic line, and setting
 * it in the body face makes it read as a typo. A mono face says "this is a
 * name the system uses", which is exactly the distinction the inventory is
 * drawing.
 */
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400'],
  display: 'swap',
  variable: '--font-mono',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jibli.iq'),
  title: { default: 'جيبلي — الخصوصية والشروط', template: '%s · جيبلي' },
  description:
    'سياسة الخصوصية والشروط وطلب حذف الحساب لتطبيق جيبلي لتوصيل الطعام والمواد الغذائية في العراق.',
  // The one site in this project that *should* be indexed: a policy nobody can
  // find is a policy that has not been published.
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#ff5400',
  width: 'device-width',
  initialScale: 1,
};

/*
 * The return type is stated, not inferred.
 *
 * Without it `tsc` reports TS2742 — "the inferred type cannot be named without
 * a reference to .pnpm/@types+react@…" — because the workspace resolves more
 * than one copy of the React typings and the emitted declaration would have to
 * point at a path inside pnpm's store. It is the same failure that once kept
 * both portals on a stale Vercel build for thirteen hours while the site
 * looked merely out of date. Naming the type removes the inference, and with
 * it the dependence on which copy happened to win.
 */
export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="ar" dir="rtl" className={`${cairo.variable} ${mono.variable}`}>
      <body>
        <header className="masthead">
          <div className="masthead__inner">
            <a className="wordmark" href="/">
              <span className="wordmark__name">جيبلي</span>
              <span className="wordmark__tag">توصيل طعام ومواد غذائية — العراق</span>
            </a>
            <Tabs />
          </div>
        </header>

        <main>{children}</main>

        <footer className="footer">
          <div className="footer__inner">
            <p>
              جيبلي — خدمة توصيل تعمل داخل العراق. للأسئلة حول بياناتك:{' '}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
              {SUPPORT_PHONE ? (
                <>
                  {' '}
                  — الدعم:{' '}
                  <a href={`tel:${SUPPORT_PHONE}`} dir="ltr">
                    {SUPPORT_PHONE}
                  </a>
                </>
              ) : null}
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
