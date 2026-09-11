'use client';

import Link from 'next/link';
import { AdminShell } from '@/components/shell';
import { Card } from '@/components/ui';
import { Icon } from '@/components/icon';
import { useAdminSession } from '@/hooks/use-session';
import { SignedOut } from '@/components/signed-out';

/**
 * `الفواتير` (plan §253).
 *
 * Deliberately not implemented as a tax-invoice feature.
 *
 * Plan §253 is explicit that finance-statement legal naming, and any claim that
 * a document is a tax invoice, must be reviewed by Iraqi legal and accounting
 * professionals before the product asserts it. Plan §3 lists "tax-invoice
 * claims that have not been reviewed" as out of scope for Release 1.
 *
 * Shipping a screen labelled "فاتورة ضريبية" without that review would create a
 * compliance exposure for every restaurant on the platform. What Jibli actually
 * produces today is a commission statement, and that is what the settlements
 * screen calls it.
 */
export default function InvoicesPage() {
  const session = useAdminSession();

  if (session.status !== 'authenticated') {
    return <SignedOut reason={session.status === 'unauthenticated' ? session.reason : undefined} />;
  }

  return (
    <AdminShell
      title="الفواتير"
      subtitle="حالة المستندات المالية الرسمية"
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
    >
      <Card title="غير مفعّل في الإصدار الأول" icon="invoices">
        <div className="alert-bar alert-bar--warning">
          <Icon name="alert" className="nav__icon" aria-hidden />
          <span>
            إصدار فواتير ضريبية رسمية يتطلب مراجعة قانونية ومحاسبية عراقية للتسمية والمحتوى
            والمتطلبات النظامية. لم تُجرَ هذه المراجعة بعد، ولذلك لا تُصدر المنصة أي مستند يدّعي
            أنه فاتورة ضريبية.
          </span>
        </div>

        <p style={{ marginTop: 'var(--space-4)', color: 'var(--text-secondary)' }}>
          ما تصدره جيبلي حالياً هو <strong>كشف عمولة</strong> يوضّح الطلبات المشمولة ونسبة العمولة
          المطبّقة على كل طلب والمبلغ المستحق — وهو مستند تشغيلي بين جيبلي والمطعم، وليس مستنداً
          ضريبياً.
        </p>

        <Link className="btn btn--primary" href="/finance/settlements">
          الذهاب إلى كشوف العمولة
        </Link>

        <p
          style={{
            marginTop: 'var(--space-4)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
          }}
        >
          عند اكتمال المراجعة القانونية، تُضاف هنا: التسمية الرسمية المعتمدة، الحقول النظامية
          المطلوبة، وآلية الترقيم والحفظ.
        </p>
      </Card>
    </AdminShell>
  );
}
