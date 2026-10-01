import type { OwnerReadiness } from './api';

/**
 * Going live, from the shop's side — the readiness checklist read as a to-do.
 *
 * Admin has always seen the twelve checks; the owner saw «قيد الإعداد» and
 * nothing else, and the only way to learn what was missing was to phone Jibli.
 * This turns each failing check into a step with a door: the product form,
 * the settings screen, the web portal, or "Jibli does this" — so the owner
 * can finish what is theirs and knows which part is not.
 *
 * No React here, so the sentences and the state machine are pinned by a test.
 */

/** Where a step is completed: in the app, on the portal, or by Jibli. */
export type ActivationAction = 'product' | 'pin' | 'portal' | 'admin';

export interface ActivationStep {
  readonly key: string;
  readonly label: string;
  readonly done: boolean;
  readonly blocking: boolean;
  readonly action: ActivationAction;
  /** What to do about it, in the owner's words. */
  readonly hint: string;
}

const STEP_META: Record<string, { action: ActivationAction; hint: string }> = {
  hasActiveMenuItem: { action: 'product', hint: 'أضف منتجاً واحداً على الأقل، بصورة وسعر.' },
  branchLocationValid: {
    action: 'pin',
    hint: 'ثبّت موقع المتجر على الخريطة ليصل المندوب إلى بابك مباشرة.',
  },
  workingHoursConfigured: {
    action: 'portal',
    hint: 'تُضبط تلقائياً عند التفعيل (٨ صباحاً – ١١ مساءً)، وتعدّلها من لوحة التحكم.',
  },
  hasActiveDriver: {
    action: 'portal',
    hint: 'اختياري: أضف مندوبك من لوحة التحكم، أو يوصّل مندوبو جيبلي.',
  },
  cityOrderingEnabled: { action: 'admin', hint: 'تفتح جيبلي الطلبات في مدينتك.' },
  applicationApproved: { action: 'admin', hint: 'موافقة فريق جيبلي على المتجر.' },
  ownerActive: { action: 'admin', hint: 'حساب المالك، يفعّله فريق جيبلي.' },
  commissionConfigured: { action: 'admin', hint: 'يضبطه فريق جيبلي.' },
  settlementPolicyConfigured: { action: 'admin', hint: 'يضبطها فريق جيبلي.' },
  deliveryConfigured: { action: 'admin', hint: 'يضبطه فريق جيبلي.' },
  orderAlertAcknowledged: { action: 'admin', hint: 'يتأكد منه فريق جيبلي.' },
  requiredDocumentsPresent: { action: 'admin', hint: 'يستكملها فريق جيبلي معك.' },
};

/** Every check the owner should see, failing ones first and the blocking ones before the rest. */
export function activationSteps(readiness: Pick<OwnerReadiness, 'checks'>): ActivationStep[] {
  return readiness.checks
    .map((check) => ({
      key: check.key,
      label: check.label_ar,
      done: check.passed,
      blocking: check.blocking,
      action: STEP_META[check.key]?.action ?? 'admin',
      hint: STEP_META[check.key]?.hint ?? 'يتولاه فريق جيبلي.',
    }))
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;
      return 0;
    });
}

export type ActivationState =
  /** Taking orders. Nothing to show. */
  | { readonly kind: 'live' }
  /** Stopped by Jibli; the way back is a conversation, not a checklist. */
  | { readonly kind: 'suspended' }
  /** Something the owner can do is still missing. */
  | { readonly kind: 'todo'; readonly remaining: number; readonly mine: number }
  /** Everything blocking passes; Jibli has not been asked yet. */
  | { readonly kind: 'ready' }
  /** Asked, and waiting on Jibli. */
  | { readonly kind: 'requested'; readonly since: string };

export function activationState(
  readiness: Pick<
    OwnerReadiness,
    'checks' | 'ready' | 'operational_status' | 'activation_requested_at'
  >,
): ActivationState {
  if (readiness.operational_status === 'ACTIVE') return { kind: 'live' };
  if (readiness.operational_status === 'SUSPENDED') return { kind: 'suspended' };
  if (readiness.activation_requested_at) {
    return { kind: 'requested', since: readiness.activation_requested_at };
  }
  if (readiness.ready) return { kind: 'ready' };
  const steps = activationSteps(readiness).filter((step) => !step.done && step.blocking);
  return {
    kind: 'todo',
    remaining: steps.length,
    mine: steps.filter((step) => step.action === 'product' || step.action === 'pin').length,
  };
}
