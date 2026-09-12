'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { CUISINES, cuisineLabelAr, isKnownCuisine } from '@jibli/contracts';
import { AdminShell } from '@/components/shell';
import { Card, ErrorState, Skeleton } from '@/components/ui';
import { Icon } from '@/components/icon';
import { ApiError } from '@/lib/api';
import { admin } from '@/lib/admin-endpoints';
import { SessionGate } from '@/components/session-gate';
import { useAdminSession } from '@/hooks/use-session';

/**
 * Cuisine categories (plan §130 `التصنيفات`).
 *
 * The platform now ships a fixed vocabulary (`@jibli/contracts` → CUISINES),
 * which is what a restaurant is tagged with and what the customer app will
 * filter discovery by. This page is the map between that list and reality: how
 * many restaurants sit in each category, and which categories are still empty.
 *
 * It also surfaces tags that are not in the list at all. Restaurants created
 * before the vocabulary existed carry free text, and a filter that matches
 * nothing is invisible from the customer's side — this is where it becomes
 * visible from ours.
 */
export default function CategoriesPage() {
  const session = useAdminSession();
  const token = session.status === 'authenticated' ? session.accessToken : '';

  const restaurants = useQuery({
    queryKey: ['admin-restaurants', 'all-for-categories'],
    queryFn: () => admin.restaurants(token, {}),
    enabled: session.status === 'authenticated',
  });

  if (session.status !== 'authenticated') {
    return <SessionGate session={session} />;
  }

  const rows = restaurants.data ?? [];

  const counts = new Map<string, number>();
  for (const restaurant of rows) {
    for (const tag of restaurant.cuisine_tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  const unknown = [...counts.keys()].filter((tag) => !isKnownCuisine(tag)).sort();
  const untagged = rows.filter((restaurant) => (restaurant.cuisine_tags ?? []).length === 0).length;
  const busiest = Math.max(1, ...CUISINES.map((cuisine) => counts.get(cuisine.key) ?? 0));

  return (
    <AdminShell
      title="التصنيفات"
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
    >
      {untagged > 0 ? (
        <div className="alert-bar alert-bar--warning">
          <Icon name="alert" className="nav__icon" aria-hidden />
          <span>
            {untagged} مطعم بلا تصنيف — لن يظهر لعميل يتصفّح حسب النوع. التصنيف يُضبط من صفحة
            المطعم.
          </span>
        </div>
      ) : null}

      {unknown.length > 0 ? (
        <div className="alert-bar alert-bar--danger">
          <Icon name="alert" className="nav__icon" aria-hidden />
          <span>
            تصنيفات خارج القائمة المعتمدة: {unknown.join('، ')} — لن يطابقها بحث العملاء. عدّلها من
            صفحة المطعم.
          </span>
        </div>
      ) : null}

      <Card title="تصنيفات المنصة" icon="categories">
        {restaurants.isError ? (
          <ErrorState
            message={
              restaurants.error instanceof ApiError
                ? restaurants.error.messageAr
                : 'تعذّر تحميل المطاعم'
            }
            onRetry={() => void restaurants.refetch()}
          />
        ) : restaurants.isLoading ? (
          <Skeleton height={320} />
        ) : (
          <>
            <ul className="cuisine-grid">
              {CUISINES.map((cuisine) => {
                const count = counts.get(cuisine.key) ?? 0;
                return (
                  <li
                    key={cuisine.key}
                    className={`cuisine${count === 0 ? ' cuisine--empty' : ''}`}
                  >
                    <span className="cuisine__emoji" aria-hidden>
                      {cuisine.emoji}
                    </span>
                    <span className="cuisine__body">
                      <strong>{cuisine.labelAr}</strong>
                      <span className="cuisine__meta">
                        {count === 0 ? 'لا مطاعم بعد' : `${count} مطعم`}
                      </span>
                      {/*
                        The bar is relative to the busiest category, not to the
                        total: it answers "where are the restaurants?", which is
                        the question an operator opening this page has.
                      */}
                      <span className="cuisine__bar" aria-hidden>
                        <span style={{ inlineSize: `${(count / busiest) * 100}%` }} />
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>

            <p className="cuisine-note">
              قائمة ثابتة تتشاركها لوحة الإدارة وبوابة المطاعم وتطبيق العملاء. يُختار التصنيف عند{' '}
              <Link href="/restaurants/new">إضافة مطعم</Link> أو من صفحة المطعم لاحقاً.
            </p>
          </>
        )}
      </Card>

      {unknown.length > 0 ? (
        <Card title="وسوم قديمة خارج القائمة" icon="alert">
          <ul className="cuisine-grid">
            {unknown.map((tag) => (
              <li key={tag} className="cuisine cuisine--stray">
                <span className="cuisine__emoji" aria-hidden>
                  ⚠️
                </span>
                <span className="cuisine__body">
                  <strong>{cuisineLabelAr(tag)}</strong>
                  <span className="cuisine__meta">{counts.get(tag)} مطعم</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </AdminShell>
  );
}
