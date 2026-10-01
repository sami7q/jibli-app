import { useState } from 'react';
import { Pressable, View } from 'react-native';
import MaterialCommunityIcons, { type IconName } from '@/ui/icon';
import type { OwnerReadiness } from '@/lib/api';
import {
  activationState,
  activationSteps,
  type ActivationAction,
  type ActivationStep,
} from '@/lib/owner-activation';

/** The steps the app itself can open a door to. */
export type DoorAction = 'product' | 'pin';
import { color, radius, ROW, space, TAP_TARGET } from '@/theme';
import { Button, Row, Skeleton, Text } from '@/ui';

/**
 * Why the shop is not live yet, and what to do about it — on the lobby.
 *
 * «قيد الإعداد» was the whole explanation an owner got. The checklist Admin
 * reads has always existed; this shows the same checks to the owner, sorted
 * so what is missing comes first, with a door for each thing that is theirs
 * to do and a plain "Jibli does this" for the rest. When every blocking check
 * passes, the card becomes the request button; once asked, it says so and
 * waits. When the shop goes live the card disappears.
 */
export function ActivationCard({
  readiness,
  loading,
  error,
  onRetry,
  onAction,
  onRequest,
  requesting,
  canRequest,
}: {
  readiness: OwnerReadiness | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  /** Open the door for a step the owner can finish in the app. */
  onAction: (action: DoorAction) => void;
  onRequest: () => void;
  requesting: boolean;
  canRequest: boolean;
}) {
  const [showDone, setShowDone] = useState(false);

  if (loading) {
    return <Skeleton height={120} style={{ borderRadius: radius.xl }} />;
  }

  if (error || !readiness) {
    return (
      <Frame icon="progress-question" tint={color.textSecondary} title="حالة التفعيل">
        <Text variant="small" tone="secondary">
          تعذّر قراءة حالة المتجر.
        </Text>
        <Button label="إعادة المحاولة" variant="secondary" onPress={onRetry} />
      </Frame>
    );
  }

  const state = activationState(readiness);
  if (state.kind === 'live') return null;

  if (state.kind === 'suspended') {
    return (
      <Frame icon="pause-circle-outline" tint={color.dangerStrong} title="متجرك موقوف مؤقتاً">
        <Text variant="small" tone="secondary">
          أوقف فريق جيبلي استقبال الطلبات لهذا المتجر. تواصل معهم لمعرفة السبب وإعادته.
        </Text>
      </Frame>
    );
  }

  if (state.kind === 'requested') {
    return (
      <Frame icon="clock-check-outline" tint={color.warningStrong} title="طُلب التفعيل">
        <Text variant="small" tone="secondary">
          وصل طلبك إلى فريق جيبلي في {formatDay(state.since)}. يفعّلون المتجر من لوحة الإدارة، وتصلك
          الطلبات فور ذلك.
        </Text>
        {readiness.activation_request_note ? (
          <Text variant="caption" tone="muted">
            ملاحظتك: {readiness.activation_request_note}
          </Text>
        ) : null}
      </Frame>
    );
  }

  const steps = activationSteps(readiness);
  const todo = steps.filter((step) => !step.done);
  const done = steps.filter((step) => step.done);

  if (state.kind === 'ready') {
    return (
      <Frame icon="check-decagram-outline" tint={color.success} title="متجرك جاهز للتفعيل">
        <Text variant="small" tone="secondary">
          اكتملت كل الخطوات المطلوبة. اطلب التفعيل ليفتحه فريق جيبلي للزبائن.
        </Text>
        {canRequest ? (
          <Button
            label="اطلب التفعيل من جيبلي"
            block
            loading={requesting}
            disabled={requesting}
            onPress={onRequest}
          />
        ) : (
          <Text variant="caption" tone="muted">
            طلب التفعيل يحتاج صلاحية صاحب المتجر.
          </Text>
        )}
        {todo.length > 0 ? (
          <StepList steps={todo} heading="يُستحسن قبل الفتح" onAction={onAction} />
        ) : null}
      </Frame>
    );
  }

  const mine = todo.filter((step) => step.blocking && step.action !== 'admin');
  const jibli = todo.filter((step) => step.blocking && step.action === 'admin');
  const optional = todo.filter((step) => !step.blocking);

  return (
    <Frame
      icon="progress-wrench"
      tint={color.brand}
      title={
        state.mine > 0
          ? `لتفعيل متجرك بقيت ${state.remaining === 1 ? 'خطوة واحدة' : `${state.remaining} خطوات`}`
          : 'بانتظار فريق جيبلي'
      }
    >
      <Text variant="small" tone="secondary">
        {state.mine > 0
          ? 'لا يظهر المتجر للزبائن قبل التفعيل. أكمل ما يخصك من هنا، والباقي يكمله فريق جيبلي.'
          : 'ما يخصك مكتمل. بقيت خطوات يكملها فريق جيبلي من لوحة الإدارة، ثم يفعّل المتجر.'}
      </Text>

      {mine.length > 0 ? <StepList steps={mine} heading="عليك" onAction={onAction} /> : null}
      {jibli.length > 0 ? (
        <StepList steps={jibli} heading="يكمله فريق جيبلي" onAction={onAction} />
      ) : null}
      {optional.length > 0 ? (
        <StepList steps={optional} heading="اختياري" onAction={onAction} />
      ) : null}

      {done.length > 0 ? (
        <Pressable
          onPress={() => setShowDone((value) => !value)}
          accessibilityRole="button"
          accessibilityState={{ expanded: showDone }}
          style={{ minHeight: TAP_TARGET - 8, justifyContent: 'center' }}
        >
          <Row gap={space[1]}>
            <MaterialCommunityIcons
              name={showDone ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={color.textMuted}
            />
            <Text variant="caption" tone="muted">
              {showDone ? 'إخفاء المكتمل' : `مكتمل (${done.length})`}
            </Text>
          </Row>
        </Pressable>
      ) : null}
      {showDone ? <StepList steps={done} onAction={onAction} /> : null}
    </Frame>
  );
}

function Frame({
  icon,
  tint,
  title,
  children,
}: {
  icon: IconName;
  tint: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        padding: space[4],
        gap: space[3],
        borderRadius: radius.xl,
        backgroundColor: color.surfaceCard,
        borderWidth: 1,
        borderColor: color.borderSubtle,
      }}
    >
      <Row gap={space[2]}>
        <MaterialCommunityIcons name={icon} size={24} color={tint} />
        <Text variant="bodyBold" style={{ flex: 1 }}>
          {title}
        </Text>
      </Row>
      {children}
    </View>
  );
}

