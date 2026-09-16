import type { ReactElement } from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'سياسة الخصوصية',
  description:
    'ما الذي يحفظه تطبيق جيبلي عنك بالضبط، ولماذا، ومتى يُحذف — مكتوبة كأسئلة وأجوبة.',
};

/** Changed only when the practice changes, not when the wording is tidied. */
const UPDATED = '١٦ أيلول ٢٠٢٦';

/**
 * Every field the platform stores about a customer, named.
 *
 * Read off the schema rather than written from memory — `users`,
 * `user_addresses`, `user_devices` and `otp_challenges` in
 * `packages/db/src/schema/identity.ts` — because a privacy policy that is
 * vaguer than the database is the kind that turns out to be wrong. The `field`
 * column is the real column name, which is what makes this checkable by
 * somebody who has the code, and what keeps it honest when the schema moves.
 *
 * `keeps` marks the two rows that survive deletion, and both are stated in the
 * app's own confirmation sheet before anyone taps «حذف نهائي».
 */
const INVENTORY: readonly {
  what: string;
  field: string;
  why: string;
  fate: string;
  keeps?: boolean;
}[] = [
  {
    what: 'رقم هاتفك',
    field: 'users.phone_e164',
    why: 'هو حسابك — به تدخل، وبه يتصل بك المندوب عند التوصيل.',
    fate: 'يُمسح عند حذف الحساب، ويعود الرقم متاحاً للتسجيل من جديد.',
  },
  {
    what: 'اسمك',
    field: 'users.full_name',
    why: 'ليعرف المطعم والمندوب لمن الطلب.',
    fate: 'يُمسح عند حذف الحساب.',
  },
  {
    what: 'محافظتك ومدينتك',
    field: 'users.profile_city_id',
    why: 'لعرض المطاعم التي توصّل إليك فقط. ليست عنوان توصيل.',
    fate: 'تُمسح عند حذف الحساب.',
  },
  {
    what: 'عناوين التوصيل المحفوظة',
    field: 'user_addresses',
    why: 'الحي والشارع والبناية والطابق وأقرب نقطة دالّة، وملاحظات التوصيل — ليصل الطلب دون مكالمة.',
    fate: 'تُحذف نهائياً عند حذف الحساب.',
  },
  {
    what: 'إحداثيات العنوان — اختيارية',
    field: 'user_addresses.latitude',
    why: 'نقطة على الخريطة تختارها أنت بسحب الدبوس. «قرب صيدلية النور» لا يكفي لمن لا يعرف الشارع.',
    fate: 'تُحذف مع العنوان.',
  },
  {
    what: 'رمز الإشعارات لجهازك',
    field: 'user_devices.push_token',
    why: 'لإرسال تحديث حالة الطلب إلى هاتفك، مع نوع الجهاز وإصدار التطبيق لتشخيص الأعطال.',
    fate: 'يُحذف عند حذف الحساب أو تسجيل الخروج.',
  },
  {
    what: 'سجل طلباتك',
    field: 'orders',
    why: 'الأصناف والمبالغ والعنوان الذي وصل إليه الطلب وقتها — سجلّ مالي للمطعم وللمنصّة.',
    fate: 'يبقى بعد حذف الحساب، غير مرتبط باسمك أو رقمك.',
    keeps: true,
  },
  {
    what: 'رقم الهاتف داخل سجل الحذف',
    field: 'audit_logs',
    why: 'سطر واحد يثبت أن الحذف تمّ، ويسمح للدعم بمطابقتك إن راجعتنا لاحقاً بخصوص طلب قديم.',
    fate: 'يبقى بعد حذف الحساب.',
    keeps: true,
  },
];

