'use client';

import { useEffect, useRef, useState } from 'react';
import { overdueOrders } from '@/lib/overdue-orders';
import { useLiveOrders } from '@/lib/use-live-orders';
import { Icon } from './icon';

const STORAGE_KEY = 'jibli.admin.order-sound';

/**
 * A cash register for every new order, across the whole platform.
 *
 * The operator watching an evening had to keep «الطلبات الحية» open and look
 * at it; nothing announced an order arriving. This polls the live orders
 * every fifteen seconds from any screen and plays the same «ka-ching» the
 * shops hear for each order it has not seen before.
 *
 * Browsers will not play sound until the page has been clicked, so it starts
 * as a button that says so; one click turns it on and is remembered. The
 * same button mutes it. The first poll after turning on only learns what is
 * already there — it rings for what arrives next, not for the backlog.
 *
 * While any order has waited three minutes for its shop to accept, it rings
 * again every minute, alongside the «لم يُقبل بعد» alert in the shell.
 */
export function OrderSound({ token }: { token: string }) {
  const [enabled, setEnabled] = useState(false);
  const context = useRef<AudioContext | null>(null);
  const buffer = useRef<AudioBuffer | null>(null);
  const seen = useRef<Set<string> | null>(null);

  // Remembered choice; the context itself still needs this session's click.
  const [wanted, setWanted] = useState(false);
  useEffect(() => {
    try {
      setWanted(window.localStorage.getItem(STORAGE_KEY) === 'on');
    } catch {
      // Private mode: start off.
    }
  }, []);

  const open = async () => {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    context.current ??= new Ctor();
    if (context.current.state === 'suspended') await context.current.resume();
    if (!buffer.current) {
      try {
        const response = await fetch('/sounds/new-order.wav');
        buffer.current = await context.current.decodeAudioData(await response.arrayBuffer());
      } catch {
        // Without the file there is nothing to play; the button still shows on.
      }
    }
  };

  const ring = () => {
    const ctx = context.current;
    if (!ctx || !buffer.current || ctx.state !== 'running') return;
    const source = ctx.createBufferSource();
    source.buffer = buffer.current;
    source.connect(ctx.destination);
    source.start();
  };

  const toggle = async () => {
    if (enabled) {
      setEnabled(false);
      setWanted(false);
      try {
        window.localStorage.setItem(STORAGE_KEY, 'off');
      } catch {
        // Not remembered in private mode; it is still off for this visit.
      }
      return;
    }
    await open();
    seen.current = null;
    setEnabled(true);
    setWanted(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, 'on');
    } catch {
      // Not remembered in private mode; it is still on for this visit.
    }
    ring();
  };

  const live = useLiveOrders(token);

  useEffect(() => {
    const rows = live.data?.data;
    if (!rows || !enabled) return;
    const ids = rows.map((order) => order.id);
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const fresh = ids.filter((id) => !seen.current?.has(id));
    for (const id of ids) seen.current.add(id);
    if (fresh.length > 0) ring();
  }, [live.data, enabled]);

  // The reminder: once a minute while a shop has left an order unaccepted.
  const rows = live.data?.data;
  useEffect(() => {
    if (!enabled || !rows) return;
    const timer = window.setInterval(() => {
      if (overdueOrders(rows, Date.now()).length > 0) ring();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [rows, enabled]);

  const label = enabled ? 'صوت الطلبات مفعّل' : wanted ? 'اضغط لتشغيل الصوت' : 'تشغيل صوت الطلبات';

  return (
    <button
      type="button"
      className="topbar__control"
      onClick={() => void toggle()}
      aria-pressed={enabled}
      title={enabled ? 'كتم صوت الطلبات الجديدة' : 'تشغيل صوت عند كل طلب جديد'}
      style={{
        cursor: 'pointer',
        border: 'none',
        color: enabled ? 'var(--jibli-orange-600)' : 'inherit',
        fontWeight: 600,
      }}
    >
      <Icon name={enabled ? 'volume' : 'bell'} className="nav__icon" aria-hidden />
      <span>{label}</span>
    </button>
  );
}
