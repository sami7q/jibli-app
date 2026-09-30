import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import MaterialCommunityIcons from '@/ui/icon';
import * as Clipboard from 'expo-clipboard';
import { formatIqdArabic, iqd } from '@jibli/money';
import { normalizeDigits } from '@jibli/validation/arabic';
import {
  api,
  apiRequest,
  ApiError,
  idempotencyKey,
  NetworkError,
  type DriverDeliveryTask,
  type DriverMe,
  type DriverNavigationLinks,
} from '@/lib/api';
import { notify } from '@/lib/dialog';
import { PIECES, countAr } from '@/lib/arabic-count';
import { useWorkLive } from '@/lib/work-live';
import { PushPrompt } from '@/ui/push-prompt';
import {
  BRAND,
  INPUT_TEXT_START,
  ROW,
  TEXT_START,
  lazySheet,
  TAP_TARGET,
  color,
  palette,
  radius,
  space,
  text,
} from '@/theme';

/**
 * Driver delivery task (plan §49, §50, §52, §132).
 *
 * The flow the driver actually performs, and the order the screen follows:
 *
 *   قبول المهمة → الذهاب إلى المتجر → استلمت الطلب (only once it is READY) →
 *   فتح الخريطة إلى العميل → وصلت → رمز التسليم → تأكيد التسليم
 *
 * The pickup half used to be missing: the screen showed only the customer's
 * address, so a courier accepted a task without being told which shop to go
 * to, how to get there, whether the order was packed yet, or what should be in
 * the bag. And «استلمت» was allowed while the kitchen was still working.
 *
 * Navigation is external (plan §50) and the links carry nothing but
 * coordinates — never a token or the delivery PIN.
 */

/** Where the courier is in the job, as four steps they recognise. */
const STEPS = ['قبول المهمة', 'الاستلام من المتجر', 'في الطريق للعميل', 'التسليم'] as const;

function stepOf(status: string): number {
  switch (status) {
    case 'ASSIGNED':
      return 0;
    case 'ACCEPTED':
      return 1;
    case 'PICKED_UP':
      return 2;
    case 'ARRIVED_CUSTOMER':
      return 3;
    default:
      return 4;
  }
}

/** The order's own stage, as the courier waiting at the counter needs it. */
function kitchenLabel(orderStatus: string | undefined): { text: string; ready: boolean } {
  switch (orderStatus) {
    case 'READY':
      return { text: 'جاهز — استلمه الآن', ready: true };
    case 'PREPARING':
      return { text: 'قيد التجهيز', ready: false };
    case 'ACCEPTED':
      return { text: 'قُبل وسيبدأ تجهيزه', ready: false };
    case undefined:
      // An API from before the order's stage was sent: do not block pickup.
      return { text: '', ready: true };
    default:
      return { text: 'بانتظار المتجر', ready: false };
  }
}

/**
 * Open an external maps app.
 *
 * If the app is not installed the URL still resolves on the web, so the
 * driver is never stranded. A missing link means the address has no usable
 * coordinates and the fallback below applies (plan §108).
 */
async function openNavigation(url: string | null, appName: string): Promise<void> {
  if (!url) {
    notify(
      'تعذّر فتح الخريطة',
      'لا توجد إحداثيات صالحة لهذا العنوان. يمكنك نسخ العنوان أو الاتصال.',
    );
    return;
  }
  try {
    await Linking.openURL(url);
  } catch {
    notify('تعذّر فتح التطبيق', `تأكد من تثبيت ${appName} أو استخدم نسخ العنوان.`);
  }
}

/**
 * The task itself, once there is one.
 *
 * Presentational on purpose: it takes a task and reports that it changed. What
 * it must never be is the route — see `DeliveryScreen` below for the bug that
 * caused.
 */