export default function PrivacyPage(): ReactElement {
  return (
    <article className="page">
      <p className="page__eyebrow">مستند</p>
      <h1 className="page__title">سياسة الخصوصية</h1>
      <p className="page__standfirst">
        مكتوبة لتُقرأ، لا لتُوقَّع. كل ما نحفظه عنك مذكور بالاسم في الجدول أدناه، ومعه سبب حفظه
        ومصيره إن حذفت حسابك.
      </p>

      <div className="qa">
        <section>
          <h2>ما الذي تحفظه جيبلي عني؟</h2>
          <p>
            هذا كل شيء. لا يوجد بند «ومعلومات أخرى قد نجمعها» — إن لم يكن في هذا الجدول فنحن لا
            نحفظه.
          </p>

          <div className="inventory">
            {INVENTORY.map((row) => (
              <div className="inventory__row" key={row.field}>
                <div className="inventory__head">
                  <span className="inventory__what">{row.what}</span>
                  <code className="inventory__field">{row.field}</code>
                </div>
                <p className="inventory__why">{row.why}</p>
                <p className="inventory__fate" data-keeps={row.keeps ? 'true' : 'false'}>
                  {row.fate}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2>هل تتتبّعون موقعي؟</h2>
          <p>
            لا. التطبيق يطلب الموقع <strong>مرة واحدة</strong>، وأنت واقف عند العنوان، لتضع دبوساً
            على الخريطة أثناء حفظه — ويمكنك رفض الإذن وكتابة العنوان يدوياً بدل ذلك.
          </p>
          <p>
            التطبيق لا يقرأ موقعك في الخلفية إطلاقاً. لا يوجد إذن موقع خلفي في التطبيق، ولا تتبّع
            حيّ للمندوب.
          </p>
        </section>

        <section>
          <h2>هل تبيعون بياناتي أو تعرضون إعلانات؟</h2>
          <p>
            لا نبيع بياناتك ولا نشاركها لأغراض إعلانية. التطبيق لا يحتوي على أي حزمة إعلانات ولا أي
            أداة تحليلات خارجية، ولا يتتبّعك عبر تطبيقات أو مواقع أخرى.
          </p>
        </section>

        <section>
          <h2>من يرى بياناتي غيركم؟</h2>
          <p>ثلاث جهات فقط، وكلٌّ منها يرى الحد الأدنى الذي يحتاجه:</p>
          <ul>
            <li>
              <strong>المطعم أو الماركت</strong> الذي طلبت منه: اسمك، وعنوان التوصيل، ومحتوى الطلب.
            </li>
            <li>
              <strong>مندوب التوصيل</strong> المكلَّف بطلبك: اسمك، ورقم هاتفك، والعنوان — أثناء
              التوصيل.
            </li>
            <li>
              <strong>مزوّد إرسال رمز الدخول</strong> (OTPIQ): رقم هاتفك ورمز التحقق فقط، ليصلك عبر
              واتساب أو رسالة نصية.
            </li>
          </ul>
          <p>
            إضافة إلى ذلك، تُخزَّن البيانات لدى مزوّدي الاستضافة وقاعدة البيانات الذين نتعامل معهم،
            وتُرسَل الإشعارات عبر خدمة إشعارات الهاتف. لا أحد منهم يستخدم بياناتك لأغراضه.
          </p>
        </section>

        <section>
          <h2>كيف تحمون رقم هاتفي عند الدخول؟</h2>
          <p>
            رمز التحقق لا يُحفظ كما هو — يُحفظ تجزئته (hash) فقط، مملّحة برقم الطلب نفسه، وتنتهي
            صلاحيته بعد دقائق ويُقفل بعد عدد محدود من المحاولات. نحفظ مع طلب الرمز عنوان IP ونوع
            المتصفح أو التطبيق، لمنع إغراق الخدمة بطلبات آلية.
          </p>
        </section>

        <section>
          <h2>كم تبقى بياناتي عندكم؟</h2>
          <p>
            ما دام حسابك قائماً. عند حذفه يُمسح كل ما في الجدول أعلاه إلا الصفّين الموسومين بأنهما
            يبقيان — وهما سجلّ الطلبات كسجلّ مالي، وسطر واحد يثبت أن الحذف تمّ.
          </p>
        </section>

        <section>
          <h2>ما حقوقي؟</h2>
          <p>
            أن ترى ما لدينا عنك، وأن تصحّحه من داخل التطبيق، وأن تحذف حسابك متى شئت دون أن تراسل
            أحداً — الزرّ داخل التطبيق نفسه. الطريقة مشروحة في{' '}
            <a href="/delete-account">صفحة حذف الحساب</a>.
          </p>
        </section>

        <section className="callout">
          <h2>الأطفال</h2>
          <p>
            جيبلي ليست موجّهة لمن هم دون ١٣ عاماً، ولا نجمع بيانات عنهم عن قصد. إن وصلنا أن حساباً
            يخصّ طفلاً، نحذفه.
          </p>
        </section>

        <section>
          <h2>إذا تغيّرت هذه السياسة</h2>
          <p>
            نحدّث التاريخ أدناه وننشر النسخة الجديدة هنا. التغيير الجوهري — جمع شيء جديد، أو مشاركة
            مع جهة جديدة — يظهر داخل التطبيق قبل أن يسري.
          </p>
        </section>
      </div>

      <p className="page__updated">آخر تحديث: {UPDATED}</p>
    </article>
  );
}
