import Link from 'next/link';

/**
 * Arabic 404 (ADMIN-24).
 *
 * Next's default is the English «This page could not be found.», which is what
 * every mistyped path and — before the order detail screen existed — every
 * order link showed. This replaces it with the portal's own voice and a way
 * back, rendered in the same RTL shell as everything else.
 */
export default function NotFound() {
  return (
    <main
      className="empty"
      dir="rtl"
      style={{ minHeight: '100vh', justifyContent: 'center', textAlign: 'center' }}
    >
      <h1 style={{ fontSize: 'var(--text-2xl)', margin: 0 }}>الصفحة غير موجودة</h1>
      <p style={{ color: 'var(--text-muted)' }}>
        الرابط الذي فتحته غير صحيح أو أن العنصر لم يعد موجوداً.
      </p>
      <Link className="btn btn--primary" href="/">
        العودة إلى الرئيسية
      </Link>
    </main>
  );
}