function DeliveryTaskView({
  task,
  onChanged,
}: {
  task: DriverDeliveryTask;
  onChanged: () => void;
}) {
  const [pin, setPin] = useState('');
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinAttemptsLeft, setPinAttemptsLeft] = useState<number | null>(null);
  /** The reason being typed, or `null` while the courier has not asked to refuse. */
  const [rejectReason, setRejectReason] = useState<string | null>(null);
  const [showItems, setShowItems] = useState(false);

  const address = task.delivery_address;
  const step = stepOf(task.status);
  const collecting = task.status === 'ASSIGNED' || task.status === 'ACCEPTED';
  const kitchen = kitchenLabel(task.order_status);
  const itemCount = (task.items ?? []).reduce((sum, item) => sum + item.quantity, 0);

  const readyInMinutes =
    !kitchen.ready && task.ready_by
      ? Math.round((Date.parse(task.ready_by) - Date.now()) / 60_000)
      : null;

  const copy = async (value: string | null) => {
    if (!value) return;
    await Clipboard.setStringAsync(value);
    notify('تم النسخ', 'تم نسخ العنوان إلى الحافظة');
  };

  const describe = (caught: unknown) =>
    caught instanceof ApiError
      ? caught.messageAr
      : caught instanceof NetworkError
        ? 'تعذّر الاتصال. تحقق من الإنترنت وحاول مرة أخرى.'
        : 'حدث خطأ غير متوقع';

  const runTransition = async (action: 'accept' | 'pickup' | 'arrived-customer') => {
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest(`/api/v1/driver/deliveries/${task.assignment_id}/${action}`, {
        method: 'POST',
      });
      onChanged();
    } catch (caught) {
      setError(describe(caught));
      // The order may have moved under us (e.g. not ready yet): show it as it is.
      onChanged();
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Refuse an assignment, with the reason dispatch will read.
   *
   * The API requires at least three characters: «a courier refused this and
   * nobody knows why» is an operations problem, not a record. Asked for inline
   * rather than in a dialog, so the courier can see the order they are
   * refusing while they type.
   */
  const rejectTask = async () => {
    const reason = (rejectReason ?? '').trim();
    if (reason.length < 3) {
      setError('اكتب سبب الرفض (3 أحرف على الأقل).');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await apiRequest(`/api/v1/driver/deliveries/${task.assignment_id}/reject`, {
        method: 'POST',
        body: { reason },
      });
      setRejectReason(null);
      onChanged();
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Confirm delivery.
   *
   * Plan §111: "Do not queue a final financial completion offline and pretend
   * it succeeded." A network failure here leaves the task open and tells the
   * driver to retry — it never reports success optimistically.
   */
  const confirmDelivery = async () => {
    setSubmitting(true);
    setError(null);

    try {
      await apiRequest(`/api/v1/driver/deliveries/${task.assignment_id}/confirm-delivery`, {
        method: 'POST',
        body: { delivery_pin: normalizeDigits(pin) },
        // A retry after a timeout must not collect the cash twice (plan §53).
        idempotencyKey: idempotencyKey(`deliver-${task.assignment_id}`),
      });
      notify('تم التسليم', `أحسنت! سُجّل تسليم الطلب رقم ${task.public_order_number}.`);
      onChanged();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.messageAr);
        const remaining = caught.details.attemptsRemaining;
        if (typeof remaining === 'number') setPinAttemptsLeft(remaining);
        if (caught.code === 'DELIVERY_PIN_INVALID') setPin('');
      } else if (caught instanceof NetworkError) {
        setError('تعذّر تأكيد التسليم بسبب الاتصال. لم يتم تسجيل التسليم — حاول مرة أخرى.');
      } else {
        setError('حدث خطأ غير متوقع');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stepper current={step} />

      <View style={styles.card}>
        <View style={[styles.row, styles.rowBetween]}>
          <Text style={styles.orderNumber}>#{task.public_order_number}</Text>
          <View style={styles.cashBadge}>
            <MaterialCommunityIcons name="cash" size={16} color={color.successStrong} />
            <Text style={styles.cashText}>
              تحصيل {formatIqdArabic(iqd(task.cash_to_collect_iqd))}
            </Text>
          </View>
        </View>
        {task.customer_notes ? (
          <Text style={styles.note}>ملاحظة العميل: {task.customer_notes}</Text>
        ) : null}
      </View>

      {/* ── Collecting: the shop, the bag, and whether it is packed. ───────── */}
      {collecting ? (
        <View style={styles.card}>
          <View style={[styles.row, styles.rowBetween]}>
            <Text style={styles.sectionTitle}>الاستلام من المتجر</Text>
            {kitchen.text ? (
              <View
                style={[styles.stageChip, kitchen.ready ? styles.stageReady : styles.stageWaiting]}
              >
                <Text style={[styles.stageText, kitchen.ready ? styles.stageTextReady : null]}>
                  {kitchen.text}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.placeRow}>
            <View style={styles.placeIcon}>
              <MaterialCommunityIcons name="storefront-outline" size={22} color={BRAND[600]} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.placeName}>{task.restaurant?.name ?? 'المتجر'}</Text>
              {task.restaurant?.address_text ? (
                <Text style={styles.placeAddress}>
                  {[task.restaurant.city_name_ar, task.restaurant.address_text]
                    .filter(Boolean)
                    .join(' — ')}
                </Text>
              ) : null}
            </View>
          </View>

          {readyInMinutes !== null ? (
            <Text style={styles.hint}>
              {readyInMinutes > 0
                ? `المتجر قدّر أن يكون جاهزاً خلال ${readyInMinutes} د تقريباً.`
                : 'تجاوز الوقت الذي قدّره المتجر — تواصل معه إن طال الانتظار.'}
            </Text>
          ) : null}

          <NavigationButtons links={task.restaurant_navigation} onCopy={copy} />

          {task.restaurant?.phone ? (
            <Pressable
              style={[styles.button, styles.buttonOutline]}
              onPress={() => void Linking.openURL(`tel:${task.restaurant?.phone ?? ''}`)}
              accessibilityRole="button"
            >
              <View style={styles.row}>
                <MaterialCommunityIcons name="phone" size={18} color={color.textSecondary} />
                <Text style={styles.buttonOutlineText}>الاتصال بالمتجر</Text>
              </View>
            </Pressable>
          ) : null}

          {(task.items ?? []).length > 0 ? (
            <>
              <Pressable
                onPress={() => setShowItems((open) => !open)}
                accessibilityRole="button"
                accessibilityState={{ expanded: showItems }}
                style={[styles.row, styles.rowBetween, styles.itemsToggle]}
              >
                <Text style={styles.itemsToggleText}>
                  محتويات الطلب ({countAr(itemCount, PIECES)})
                </Text>
                <MaterialCommunityIcons
                  name={showItems ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={color.textSecondary}
                />
              </Pressable>
              {showItems
                ? (task.items ?? []).map((item, index) => (
                    <View key={`${item.name_ar}-${index}`} style={[styles.row, styles.itemRow]}>
                      <Text style={styles.itemQty}>{item.quantity}×</Text>
                      <Text style={styles.itemName}>
                        {item.name_ar}
                        {item.notes ? ` — ${item.notes}` : ''}
                      </Text>
                    </View>
                  ))
                : null}
            </>
          ) : null}
        </View>
      ) : null}

      {/* ── Delivering: the customer and the way there. ─────────────────── */}
      {!collecting ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>التوصيل إلى العميل</Text>
          <View style={styles.placeRow}>
            <View style={styles.placeIcon}>
              <MaterialCommunityIcons name="account-outline" size={22} color={BRAND[600]} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.placeName}>{task.customer.name}</Text>
              <Text style={styles.placeAddress}>
                {[address.districtText, address.street, address.building, address.landmark]
                  .filter(Boolean)
                  .join(' - ')}
              </Text>
            </View>
          </View>

          <NavigationButtons links={task.navigation} onCopy={copy} />

          <Pressable
            style={[styles.button, styles.buttonOutline]}
            onPress={() => void Linking.openURL(`tel:${task.customer.phone}`)}
            accessibilityRole="button"
          >
            <View style={styles.row}>
              <MaterialCommunityIcons name="phone" size={18} color={color.textSecondary} />
              <Text style={styles.buttonOutlineText}>الاتصال بالعميل</Text>
            </View>
          </Pressable>

          {!task.navigation.hasCoordinates ? (
            <Text style={styles.warning}>
              لا توجد إحداثيات دقيقة لهذا العنوان. استخدم نسخ العنوان أو الاتصال بالعميل.
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* ── The one action this stage allows. ──────────────────────────── */}

      {/*
       * The first stage, and it was missing entirely once: `ASSIGNED` is an
       * active status and the API had `/accept` and `/reject` all along, but
       * the screen drew nothing for it. Every new assignment starts here.
       */}
      {task.status === 'ASSIGNED' ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>طلب جديد أُسند إليك</Text>
          <Text style={styles.hint}>اقبل المهمة لتبدأ، أو ارفضها مع ذكر السبب.</Text>

          {rejectReason === null ? (
            <>
              <Pressable
                style={[styles.button, styles.buttonPrimary]}
                onPress={() => void runTransition('accept')}
                disabled={isSubmitting}
                accessibilityRole="button"
              >
                {isSubmitting ? (
                  <ActivityIndicator color={palette.white} />
                ) : (
                  <Text style={styles.buttonPrimaryText}>قبول المهمة</Text>
                )}
              </Pressable>

              <Pressable
                style={[styles.button, styles.buttonGhost]}
                onPress={() => setRejectReason('')}
                disabled={isSubmitting}
                accessibilityRole="button"
              >
                <Text style={styles.buttonGhostText}>رفض المهمة</Text>
              </Pressable>
            </>
          ) : (
            <>
              <TextInput
                style={styles.reasonInput}
                value={rejectReason}
                onChangeText={setRejectReason}
                placeholder="سبب الرفض — مثلاً: بعيد عن منطقتي"
                placeholderTextColor={palette.ink[300]}
                accessibilityLabel="سبب الرفض"
                editable={!isSubmitting}
                multiline
                maxLength={200}
              />

              <Pressable
                style={[styles.button, styles.buttonDanger]}
                onPress={() => void rejectTask()}
                disabled={isSubmitting}
                accessibilityRole="button"
              >
                {isSubmitting ? (
                  <ActivityIndicator color={palette.white} />
                ) : (
                  <Text style={styles.buttonPrimaryText}>تأكيد الرفض</Text>
                )}
              </Pressable>

              <Pressable
                style={[styles.button, styles.buttonGhost]}
                onPress={() => {
                  setRejectReason(null);
                  setError(null);
                }}
                disabled={isSubmitting}
                accessibilityRole="button"
              >
                <Text style={styles.buttonGhostText}>تراجع</Text>
              </Pressable>
            </>
          )}
        </View>
      ) : null}

      {task.status === 'ACCEPTED' ? (
        <View style={styles.gap}>
          <Pressable
            style={[styles.button, styles.buttonPrimary, !kitchen.ready && styles.buttonDisabled]}
            onPress={() => void runTransition('pickup')}
            disabled={isSubmitting || !kitchen.ready}
            accessibilityRole="button"
            accessibilityState={{ disabled: isSubmitting || !kitchen.ready }}
          >
            {isSubmitting ? (
              <ActivityIndicator color={palette.white} />
            ) : (
              <Text style={styles.buttonPrimaryText}>استلمت الطلب من المتجر</Text>
            )}
          </Pressable>
          {!kitchen.ready ? (
            <Text style={styles.waitingNote}>
              يتفعّل الزر حين يعلّم المتجر الطلب «جاهز» — وسيصلك تنبيه بذلك.
            </Text>
          ) : null}
        </View>
      ) : null}

      {task.status === 'PICKED_UP' ? (
        <Pressable
          style={[styles.button, styles.buttonPrimary]}
          onPress={() => void runTransition('arrived-customer')}
          disabled={isSubmitting}
          accessibilityRole="button"
        >
          {isSubmitting ? (
            <ActivityIndicator color={palette.white} />
          ) : (
            <Text style={styles.buttonPrimaryText}>وصلت إلى العميل</Text>
          )}
        </Pressable>
      ) : null}

      {task.status === 'ARRIVED_CUSTOMER' || task.status === 'PICKED_UP' ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>رمز التسليم</Text>
          <Text style={styles.hint}>اطلب من العميل رمز التسليم الظاهر في تطبيقه</Text>

          <TextInput
            style={styles.pinInput}
            value={pin}
            onChangeText={(value) => setPin(normalizeDigits(value).replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            textAlign="center"
            placeholder="••••"
            placeholderTextColor={palette.ink[300]}
            accessibilityLabel="رمز التسليم"
            editable={!isSubmitting}
          />

          {pinAttemptsLeft !== null ? (
            <Text style={styles.warning}>المحاولات المتبقية: {pinAttemptsLeft}</Text>
          ) : null}

          <Pressable
            style={[styles.button, styles.buttonPrimary, pin.length < 4 && styles.buttonDisabled]}
            onPress={confirmDelivery}
            disabled={pin.length < 4 || isSubmitting}
            accessibilityRole="button"
          >
            {isSubmitting ? (
              <ActivityIndicator color={palette.white} />
            ) : (
              <Text style={styles.buttonPrimaryText}>
                تأكيد التسليم وتحصيل {formatIqdArabic(iqd(task.cash_to_collect_iqd))}
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}

      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </ScrollView>
  );
}

/** Four steps, done ones filled: where the courier is in the job at a glance. */
function Stepper({ current }: { current: number }) {
  return (
    <View style={styles.stepper} accessibilityLabel={`المرحلة ${Math.min(current + 1, 4)} من 4`}>
      {STEPS.map((label, index) => {
        const done = index < current;
        const now = index === current;
        return (
          <View key={label} style={styles.step}>
            <View
              style={[
                styles.stepDot,
                done ? styles.stepDotDone : now ? styles.stepDotNow : styles.stepDotTodo,
              ]}
            >
              {done ? (
                <MaterialCommunityIcons name="check" size={14} color={palette.white} />
              ) : (
                <Text style={[styles.stepIndex, now ? styles.stepIndexNow : null]}>
                  {index + 1}
                </Text>
              )}
            </View>
            <Text style={[styles.stepLabel, now ? styles.stepLabelNow : null]} numberOfLines={2}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** Google Maps first, Waze beside it, and the address to copy when neither works. */
function NavigationButtons({
  links,
  onCopy,
}: {
  links: DriverNavigationLinks;
  onCopy: (value: string | null) => Promise<void>;
}) {
  return (
    <View style={styles.gap}>
      <Pressable
        style={[styles.button, styles.buttonPrimary]}
        onPress={() => void openNavigation(links.googleMaps, 'Google Maps')}
        accessibilityRole="button"
      >
        <View style={styles.row}>
          <MaterialCommunityIcons name="navigation-variant" size={18} color={palette.white} />
          <Text style={styles.buttonPrimaryText}>فتح الطريق في Google Maps</Text>
        </View>
      </Pressable>
      <View style={styles.row}>
        <Pressable
          style={[styles.button, styles.buttonGhost, styles.flex]}
          onPress={() => void openNavigation(links.waze, 'Waze')}
          accessibilityRole="button"
          // Waze has no address-search deep link; without coordinates there is
          // simply no Waze option to offer (plan §50).
          disabled={!links.waze}
        >
          <Text style={[styles.buttonGhostText, !links.waze && styles.textDisabled]}>Waze</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.buttonOutline, styles.flex]}
          onPress={() => void onCopy(links.copyableAddress)}
          accessibilityRole="button"
          disabled={!links.copyableAddress}
        >
          <Text style={styles.buttonOutlineText}>نسخ العنوان</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = lazySheet(() =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: color.surfacePage },

    header: {
      flexDirection: ROW,
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: space[4],
      paddingTop: space[10],
      paddingBottom: space[3],
      backgroundColor: color.surfaceCard,
      borderBottomWidth: 1,
      borderBottomColor: color.borderSubtle,
    },
    headerTitle: { ...text.bodyBold, color: color.textPrimary },
    headerSide: { flexDirection: ROW, alignItems: 'center', gap: space[2] },
    liveDot: { width: 8, height: 8, borderRadius: 4 },

    statusCard: {
      margin: space[4],
      marginBottom: 0,
      padding: space[4],
      borderRadius: radius.lg,
      borderWidth: 1,
      gap: space[3],
    },
    statusCardOn: { backgroundColor: color.successSoft, borderColor: color.success },
    statusCardOff: { backgroundColor: color.surfaceCard, borderColor: color.borderSubtle },
    statusRow: { flexDirection: ROW, alignItems: 'center', gap: space[3] },
    statusDot: { width: 12, height: 12, borderRadius: 6 },
    statusDotOn: { backgroundColor: color.success },
    statusDotOff: { backgroundColor: palette.ink[300] },
    statusTitle: { ...text.bodyBold, color: color.textPrimary, textAlign: TEXT_START },
    statusBody: { ...text.caption, color: color.textMuted, textAlign: TEXT_START },
    statsRow: { flexDirection: ROW, gap: space[3] },
    statBox: {
      flex: 1,
      backgroundColor: color.surfaceCard,
      borderRadius: radius.md,
      paddingVertical: space[2],
      paddingHorizontal: space[3],
      alignItems: 'center',
      gap: 2,
    },
    statValue: { ...text.h3, color: color.textPrimary },
    statLabel: { ...text.caption, color: color.textMuted },
    modeSwitch: {
      flexDirection: ROW,
      alignItems: 'center',
      gap: space[1],
      paddingVertical: space[1],
      paddingHorizontal: space[3],
      borderRadius: radius.full,
      backgroundColor: BRAND[50],
      borderWidth: 1,
      borderColor: BRAND[200],
    },
    modeSwitchText: { ...text.smallBold, color: BRAND[600] },

    stepper: {
      flexDirection: ROW,
      backgroundColor: color.surfaceCard,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: color.borderSubtle,
      paddingVertical: space[3],
      paddingHorizontal: space[2],
    },
    step: { flex: 1, alignItems: 'center', gap: space[1] },
    stepDot: {
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepDotDone: { backgroundColor: color.success },
    stepDotNow: { backgroundColor: BRAND[500] },
    stepDotTodo: {
      backgroundColor: palette.ink[100],
      borderWidth: 1,
      borderColor: palette.ink[200],
    },
    stepIndex: { ...text.captionBold, color: color.textMuted },
    stepIndexNow: { color: palette.white },
    stepLabel: { ...text.caption, color: color.textMuted, textAlign: 'center' },
    stepLabelNow: { color: color.textPrimary, fontWeight: '700' },

    buttonDanger: { backgroundColor: color.dangerStrong },
    reasonInput: {
      ...text.small,
      color: color.textPrimary,
      backgroundColor: color.surfacePage,
      borderWidth: 1,
      borderColor: color.borderSubtle,
      borderRadius: radius.md,
      paddingHorizontal: space[3],
      paddingTop: space[3],
      paddingBottom: space[3],
      minHeight: TAP_TARGET + 12,
      textAlign: INPUT_TEXT_START,
      textAlignVertical: 'top',
    },

    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: space[3],
      padding: space[6],
    },
    emptyTitle: { ...text.h3, color: color.textPrimary, textAlign: 'center' },
    emptyBody: { ...text.small, color: color.textMuted, textAlign: 'center' },

    switcher: {
      paddingHorizontal: space[4],
      paddingTop: space[3],
      gap: space[2],
      flexDirection: ROW,
    },
    chip: {
      paddingHorizontal: space[4],
      minHeight: TAP_TARGET - 8,
      justifyContent: 'center',
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: color.borderSubtle,
      backgroundColor: color.surfaceCard,
    },
    chipOn: { borderColor: BRAND[500], backgroundColor: color.brandSoft },
    chipText: { ...text.caption, color: color.textSecondary, writingDirection: 'ltr' },
    chipTextOn: { color: BRAND[600] },
    content: { padding: space[4], gap: space[4], paddingBottom: space[10] },
    promptSlot: { paddingHorizontal: space[4], paddingTop: space[3] },
    gap: { gap: space[2] },

    card: {
      backgroundColor: color.surfaceCard,
      borderRadius: radius.lg,
      padding: space[4],
      gap: space[3],
      borderWidth: 1,
      borderColor: color.borderSubtle,
    },
    row: { flexDirection: ROW, alignItems: 'center', gap: space[2] },
    /*
     * The order number at one end of the row and the cash badge at the other.
     *
     * `justifyContent`, not the `marginStart: 'auto'` the badge used to carry:
     * an auto margin names a physical side, and which physical side is the far
     * one depends on whether the row is drawn `row` or `row-reverse`. Splitting
     * the row is the same result and has no side in it.
     */
    rowBetween: { justifyContent: 'space-between' },
    flex: { flex: 1 },

    orderNumber: { ...text.h3, color: color.textPrimary, writingDirection: 'ltr' },
    cashBadge: {
      flexDirection: ROW,
      alignItems: 'center',
      gap: space[1],
      backgroundColor: color.successSoft,
      paddingHorizontal: space[3],
      paddingVertical: space[1],
      borderRadius: radius.full,
    },
    cashText: { ...text.smallBold, color: color.successStrong },

    placeRow: { flexDirection: ROW, alignItems: 'center', gap: space[3] },
    placeIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: BRAND[50],
    },
    placeName: { ...text.bodyBold, color: color.textPrimary, textAlign: TEXT_START },
    placeAddress: { ...text.small, color: color.textSecondary, textAlign: TEXT_START },

    stageChip: { paddingHorizontal: space[2], paddingVertical: 2, borderRadius: radius.full },
    stageReady: { backgroundColor: color.successSoft },
    stageWaiting: { backgroundColor: color.warningSoft },
    stageText: { ...text.captionBold, color: color.warningStrong },
    stageTextReady: { color: color.successStrong },

    itemsToggle: {
      paddingTop: space[2],
      borderTopWidth: 1,
      borderTopColor: color.borderSubtle,
    },
    itemsToggleText: { ...text.smallBold, color: color.textSecondary },
    itemRow: { alignItems: 'flex-start' },
    itemQty: { ...text.smallBold, color: color.textPrimary, minWidth: 28, textAlign: TEXT_START },
    itemName: { ...text.small, color: color.textPrimary, flex: 1, textAlign: TEXT_START },

    note: {
      ...text.small,
      color: color.textSecondary,
      backgroundColor: palette.ink[100],
      padding: space[3],
      borderRadius: radius.sm,
      textAlign: TEXT_START,
    },

    sectionTitle: { ...text.h3, color: color.textPrimary, textAlign: TEXT_START },
    hint: { ...text.small, color: color.textMuted, textAlign: TEXT_START },
    waitingNote: { ...text.caption, color: color.warningStrong, textAlign: 'center' },

    button: {
      minHeight: TAP_TARGET + 4,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: space[4],
    },
    buttonPrimary: { backgroundColor: BRAND[500] },
    buttonPrimaryText: { ...text.bodyBold, color: palette.white },
    buttonGhost: { backgroundColor: BRAND[50] },
    buttonGhostText: { ...text.bodyBold, color: BRAND[700] },
    buttonOutline: {
      borderWidth: 1,
      borderColor: color.borderSubtle,
      backgroundColor: color.surfaceCard,
    },
    buttonOutlineText: { ...text.bodyBold, color: color.textSecondary },
    buttonDisabled: { backgroundColor: palette.ink[300] },
    textDisabled: { color: palette.ink[400] },

    pinInput: {
      borderWidth: 1.5,
      borderColor: color.borderSubtle,
      borderRadius: radius.md,
      backgroundColor: palette.ink[50],
      minHeight: 64,
      ...text.h1,
      color: color.textPrimary,
      letterSpacing: 12,
    },

    warning: {
      ...text.small,
      color: color.warningStrong,
      backgroundColor: color.warningSoft,
      padding: space[3],
      borderRadius: radius.sm,
      textAlign: TEXT_START,
    },
    error: {
      ...text.small,
      color: color.danger,
      backgroundColor: color.dangerSoft,
      padding: space[3],
      borderRadius: radius.sm,
      textAlign: TEXT_START,
    },
  }),
);

/**
 * The courier screen — the route, which fetches what it shows.
 *
 * This is the fix for a crash every driver hit on the first screen after
 * signing in: «Cannot read property 'delivery_address' of undefined». The
 * component above takes a `task` prop, and it was the default export of a file
 * under `app/(driver)/` — so expo-router rendered it as a route, with no props
 * at all. Nothing ever passed a task, from any of the three places that send a
 * courier here, so it had never worked for anybody.
 *
 * A file in `app/` is a screen and is handed nothing; if it needs data it asks.
 * So this asks: the active assignments, then the one being worked, because only
 * the detail endpoint builds the Maps and Waze links.
 */
export default function DeliveryScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [openAssignment, setOpenAssignment] = useState<string | null>(null);
  const { driver: live } = useWorkLive();

  const active = useQuery({
    queryKey: ['driver', 'deliveries', 'active'],
    queryFn: () => api.driverDeliveries('active'),
    /*
     * The floor under the realtime channel. `WorkLiveProvider` listens and
     * polls this same key app-wide and rings for a new task; this keeps the
     * screen moving on its own when opened before it has.
     */
    refetchInterval: live.live === 'live' ? 60_000 : 20_000,
  });

  const rows = active.data ?? [];

  /** The assignment being worked: the one chosen, or the oldest still open. */
  const assignmentId = useMemo(() => {
    if (openAssignment && rows.some((row) => row.assignment_id === openAssignment)) {
      return openAssignment;
    }
    return rows[0]?.assignment_id ?? null;
  }, [openAssignment, rows]);

  const task = useQuery({
    queryKey: ['driver', 'delivery', assignmentId],
    queryFn: () => api.driverDelivery(assignmentId as string),
    enabled: Boolean(assignmentId),
  });

  /*
   * The screen stays on while there is a job. A courier glances at it at a red
   * light; a phone that locked itself mid-delivery is a courier fumbling for a
   * PIN pad with a bag in one hand.
   */
  const working = Boolean(assignmentId);
  useEffect(() => {
    if (!working) return;
    void activateKeepAwakeAsync('delivery').catch(() => undefined);
    return () => {
      void deactivateKeepAwake('delivery');
    };
  }, [working]);

  /** After a transition the task moved, and so did the list it came from. */
  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: ['driver', 'deliveries'] });
    void queryClient.invalidateQueries({ queryKey: ['driver', 'delivery'] });
    void queryClient.invalidateQueries({ queryKey: ['driver', 'me'] });
    void queryClient.invalidateQueries({ queryKey: ['driver', 'cash'] });
  };

  const me = useQuery({
    queryKey: ['driver', 'me'],
    queryFn: () => api.driverMe(),
    refetchInterval: 30_000,
  });
  const cash = useQuery({ queryKey: ['driver', 'cash'], queryFn: () => api.driverCash() });
  const history = useQuery({
    queryKey: ['driver', 'deliveries', 'history'],
    queryFn: () => api.driverDeliveries('history'),
    staleTime: 60_000,
  });

  /** Deliveries finished since midnight on this phone's clock. */
  const deliveredToday = useMemo(() => {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    return (history.data ?? []).filter(
      (row) => row.status === 'DELIVERED' && new Date(row.assigned_at) >= midnight,
    ).length;
  }, [history.data]);

  const availability = me.data?.availability ?? 'OFFLINE';
  const online = availability !== 'OFFLINE';
  /** Carrying an order: going offline now would strand it, so the switch waits. */
  const busy = rows.length > 0;

  const toggle = useMutation({
    mutationFn: (next: 'AVAILABLE' | 'OFFLINE') => api.setDriverAvailability(next),
    onMutate: (next) => {
      // The switch moves under the finger, not a round trip later.
      queryClient.setQueryData<DriverMe>(['driver', 'me'], (current) =>
        current ? { ...current, availability: next } : current,
      );
    },
    onError: (caught) => {
      notify(
        'تعذّر تغيير الحالة',
        caught instanceof ApiError ? caught.messageAr : 'تحقق من الاتصال وحاول مرة أخرى.',
      );
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['driver', 'me'] }),
  });

  /*
   * Presence while online. A courier who left the app open and walked away
   * still reads as reachable to the shop; the heartbeat is how «last seen»
   * stays honest. Presence only — no location is sent.
   */
  useEffect(() => {
    if (!online) return;
    void api.driverHeartbeat().catch(() => undefined);
    const timer = setInterval(() => void api.driverHeartbeat().catch(() => undefined), 60_000);
    return () => clearInterval(timer);
  }, [online]);

  const loading = active.isLoading || (Boolean(assignmentId) && task.isLoading);
  const failure = active.error ?? task.error;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerSide}>
          <Text style={styles.headerTitle}>وضع المندوب</Text>
          {/* Whether a new task reaches this phone instantly or on the next look. */}
          <View
            style={[
              styles.liveDot,
              { backgroundColor: live.live === 'live' ? color.success : color.warning },
            ]}
            accessibilityLabel={live.live === 'live' ? 'متصل مباشرة' : 'تحديث دوري'}
          />
        </View>
        {/*
         * The way back, named. One account carries both modes, and a bare
         * arrow did not say that leaving this screen is switching back to
         * ordering — it read as «back», to nowhere in particular.
         */}
        <Pressable
          onPress={() => router.replace('/(tabs)')}
          accessibilityRole="button"
          accessibilityLabel="التبديل إلى الوضع العادي"
          hitSlop={space[2]}
          style={({ pressed }) => [styles.modeSwitch, pressed ? { opacity: 0.7 } : null]}
        >
          <MaterialCommunityIcons name="swap-horizontal" size={16} color={BRAND[600]} />
          <Text style={styles.modeSwitchText}>الوضع العادي</Text>
        </Pressable>
      </View>

      {/*
       * The one question a courier asks on opening this screen: am I
       * receiving orders? Availability existed on the server and in the
       * shop's driver list, and the courier could neither see nor change it —
       * yet a shop cannot hand an order to somebody who is offline.
       */}
      <View style={[styles.statusCard, online ? styles.statusCardOn : styles.statusCardOff]}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, online ? styles.statusDotOn : styles.statusDotOff]} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.statusTitle}>
              {busy ? 'في مهمة توصيل' : online ? 'متصل — تستقبل الطلبات' : 'غير متصل'}
            </Text>
            <Text style={styles.statusBody}>
              {busy
                ? 'أكمل التوصيل الحالي، ثم يمكنك إيقاف الاستقبال.'
                : online
                  ? 'تظهر للمتاجر كمندوب متاح، ويرنّ الهاتف عند إسناد طلب إليك.'
                  : 'لن تُسند إليك طلبات حتى تفعّل الاستقبال.'}
            </Text>
          </View>
          <Switch
            value={online}
            disabled={busy || toggle.isPending || me.isLoading}
            onValueChange={(next) => toggle.mutate(next ? 'AVAILABLE' : 'OFFLINE')}
            trackColor={{ false: palette.ink[200], true: color.success }}
            thumbColor={palette.white}
            ios_backgroundColor={palette.ink[200]}
            accessibilityLabel={online ? 'إيقاف استقبال الطلبات' : 'تفعيل استقبال الطلبات'}
          />
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{history.isLoading ? '…' : deliveredToday}</Text>
            <Text style={styles.statLabel}>توصيلات اليوم</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>
              {cash.data ? formatIqdArabic(iqd(cash.data.current_custody_iqd)) : '…'}
            </Text>
            <Text style={styles.statLabel}>نقد بحوزتك للمتاجر</Text>
          </View>
        </View>
      </View>

      <View style={styles.promptSlot}>
        <PushPrompt audience="driver" />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={BRAND[500]} />
        </View>
      ) : failure ? (
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>تعذّر تحميل المهمة</Text>
          <Text style={styles.emptyBody}>
            {failure instanceof ApiError
              ? failure.messageAr
              : 'تحقق من الاتصال بالإنترنت وحاول مرة أخرى.'}
          </Text>
          <Pressable
            style={[styles.button, styles.buttonPrimary]}
            onPress={() => {
              void active.refetch();
              void task.refetch();
            }}
            accessibilityRole="button"
          >
            <Text style={styles.buttonPrimaryText}>إعادة المحاولة</Text>
          </Pressable>
        </View>
      ) : !assignmentId || !task.data ? (
        /*
         * No task is the ordinary state between deliveries, not a failure. It
         * says what the courier is waiting for rather than leaving them on an
         * empty screen wondering whether the app is broken.
         */
        <View style={styles.centered}>
          <MaterialCommunityIcons
            name={online ? 'moped' : 'moped-outline'}
            size={48}
            color={online ? color.success : palette.ink[300]}
          />
          <Text style={styles.emptyTitle}>{online ? 'بانتظار طلب…' : 'أنت غير متصل'}</Text>
          <Text style={styles.emptyBody}>
            {online
              ? 'سيرنّ الهاتف ويظهر تنبيه فور إسناد مهمة إليك، حتى لو كنت في شاشة أخرى.'
              : 'فعّل الاستقبال من الأعلى لتظهر للمتاجر وتصلك مهام التوصيل.'}
          </Text>
          <Pressable
            style={[styles.button, styles.buttonGhost]}
            onPress={() => void active.refetch()}
            accessibilityRole="button"
          >
            <Text style={styles.buttonGhostText}>تحديث</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {/*
           * Only when there is a choice to make. A courier carrying two orders
           * needs to switch between them; one carrying a single order does not
           * need a control that says so.
           */}
          {rows.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.switcher}
            >
              {rows.map((row) => {
                const chosen = row.assignment_id === assignmentId;
                return (
                  <Pressable
                    key={row.assignment_id}
                    onPress={() => setOpenAssignment(row.assignment_id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: chosen }}
                    accessibilityLabel={`الطلب ${row.public_order_number}`}
                    style={[styles.chip, chosen ? styles.chipOn : null]}
                  >
                    <Text style={[styles.chipText, chosen ? styles.chipTextOn : null]}>
                      #{row.public_order_number}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          <DeliveryTaskView task={task.data} onChanged={reload} />
        </>
      )}
    </View>
  );
}
