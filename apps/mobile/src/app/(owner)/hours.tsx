import { useEffect, useMemo, useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import MaterialCommunityIcons, { type IconName } from '@/ui/icon';
import { api, ApiError } from '@/lib/api';
import { notify } from '@/lib/dialog';
import { useOwner } from '@/lib/owner';
import {
  applyWindow,
  crossesMidnight,
  DAY_NAMES_AR,
  DAY_SHORT_AR,
  describeWindow,
  formatTimeAr,
  isUniform,
  PRESETS,
  sameWeek,
  setClosed,
  setDayWindow,
  sharedWindow,
  stepMinute,
  summarizeWeek,
  toPayload,
  validateWeek,
  weekFromServer,
  type DayHours,
} from '@/lib/owner-hours';
import { color, radius, ROW, space, TAP_TARGET } from '@/theme';
import { Button, EmptyState, ErrorState, Row, Screen, Skeleton, Text } from '@/ui';
import { OwnerHeader } from '@/ui/owner-header';

/**
 * Working hours, on a phone, in under a minute.
 *
 * One window for every day — a preset, or two times nudged by the half hour —
 * and a row of day chips to close Friday. Only a shop whose days differ opens
 * the seven-row form. A shop that was never given hours starts from the
 * default week, so "set your hours" is one look and one tap for most owners.
 */
export default function OwnerHoursScreen() {
  const router = useRouter();
  const owner = useOwner();
  const shop = owner.shop;
  const queryClient = useQueryClient();
  const canWrite = owner.can('settings.write');

  const settings = useQuery({
    queryKey: ['owner-settings', shop?.id],
    queryFn: () => api.ownerSettings(shop?.id as string),
    enabled: Boolean(shop?.id),
  });

  const loaded = useMemo(
    () => weekFromServer(settings.data?.working_hours),
    [settings.data?.working_hours],
  );
  const [week, setWeek] = useState<DayHours[] | null>(null);
  const [perDay, setPerDay] = useState(false);

  // Fill once the week arrives, and never over what somebody is editing.
  useEffect(() => {
    if (!settings.data || week !== null) return;
    setWeek(loaded.week);
    setPerDay(!isUniform(loaded.week));
  }, [settings.data, loaded.week, week]);

  const current = week ?? loaded.week;
  const shared = sharedWindow(current);
  const problem = validateWeek(current);
  const dirty = !loaded.configured || !sameWeek(current, loaded.week);

  const save = useMutation({
    mutationFn: () => api.ownerUpdateWorkingHours(shop?.id as string, toPayload(current)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner-settings', shop?.id] });
      // The activation card counts this step.
      await queryClient.invalidateQueries({ queryKey: ['owner-readiness', shop?.id] });
      notify('تم الحفظ', `أوقات العمل: ${summarizeWeek(current)}`);
      router.back();
    },
    onError: (caught) =>
      notify('تعذّر الحفظ', caught instanceof ApiError ? caught.messageAr : 'حاول مرة أخرى.'),
  });

  if (!shop) {
    return (
      <Screen edges={['top', 'bottom']}>
        <OwnerHeader title="أوقات العمل" />
        <EmptyState title="لا يوجد متجر مفتوح" body="ارجع واختر متجراً." />
      </Screen>
    );
  }

  const setShared = (opens: number, closes: number) => setWeek(applyWindow(current, opens, closes));

  return (
    <Screen scroll edges={['top', 'bottom']} padded={false}>
      <View style={{ padding: space[4], gap: space[4], paddingBottom: space[10] }}>
        <OwnerHeader title="أوقات العمل" />

        {settings.isLoading ? (
          <View style={{ gap: space[3] }}>
            <Skeleton height={88} style={{ borderRadius: radius.xl }} />
            <Skeleton height={120} style={{ borderRadius: radius.lg }} />
          </View>
        ) : settings.isError ? (
          <ErrorState message="تعذّر تحميل أوقات العمل" onRetry={() => void settings.refetch()} />
        ) : (
          <>
            <View
              style={{
                padding: space[4],
                gap: space[2],
                borderRadius: radius.xl,
                backgroundColor: color.brandSoft,
                borderWidth: 1,
                borderColor: color.borderSubtle,
              }}
            >
              <Row gap={space[2]}>
                <MaterialCommunityIcons name="clock-outline" size={22} color={color.brand} />
                <Text variant="bodyBold">متى يستقبل متجرك الطلبات؟</Text>
              </Row>
              <Text variant="small" tone="secondary">
                خارج هذه الأوقات يرى الزبون «مغلق الآن» ويعود لاحقاً. بتوقيت بغداد.
              </Text>
              {!loaded.configured ? (
                <Text variant="caption" tone="brand">
                  لم تُضبط بعد — هذه أوقات مقترحة، عدّلها إن لزم ثم احفظ.
                </Text>
              ) : null}
            </View>

            {/* ── One tap for the usual windows ─────────────────────── */}
            <View style={{ gap: space[2] }}>
              <Text variant="captionBold" tone="muted">
                اختر بسرعة
              </Text>
              <Row gap={space[2]} style={{ flexWrap: 'wrap' }}>
                {PRESETS.map((preset) => {
                  const active =
                    !perDay && shared.opens === preset.opens && shared.closes === preset.closes;
                  return (
                    <Pressable
                      key={preset.label}
                      disabled={!canWrite}
                      onPress={() => {
                        setPerDay(false);
                        setShared(preset.opens, preset.closes);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`الأوقات ${preset.label}`}
                      style={({ pressed }) => [
                        {
                          minHeight: TAP_TARGET - 8,
                          paddingHorizontal: space[3],
                          justifyContent: 'center',
                          borderRadius: radius.full,
                          borderWidth: 1,
                          borderColor: active ? color.brand : color.borderSubtle,
                          backgroundColor: active ? color.brand : color.surfaceCard,
                        },
                        pressed ? { opacity: 0.85 } : null,
                      ]}
                    >
                      <Text variant="smallBold" tone={active ? 'inverse' : 'primary'}>
                        {preset.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </Row>
            </View>

            {/* ── The same window every day, or not ──────────────────── */}
            <View
              style={{
                flexDirection: ROW,
                alignItems: 'center',
                gap: space[3],
                padding: space[3],
                borderRadius: radius.lg,
                backgroundColor: color.surfaceSunken,
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="smallBold">أوقات مختلفة لكل يوم</Text>
                <Text variant="caption" tone="muted">
                  {perDay ? 'كل يوم بوقته.' : 'الوقت نفسه كل يوم، وتختار الأيام المغلقة.'}
                </Text>
              </View>
              <Switch
                value={perDay}
                disabled={!canWrite}
                onValueChange={(value) => {
                  setPerDay(value);
                  if (!value) setShared(shared.opens, shared.closes);
                }}
                trackColor={{ true: color.brand, false: color.borderStrong }}
                accessibilityLabel="أوقات مختلفة لكل يوم"
              />
            </View>

            {!perDay ? (
              <View style={{ gap: space[3] }}>
                <Row gap={space[3]} align="flex-start">
                  <TimeStepper
                    label="يفتح"
                    value={shared.opens}
                    disabled={!canWrite}
                    onChange={(opens) => setShared(opens, shared.closes)}
                  />
                  <TimeStepper
                    label="يغلق"
                    value={shared.closes}
                    disabled={!canWrite}
                    onChange={(closes) => setShared(shared.opens, closes)}
                  />
                </Row>
                <WindowLine opens={shared.opens} closes={shared.closes} />

                <View style={{ gap: space[2] }}>
                  <Text variant="captionBold" tone="muted">
                    أيام العمل — اضغط يوماً لإغلاقه
                  </Text>
                  <Row gap={space[2]} style={{ flexWrap: 'wrap' }}>
                    {current.map((day) => (
                      <DayChip
                        key={day.day}
                        day={day}
                        disabled={!canWrite}
                        onToggle={() => setWeek(setClosed(current, day.day, !day.closed))}
                      />
                    ))}
                  </Row>
                </View>
              </View>
            ) : (
              <View style={{ gap: space[2] }}>
                {current.map((day) => (
                  <DayRow
                    key={day.day}
                    day={day}
                    disabled={!canWrite}
                    onClosed={(closed) => setWeek(setClosed(current, day.day, closed))}
                    onWindow={(patch) => setWeek(setDayWindow(current, day.day, patch))}
                  />
                ))}
              </View>
            )}

            <Text variant="small" tone="secondary" align="center">
              {summarizeWeek(current)}
            </Text>

            {problem ? (
              <Text variant="caption" tone="danger" align="center">
                {problem}
              </Text>
            ) : null}

            {canWrite ? (
              <Button
                label={
                  save.isPending
                    ? 'جارٍ الحفظ…'
                    : dirty
                      ? loaded.configured
                        ? 'حفظ أوقات العمل'
                        : 'اعتماد هذه الأوقات'
                      : 'لا تغييرات'
                }
                block
                size="lg"
                disabled={!dirty || Boolean(problem) || save.isPending}
                loading={save.isPending}
                onPress={() => save.mutate()}
              />
            ) : (
              <Text variant="caption" tone="muted" align="center">
                حسابك يستطيع العرض فقط. التعديل يحتاج صلاحية من صاحب المتجر.
              </Text>
            )}

            <Text variant="caption" tone="muted" align="center">
              العطل والأيام الاستثنائية تُضاف من لوحة التحكم على المتصفّح.
            </Text>
          </>
        )}
      </View>
    </Screen>
  );
}

/** A time nudged by the half hour: no wheel, no keyboard, nothing to mistype. */
function TimeStepper({
  label,
  value,
  disabled,
  onChange,
  compact = false,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (minute: number) => void;
  /** Narrower buttons and a smaller time, for a row that shares the width with another. */
  compact?: boolean;
}) {
  return (
    <View style={{ flex: 1, gap: space[1] }}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <View
        style={{
          flexDirection: ROW,
          alignItems: 'center',
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: color.borderSubtle,
          backgroundColor: color.surfaceCard,
          overflow: 'hidden',
        }}
      >
        <StepButton
          icon="minus"
          label={`${label} أبكر بنصف ساعة`}
          disabled={disabled}
          compact={compact}
          onPress={() => onChange(stepMinute(value, -1))}
        />
        <Text
          variant={compact ? 'smallBold' : 'bodyBold'}
          align="center"
          numberOfLines={1}
          style={{ flex: 1 }}
        >
          {formatTimeAr(value)}
        </Text>
        <StepButton
          icon="plus"
          label={`${label} أبعد بنصف ساعة`}
          disabled={disabled}
          compact={compact}
          onPress={() => onChange(stepMinute(value, 1))}
        />
      </View>
    </View>
  );
}

function StepButton({
  icon,
  label,
  disabled,
  onPress,
  compact,
}: {
  icon: IconName;
  label: string;
  disabled: boolean;
  onPress: () => void;
  compact: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        {
          width: compact ? TAP_TARGET - 10 : TAP_TARGET,
          minHeight: TAP_TARGET,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: color.surfaceSunken,
        },
        pressed ? { opacity: 0.7 } : null,
        disabled ? { opacity: 0.4 } : null,
      ]}
    >
      <MaterialCommunityIcons name={icon} size={20} color={color.textPrimary} />
    </Pressable>
  );
}

/** The window in words, with the overnight note where it applies. */
function WindowLine({ opens, closes }: { opens: number; closes: number }) {
  return (
    <Row gap={space[1]}>
      <MaterialCommunityIcons
        name={crossesMidnight(opens, closes) ? 'weather-night' : 'white-balance-sunny'}
        size={16}
        color={color.textMuted}
      />
      <Text variant="caption" tone="muted">
        {describeWindow(opens, closes)}
      </Text>
    </Row>
  );
}

function DayChip({
  day,
  disabled,
  onToggle,
}: {
  day: DayHours;
  disabled: boolean;
  onToggle: () => void;
}) {
  const open = !day.closed;
  return (
    <Pressable
      onPress={onToggle}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: open }}
      accessibilityLabel={`${DAY_NAMES_AR[day.day]} ${open ? 'مفتوح' : 'مغلق'}`}
      style={({ pressed }) => [
        {
          minWidth: TAP_TARGET,
          minHeight: TAP_TARGET - 4,
          paddingHorizontal: space[2],
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: open ? color.brand : color.borderSubtle,
          backgroundColor: open ? color.brand : color.surfaceCard,
        },
        pressed ? { opacity: 0.85 } : null,
      ]}
    >
      <Text variant="smallBold" tone={open ? 'inverse' : 'muted'}>
        {DAY_SHORT_AR[day.day]}
      </Text>
    </Pressable>
  );
}

/** One day of the seven-row form. */
function DayRow({
  day,
  disabled,
  onClosed,
  onWindow,
}: {
  day: DayHours;
  disabled: boolean;
  onClosed: (closed: boolean) => void;
  onWindow: (patch: { opens?: number; closes?: number }) => void;
}) {
  return (
    <View
      style={{
        padding: space[3],
        gap: space[2],
        borderRadius: radius.lg,
        backgroundColor: color.surfaceCard,
        borderWidth: 1,
        borderColor: color.borderSubtle,
      }}
    >
      <View style={{ flexDirection: ROW, alignItems: 'center', gap: space[2] }}>
        <Text variant="smallBold" style={{ flex: 1 }}>
          {DAY_NAMES_AR[day.day]}
        </Text>
        <Text variant="caption" tone="muted">
          {day.closed ? 'مغلق' : crossesMidnight(day.opens, day.closes) ? 'بعد منتصف الليل' : ''}
        </Text>
        <Switch
          value={!day.closed}
          disabled={disabled}
          onValueChange={(open) => onClosed(!open)}
          trackColor={{ true: color.brand, false: color.borderStrong }}
          accessibilityLabel={`${DAY_NAMES_AR[day.day]} مفتوح`}
        />
      </View>
      {!day.closed ? (
        <Row gap={space[3]} align="flex-start">
          <TimeStepper
            label="يفتح"
            value={day.opens}
            disabled={disabled}
            compact
            onChange={(opens) => onWindow({ opens })}
          />
          <TimeStepper
            label="يغلق"
            value={day.closes}
            disabled={disabled}
            compact
            onChange={(closes) => onWindow({ closes })}
          />
        </Row>
      ) : null}
    </View>
  );
}
