import type { ReactElement } from 'react';

/**
 * The index.
 *
 * Exists because a bare domain that 404s reads as a broken company to anyone
 * who trims the URL — a store reviewer among them. Three cards, no marketing.
 */
export default function IndexPage(): ReactElement {
  const PAGES = [
    {
      href: '/privacy',
      title: 'سياسة الخصوصية',
      body: 'كل ما نحفظه عنك بالاسم، ولماذا، ومتى يُحذف.',
    },
    {
      href: '/terms',
      title: 'الشروط والأحكام',
      body: 'الاتفاق بينك وبين جيبلي: الطلب، الدفع، الإلغاء، والمسؤولية.',
    },
    {
      href: '/delete-account',
      title: 'حذف الحساب',
      body: 'الخطوات من داخل التطبيق، وما الذي يُمسح وما الذي يبقى.',
    },
  ] as const;

  return (
    <article className="page">
      <p className="page__eyebrow">جيبلي</p>
      <h1 className="page__title">الخصوصية والشروط</h1>
      <p className="page__standfirst">
        المستندات الرسمية لتطبيق جيبلي — توصيل الطعام والمواد الغذائية داخل العراق.
      </p>

      <nav className="cards" aria-label="المستندات">
        {PAGES.map((page) => (
          <a className="card" href={page.href} key={page.href}>
            <h2 className="card__title">{page.title}</h2>
            <p className="card__body">{page.body}</p>
          </a>
        ))}
      </nav>
    </article>
  );
}
