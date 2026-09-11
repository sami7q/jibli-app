/**
 * Audible new-order alert manager (plan §30).
 *
 * Requirements from the plan:
 *   - a distinct audible alert on a new order
 *   - a browser notification when permission exists
 *   - a tab/title badge update
 *   - a repeated/escalated alert if not acknowledged
 *   - deduplication, so several orders do not create overlapping loops
 *   - sound is never the ONLY indication of a new order
 *
 * Browsers block uninitiated autoplay, so the audio context is created only
 * after an explicit user gesture — the `تفعيل تنبيهات الطلبات` button.
 */

export type AlertPermission = 'unknown' | 'granted' | 'denied';

export interface AlertManagerOptions {
  /** How long an unacknowledged order waits before the alert repeats. */
  readonly repeatIntervalMs?: number;
  /** After this long unacknowledged, the tone becomes more insistent. */
  readonly escalateAfterMs?: number;
  readonly onStateChange?: (state: AlertState) => void;
}

export interface AlertState {
  readonly enabled: boolean;
  readonly notificationPermission: AlertPermission;
  readonly pendingOrderIds: string[];
}

const DEFAULT_REPEAT_MS = 20_000;
const DEFAULT_ESCALATE_MS = 60_000;

export class OrderAlertManager {
  private audioContext: AudioContext | null = null;
  private enabled = false;
  private readonly pending = new Map<string, { firstSeenAt: number; lastAlertedAt: number }>();
  /** Orders already announced, so a realtime replay cannot re-trigger a chime. */
  private readonly announced = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly options: Required<Omit<AlertManagerOptions, 'onStateChange'>> & {
    onStateChange?: (state: AlertState) => void;
  };
  private originalTitle = '';

  constructor(options: AlertManagerOptions = {}) {
    this.options = {
      repeatIntervalMs: options.repeatIntervalMs ?? DEFAULT_REPEAT_MS,
      escalateAfterMs: options.escalateAfterMs ?? DEFAULT_ESCALATE_MS,
      ...(options.onStateChange ? { onStateChange: options.onStateChange } : {}),
    };
  }

  /**
   * Activate alerts. MUST be called from a click handler: creating an
   * AudioContext outside a user gesture leaves it suspended, and the restaurant
   * would silently get no sound at all.
   */
  async enable(): Promise<AlertState> {
    if (typeof window === 'undefined') return this.state();

    this.originalTitle = document.title;

    try {
      const AudioCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtor) {
        this.audioContext = new AudioCtor();
        // Safari starts suspended even inside a gesture unless resumed.
        if (this.audioContext.state === 'suspended') await this.audioContext.resume();
      }
      this.enabled = true;
    } catch {
      // Audio unavailable is not fatal: the visual alert still works.
      this.enabled = false;
    }

    if ('Notification' in window && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch {
        /* permission prompt refused or unavailable */
      }
    }

    this.startLoop();
    this.emit();
    return this.state();
  }

  disable(): void {
    this.enabled = false;
    this.stopLoop();
    void this.audioContext?.close();
    this.audioContext = null;
    this.restoreTitle();
    this.emit();
  }

  /**
   * Report the currently pending order IDs.
   *
   * Called with the full set after every poll or realtime event. Because it is
   * a set rather than a stream of deltas, a duplicated realtime event or a
   * reconnect delta-sync cannot produce a second chime for the same order.
   */
  syncPending(orderIds: readonly string[]): void {
    const now = Date.now();
    const incoming = new Set(orderIds);

    for (const id of this.pending.keys()) {
      if (!incoming.has(id)) this.pending.delete(id);
    }

    let hasNew = false;
    for (const id of incoming) {
      if (!this.pending.has(id)) {
        this.pending.set(id, { firstSeenAt: now, lastAlertedAt: now });
        if (!this.announced.has(id)) {
          this.announced.add(id);
          hasNew = true;
        }
      }
    }

    if (hasNew) this.fire(false);
    this.updateTitle();
    this.emit();
  }

  /** Staff acknowledged an order; stop alerting for it. */
  acknowledge(orderId: string): void {
    this.pending.delete(orderId);
    this.updateTitle();
    this.emit();
  }

  acknowledgeAll(): void {
    this.pending.clear();
    this.updateTitle();
    this.emit();
  }

  state(): AlertState {
    return {
      enabled: this.enabled,
      notificationPermission: this.notificationPermission(),
      pendingOrderIds: [...this.pending.keys()],
    };
  }

  private notificationPermission(): AlertPermission {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unknown';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    return 'unknown';
  }

  private startLoop(): void {
    this.stopLoop();
    // One timer for all pending orders — never one loop per order, which is how
    // overlapping alarms happen (plan §30).
    this.timer = setInterval(() => this.tick(), 5_000);
  }

  private stopLoop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    if (!this.enabled || this.pending.size === 0) return;
    const now = Date.now();

    let shouldAlert = false;
    let shouldEscalate = false;

    for (const [, entry] of this.pending) {
      if (now - entry.lastAlertedAt >= this.options.repeatIntervalMs) {
        shouldAlert = true;
        entry.lastAlertedAt = now;
        if (now - entry.firstSeenAt >= this.options.escalateAfterMs) shouldEscalate = true;
      }
    }

    // One chime per tick regardless of how many orders are waiting.
    if (shouldAlert) this.fire(shouldEscalate);
    this.updateTitle();
  }

  private fire(escalated: boolean): void {
    this.playChime(escalated);
    this.showNotification(escalated);
  }

  /**
   * Synthesise the chime rather than loading an audio file: no asset to fail on
   * a weak connection, and no autoplay-blocked <audio> element.
   */
  private playChime(escalated: boolean): void {
    const context = this.audioContext;
    if (!context || context.state !== 'running') return;

    // Two rising notes; the escalated version is a third higher and repeats.
    const notes = escalated ? [880, 1174, 880, 1174] : [784, 1046];
    const noteDuration = 0.16;

    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;

      const startAt = context.currentTime + index * (noteDuration + 0.05);
      // Ramp rather than switch: an abrupt gain change clicks audibly.
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(escalated ? 0.3 : 0.18, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + noteDuration);

      oscillator.connect(gain).connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + noteDuration + 0.02);
    });
  }

  private showNotification(escalated: boolean): void {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    // A notification while the tab is focused is noise; the board is visible.
    if (document.visibilityState === 'visible' && !escalated) return;

    const count = this.pending.size;
    try {
      new Notification(escalated ? 'طلبات بانتظار القبول!' : 'طلب جديد', {
        body:
          count === 1
            ? 'وصل طلب جديد بانتظار القبول'
            : `${count} طلبات بانتظار القبول`,
        // A tag replaces the previous notification instead of stacking them.
        tag: 'jibli-new-orders',
        requireInteraction: escalated,
      });
    } catch {
      /* notification construction can throw on some platforms */
    }
  }

  /** Title badge — the alert that works even with sound off (plan §30). */
  private updateTitle(): void {
    if (typeof document === 'undefined') return;
    const count = this.pending.size;
    document.title = count > 0 ? `(${count}) طلبات جديدة — ${this.originalTitle}` : this.originalTitle;
  }

  private restoreTitle(): void {
    if (typeof document !== 'undefined' && this.originalTitle) {
      document.title = this.originalTitle;
    }
  }

  private emit(): void {
    this.options.onStateChange?.(this.state());
  }
}
