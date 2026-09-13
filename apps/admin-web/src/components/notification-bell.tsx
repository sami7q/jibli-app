'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { relativeAr } from '@jibli/ui-web';
import { Icon } from '@/components/icon';
import { admin, type AdminNotification } from '@/lib/admin-endpoints';

/**
 * The bell.
 *
 * Until now it was a link to the applications screen with a count on it, which
 * answered one question and only by being hard-coded to it. Things happen on
 * this platform that nobody was told about: a restaurant applies, asks to go
 * live, sends a support message, gets a one-star review. Each of those sat in
 * the database waiting for somebody to think of checking the right screen.
 *
 * Polled rather than pushed. The realtime channel exists and carries order
 * events, but a notification that arrives a minute late costs nothing, and a
 * second socket subscription on every Admin tab costs a connection each.
 *
 * The count is its own request. Rendering one number is not worth shipping
 * thirty rows of Arabic text every minute to every operator.
 */

const POLL_MS = 60_000;

const SEVERITY_ICON = {
  INFO: 'info',
  ATTENTION: 'alert',
  URGENT: 'alert',
} as const;

export function NotificationBell({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  const unread = useQuery({
    queryKey: ['admin-notifications-unread'],
    queryFn: () => admin.unreadNotificationCount(token),
    refetchInterval: POLL_MS,
    // Coming back to a tab that has been open all afternoon should not show a
    // count from lunchtime.
    refetchOnWindowFocus: true,
    enabled: token !== '',
  });

  const list = useQuery({
    queryKey: ['admin-notifications'],
    queryFn: () => admin.notifications(token, 20),
    // Only when the panel is open: the closed bell needs a number, not a list.
    enabled: open && token !== '',
  });

  const markRead = useMutation({
    mutationFn: (ids?: string[]) => admin.markNotificationsRead(token, ids),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-notifications-unread'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-notifications'] });
    },
  });

  // Close on an outside click or Escape, like every other menu in the portal.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const count = unread.data?.unread ?? 0;
  const notifications = list.data ?? [];

  return (
    <div className="bell-wrap" ref={container}>
      {/*
        The count lives in the accessible name too: a red dot on a bell says
        nothing to a screen reader (plan §134).
      */}
      <button
        type="button"
        className="bell"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={
          count === 0 ? 'لا توجد إشعارات جديدة' : `${count} إشعار جديد`
        }
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="bell" className="nav__icon" aria-hidden />
        {count > 0 ? (
          <span className="bell__badge" aria-hidden>
            {count > 9 ? '9+' : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="notifications" role="menu">
          <div className="notifications__head">
            <strong>الإشعارات</strong>
            {count > 0 ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={markRead.isPending}
                onClick={() => markRead.mutate(undefined)}
              >
                تعليم الكل كمقروء
              </button>
            ) : null}
          </div>

          {list.isLoading ? (
            <p className="notifications__empty">جارٍ التحميل…</p>
          ) : notifications.length === 0 ? (
            <p className="notifications__empty">لا توجد إشعارات</p>
          ) : (
            <ul className="notifications__list">
              {notifications.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  onOpen={() => {
                    // Opening one is what "I have seen this" means; a separate
                    // dismiss button makes the operator do the work twice.
                    if (!notification.is_read) markRead.mutate([notification.id]);
                    setOpen(false);
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function NotificationRow({
  notification,
  onOpen,
}: {
  notification: AdminNotification;
  onOpen: () => void;
}) {
  const body = (
    <>
      <Icon
        name={SEVERITY_ICON[notification.severity] ?? 'info'}
        className="nav__icon"
        aria-hidden
      />
      <span className="notification__text">
        <span className="notification__title">{notification.title_ar}</span>
        {notification.body_ar ? (
          <span className="notification__body">{notification.body_ar}</span>
        ) : null}
        <span className="notification__time">{relativeAr(notification.created_at)}</span>
      </span>
    </>
  );

  const className = `notification notification--${notification.severity.toLowerCase()}${
    notification.is_read ? '' : ' notification--unread'
  }`;

  return (
    <li>
      {notification.link_path ? (
        <Link href={notification.link_path} className={className} onClick={onOpen} role="menuitem">
          {body}
        </Link>
      ) : (
        <button type="button" className={className} onClick={onOpen} role="menuitem">
          {body}
        </button>
      )}
    </li>
  );
}
