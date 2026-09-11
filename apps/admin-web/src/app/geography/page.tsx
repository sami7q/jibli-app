'use client';

import { AdminShell } from '@/components/shell';
import { GeographyCoverage } from '@/components/geography-coverage';
import { useAdminSession } from '@/hooks/use-session';
import { SignedOut } from '@/components/signed-out';

/**
 * `المناطق والتغطية` (plan §8.8).
 *
 * Operations opens a new city from here following the staged rollout of
 * plan §124: restaurant onboarding first, ordering last.
 */
export default function GeographyPage() {
  const session = useAdminSession();

  if (session.status !== 'authenticated') {
    return <SignedOut reason={session.status === 'unauthenticated' ? session.reason : undefined} />;
  }

  return (
    <AdminShell
      title="المناطق والتغطية"
      subtitle="تحكّم مركزي في تسجيل العملاء وانضمام المطاعم وتفعيل الطلبات لكل محافظة ومدينة"
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
