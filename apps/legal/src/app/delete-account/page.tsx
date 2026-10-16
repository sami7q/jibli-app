import type { ReactElement } from 'react';
import type { Metadata } from 'next';
import { CONTACT_EMAIL } from '../contact';

export const metadata: Metadata = {
  title: 'حذف الحساب',
  description:
    'كيف تحذف حساب جيبلي من داخل التطبيق، وما الذي يُمسح وما الذي يبقى، وكيف تطلب الحذف إن فقدت هاتفك.',
};

const UPDATED = '١٦ تشرين الأول ٢٠٢٦';

/**
 * Google Play's account-deletion URL.
 *
 * Play requires a *web* page, publicly reachable, that explains how an account
 * and its data are deleted — in addition to the in-app route Apple requires
 * under 5.1.1(v). One page satisfies both, provided it says the same thing the
 * app's own confirmation sheet says, which is why the two lists below are the
 * literal outcome of `DELETE /api/v1/profile` rather than a friendlier summary.
 */
export default function DeleteAccountPage(): ReactElement {
  return (
    <article className="page">
      <p className="page__eyebrow">طلب</p>
      <h1 className="page__title">حذف الحساب</h1>
      <p className="page__standfirst">
        تستطيع حذف حسابك بنفسك من داخل التطبيق، فوراً ودون مراسلة أحد. هذه الصفحة تشرح الخطوات وما
        الذي يحدث بالضبط.
      </p>

      <div className="qa">
        <section>
          <h2>الخطوات</h2>
          <ol className="steps">
            <li>افتح تطبيق جيبلي وسجّل الدخول برقمك.</li>
            <li>
              اذهب إلى تبويب <strong>حسابي</strong> في أقصى يسار الشريط السفلي.
            </li>
            <li>
              انزل إلى مجموعة <strong>الحساب</strong> واختر <strong>حذف حسابي</strong>.
            </li>
            <li>
              اقرأ ما سيحدث، ثم أكّد بـ <strong>حذف نهائي</strong>.
            </li>
          </ol>
          <p>
            يتمّ الحذف في اللحظة نفسها، وتُسجَّل خروجك من كل الأجهزة. لا توجد فترة انتظار ولا خطوة
            مراجعة.
          </p>
        </section>

        <section>
          <h2>ما الذي يُمسح</h2>
          <ul>
            <li>اسمك ورقم هاتفك — ويعود الرقم متاحاً للتسجيل من جديد.</li>
            <li>كل عناوين التوصيل المحفوظة، بما فيها أي إحداثيات اخترتها.</li>
            <li>مطاعمك المفضّلة.</li>
            <li>
              تقييماتك وتعليقاتك كلها — ويُعاد حساب تقييم كل متجر قيّمته بدونها — والبلاغات التي
              قدّمتها، وقائمة من حظرتهم.
            </li>
            <li>رموز الإشعارات لكل أجهزتك، فلا تصلك إشعارات بعدها.</li>
            <li>محافظتك ومدينتك المحفوظتان.</li>
            <li>جلساتك على كل الأجهزة.</li>
          </ul>
        </section>

        <section>
          <h2>ما الذي يبقى، ولماذا</h2>
          <p>
            <strong>سجلّ الطلبات السابقة.</strong> الطلب الذي وصل إليك حدث فعلاً، وهو سجلّ مالي
            للمطعم وللمنصّة بقدر ما هو سجلّك. يبقى بلا اسمك ولا رقمك — يُمسحان من الطلب نفسه أيضاً —
            صفٌّ لا يمكن التعرّف على صاحبه منه.
          </p>
          <p>
            <strong>سطر واحد يثبت أن الحذف تمّ</strong>، يحمل رقم هاتفك. هو ما يسمح للدعم بمطابقتك
            إن راجعتنا لاحقاً بشأن طلب قديم، وما يثبت أن الحذف نُفِّذ بطلبك.
          </p>
          <p>
            <strong>طلبات رمز الدخول الأخيرة</strong> — رقمك وعنوان IP ونوع التطبيق مع كل طلب رمز —
            تبقى حتى تُحذف تلقائياً بعد ٧ أيام من الطلب، لحماية الخدمة من الطلبات الآلية.
          </p>
        </section>

        <section className="callout">
          <h2>حالتان لا يتمّ فيهما الحذف فوراً</h2>
          <p>
            <strong>لديك طلب قيد التنفيذ.</strong> هناك مطبخ يطبخ ومندوب في الطريق ومبلغ يُستلم —
            انتظر حتى يصل الطلب، أو ألغِه، ثم احذف الحساب.
          </p>
          <p>
            <strong>حسابك مرتبط بمطعم أو بصلاحيات إدارية.</strong> هذه الحسابات يمنحها طرف آخر
            ويسحبها، ولا يصحّ أن يفقد مطعم مالكه الوحيد بضغطة. راسلنا وننفّذها يدوياً.
          </p>
        </section>

        <section>
          <h2>إن لم تستطع الوصول إلى التطبيق</h2>
          <p>
            إن فقدت هاتفك أو رقمك ولم تعد تستطيع الدخول، أرسل بريداً إلى{' '}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> من أي عنوان، واذكر رقم الهاتف
            المسجَّل. نتحقّق من أنك صاحبه قبل الحذف — لأن طلباً كهذا من شخص آخر يعني حذف حسابك أنت —
            وننفّذ خلال ٣٠ يوماً كحدّ أقصى، وعادةً خلال أيام.
          </p>
        </section>

        <section>
          <h2>هل يمكن التراجع؟</h2>
          <p>
            لا. الحذف نهائي ولا توجد نسخة يمكن استعادتها. يمكنك إنشاء حساب جديد بالرقم نفسه متى شئت،
            لكنه يبدأ فارغاً.
          </p>
        </section>
      </div>

      <p className="page__updated">آخر تحديث: {UPDATED}</p>
    </article>
  );
}
