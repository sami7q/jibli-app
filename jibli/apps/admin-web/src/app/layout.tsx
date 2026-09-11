import type { Metadata, Viewport } from 'next';
import { Cairo } from 'next/font/google';
import '@jibli/ui-web/tokens.css';
import './globals.css';
import { Providers } from './providers';

/**
 * Cairo, self-hosted by Next at build time.
 *
 * The previous `<link>` to fonts.googleapis.com cost a DNS lookup, a TLS
 * handshake and a render-blocking stylesheet on a connection that, in an Iraqi
 * restaurant on mobile data, is the slowest part of the page. Self-hosting
 * serves the font from the same origin, and `display: swap` paints text in the
 * fallback immediately rather than holding a blank screen.
 *
 * It also lets the Content-Security-Policy drop two external origins.
 */
const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  // Exposed as a CSS variable so the token file keeps owning the font stack.
  variable: '--font-cairo',
});

/**
 * Admin Portal shell.
 *
 * Arabic RTL only (plan §130). The portal is never indexed and never framed.
 */

export const metadata: Metadata = {
  title: 'جيبلي — لوحة الإدارة',
  description: 'إدارة المطاعم والتغطية الجغرافية والتسويات',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#16181d',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={cairo.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