function StepList({
  steps,
  heading,
  onAction,
}: {
  steps: ActivationStep[];
  heading?: string;
  onAction: (action: DoorAction) => void;
}) {
  return (
    <View style={{ gap: space[2] }}>
      {heading ? (
        <Text variant="captionBold" tone="muted">
          {heading}
        </Text>
      ) : null}
      {steps.map((step) => (
        <StepRow key={step.key} step={step} onAction={onAction} />
      ))}
    </View>
  );
}

const DOOR_LABEL: Record<ActivationAction, string | null> = {
  product: 'أضف منتجاً',
  pin: 'ثبّت الموقع',
  portal: 'لوحة التحكم',
  admin: null,
};

function StepRow({
  step,
  onAction,
}: {
  step: ActivationStep;
  onAction: (action: DoorAction) => void;
}) {
  const door = doorOf(step);
  const body = (
    <>
      <MaterialCommunityIcons
        name={step.done ? 'check-circle' : step.blocking ? 'circle-outline' : 'circle-small'}
        size={22}
        color={step.done ? color.success : step.blocking ? color.brand : color.textMuted}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant={step.done ? 'small' : 'smallBold'} tone={step.done ? 'muted' : 'primary'}>
          {step.label}
        </Text>
        {!step.done ? (
          <Text variant="caption" tone="muted">
            {step.hint}
          </Text>
        ) : null}
      </View>
      {door ? (
        <View
          style={{
            paddingVertical: space[1],
            paddingHorizontal: space[3],
            borderRadius: radius.full,
            backgroundColor: color.brand,
          }}
        >
          <Text variant="captionBold" tone="inverse">
            {DOOR_LABEL[step.action]}
          </Text>
        </View>
      ) : !step.done && DOOR_LABEL[step.action] ? (
        <Text variant="caption" tone="muted">
          {DOOR_LABEL[step.action]}
        </Text>
      ) : null}
    </>
  );

  const style = {
    flexDirection: ROW,
    alignItems: 'center' as const,
    gap: space[2],
    minHeight: TAP_TARGET,
    paddingVertical: space[1],
  };

  if (!door) return <View style={style}>{body}</View>;

  return (
    <Pressable
      onPress={() => onAction(door)}
      accessibilityRole="button"
      accessibilityLabel={`${step.label} — ${DOOR_LABEL[step.action] ?? ''}`}
      style={({ pressed }) => [style, pressed ? { opacity: 0.8 } : null]}
    >
      {body}
    </Pressable>
  );
}

/** The door for a step that is not done and that the app can open. */
function doorOf(step: ActivationStep): DoorAction | null {
  if (step.done) return null;
  return step.action === 'product' || step.action === 'pin' ? step.action : null;
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'وقت سابق';
  return new Intl.DateTimeFormat('ar-IQ', { day: 'numeric', month: 'long' }).format(date);
}
