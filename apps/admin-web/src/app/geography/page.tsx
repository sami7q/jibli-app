'use client';

import { AdminShell } from '@/components/shell';
import { GeographyCoverage } from '@/components/geography-coverage';
import { SessionGate } from '@/components/session-gate';
import { useAdminSession } from '@/hooks/use-session';

/**
 * `المناطق والتغطية` (plan §8.8).
 *
 * Operations opens a new city from here following the staged rollout of
 * plan §124: restaurant onboarding first, ordering last.
 */
export default function GeographyPage() {
  const session = useAdminSession();

  if (session.status !== 'authenticated') {
    return <SessionGate session={session} />;
  }

  return (
    <AdminShell
      title="المناطق والتغطية"
      subtitle="مفتاح لكل مدينة: تسجيل العملاء، انضمام المطاعم، الطلبات"
      userName={session.userName}
      userRoleAr={session.roleAr}
    >
      <div className="alert-bar alert-bar--warning">
        <span>
          الترتيب الموصى به لفتح مدينة جديدة: فعّل انضمام المطاعم أولاً، ثم اعتمد المطاعم وأضف
          السائقين، ثم فعّل تسجيل العملاء، وأخيراً فعّل الطلبات.
        </span>
      </div>

      <GeographyCoverage token={session.accessToken} />
    </AdminShell>
  );
}
