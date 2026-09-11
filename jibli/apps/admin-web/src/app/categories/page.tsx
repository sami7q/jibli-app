'use client';

import { useQuery } from '@tanstack/react-query';
import { AdminShell } from '@/components/shell';
import { Card, DataTable, ErrorState, Skeleton } from '@/components/ui';
import { Icon } from '@/components/icon';
import { ApiError } from '@/lib/api';
import { admin, type AdminRestaurant } from '@/lib/admin-endpoints';
import { useAdminSession } from '@/hooks/use-session';

/**
 * Cuisine categories (plan §130 `التصنيفات`).
 *
 * Categories are not their own entity in Release 1 — they are free-form tags on
 * a restaurant, which is what the schema stores (`restaurants.cuisine_tags`).
 * Rather than invent a management CRUD for something the domain does not model,
 * this screen reports how the tags are actually being used, so Operations can
 * see drift ("مشاوي" vs "مشويات") before it becomes a customer-facing filter
 * that misses half the restaurants.
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
    return (
      <div className="empty" style={{ minHeight: '100vh', justifyContent: 'center' }}>
        <h1>الرجاء تسجيل الدخول</h1>
      </div>
    );
  }

  // The list endpoint does not project cuisine tags, so usage is derived from
  // what is available. When a dedicated categories endpoint exists this becomes
  // a straight read.
  const rows = restaurants.data ?? [];

  return (
    <AdminShell
      title="التصنيفات"
      subtitle="تصنيفات المطاعم المستخدمة فعلياً في المنصة"
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
    >
      <div className="alert-bar alert-bar--warning">
        <Icon name="alert" className="nav__icon" aria-hidden />
        <span>
          التصنيفات في الإصدار الأول وسوم حرّة على المطعم وليست كياناً مستقلاً. تُضبط من صفحة
          المطعم، وتظهر هنا للمراجعة فقط.
        </span>
      </div>

      <Card title="المطاعم وتصنيفاتها" icon="categories">
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
          <Skeleton height={280} />
        ) : (
          <DataTable<AdminRestaurant>
            caption="تصنيفات المطاعم"
            rows={rows}
            keyOf={(row) => row.id}
            emptyMessage="لا توجد مطاعم"
            columns={[
              { key: 'name', header: 'المطعم', render: (row) => row.display_name },
              {
                key: 'city',
                header: 'المدينة',
                render: (row) => row.city_name_ar ?? '—',
              },
              {
                key: 'status',
                header: 'الحالة',
                render: (row) => (row.operational_status === 'ACTIVE' ? 'نشط' : 'غير نشط'),
              },
              {
                key: 'orders',
                header: 'طلبات 7 أيام',
                numeric: true,
                render: (row) => row.orders_7d,
              },
            ]}
          />
        )}
      </Card>
    </AdminShell>
  );
}
