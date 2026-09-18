import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import MaterialCommunityIcons from '@/ui/icon';
import * as Clipboard from 'expo-clipboard';
import { formatIqdArabic, iqd } from '@jibli/money';
import { normalizeDigits } from '@jibli/validation';
import {
  api,
  apiRequest,
  ApiError,
  idempotencyKey,
  NetworkError,
  type DriverDeliveryTask,
} from '@/lib/api';
import { notify } from '@/lib/dialog';
import { BRAND, ROW, TAP_TARGET, color, palette, radius, space, text } from '@/theme';

/**
 * Driver delivery task (plan §49, §50, §52, §132).
 *
 * The flow the driver actually performs:
 *   استلمت الطلب → فتح في Google Maps / Waze → وصلت إلى العميل →
 *   رمز التسليم → تأكيد التسليم
 *
 * Navigation is external (plan §50) and the links carry nothing but
 * coordinates — never a token or the delivery PIN.
 */

/**
 * The task itself, once there is one.
 *
 * Presentational on purpose: it takes a task and reports that it changed. What
 * it must never be is the route — see `DeliveryScreen` below for the bug that
 * caused.
 */
function DeliveryTaskView({ task, onChanged }: { task: DriverDeliveryTask; onChanged: () => void }) {
  const [pin, setPin] = useState('');
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinAttemptsLeft, setPinAttemptsLeft] = useState<number | null>(null);
  /** The reason being typed, or `null` while the courier has not asked to refuse. */
  const [rejectReason, setRejectReason] = useState<string | null>(null);

  const address = task.delivery_address;

  /**
   * Open an external maps app.
   *
   * If the app is not installed the URL still resolves on the web, so the
   * driver is never stranded. A missing link means the address has no usable
   * coordinates and the fallback below applies (plan §108).
   */
  const openNavigation = async (url: string | null, appName: string) => {
    if (!url) {
      notify(
        'تعذّر فتح الخريطة',
        `لا توجد إحداثيات صالحة لهذا العنوان. يمكنك نسخ العنوان أو الاتصال بالعميل.`,
      );
      return;
    }
    try {
      await Linking.openURL(url);
    } catch {
      notify('تعذّر فتح التطبيق', `تأكد من تثبيت ${appName} أو استخدم نسخ العنوان.`);
    }
  };

  const copyAddress = async () => {
    if (!task.navigation.copyableAddress) return;
    await Clipboard.setStringAsync(task.navigation.copyableAddress);
    notify('تم النسخ', 'تم نسخ العنوان إلى الحافظة');
  };

  const callCustomer = () => {
    void Linking.openURL(`tel:${task.customer.phone}`);
  };

  const runTransition = async (action: 'accept' | 'pickup' | 'arrived-customer') => {
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest(`/api/v1/driver/deliveries/${task.assignment_id}/${action}`, {
        method: 'POST',
      });
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.messageAr
          : caught instanceof NetworkError
            ? 'تعذّر الاتصال. تحقق من الإنترنت وحاول مرة أخرى.'
            : 'حدث خطأ غير متوقع',
      );
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
      setError(
        caught instanceof ApiError
          ? caught.messageAr
          : caught instanceof NetworkError
            ? 'تعذّر الاتصال. تحقق من الإنترنت وحاول مرة أخرى.'
            : 'حدث خطأ غير متوقع',
      );
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
      <View style={styles.card}>
        <View style={[styles.row, styles.rowBetween]}>
          <Text style={styles.orderNumber}>#{task.public_order_number}</Text>
          <View style={styles.cashBadge}>
            <Text style={styles.cashText}>
              تحصيل نقدي: {formatIqdArabic(iqd(task.cash_to_collect_iqd))}
            </Text>
          </View>
        </View>

        <Text style={styles.customerName}>{task.customer.name}</Text>
        <Text style={styles.addressText}>
          {[address.districtText, address.street, address.building, address.landmark]
            .filter(Boolean)
            .join(' - ')}
        </Text>
        {task.customer_notes ? (
          <Text style={styles.note}>ملاحظة: {task.customer_notes}</Text>
        ) : null}
      </View>

      {/* Navigation row — Google Maps is the default, Waze the alternative. */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>التوصيل إلى العميل</Text>

        <Pressable
          style={[styles.button, styles.buttonPrimary]}
          onPress={() => void openNavigation(task.navigation.googleMaps, 'Google Maps')}
          accessibilityRole="button"
        >
          <Text style={styles.buttonPrimaryText}>فتح في Google Maps</Text>
        </Pressable>

        <Pressable
          style={[styles.button, styles.buttonGhost]}
          onPress={() => void openNavigation(task.navigation.waze, 'Waze')}
          accessibilityRole="button"
          // Waze has no address-search deep link; without coordinates there is
          // simply no Waze option to offer (plan §50).
          disabled={!task.navigation.waze}
        >
          <Text style={[styles.buttonGhostText, !task.navigation.waze && styles.textDisabled]}>
            فتح في Waze
          </Text>
        </Pressable>

        <View style={styles.row}>
          <Pressable
            style={[styles.button, styles.buttonOutline, styles.flex]}
            onPress={copyAddress}
            accessibilityRole="button"
          >
            <Text style={styles.buttonOutlineText}>نسخ العنوان</Text>
          </Pressable>
          <Pressable
            style={[styles.button, styles.buttonOutline, styles.flex]}
            onPress={callCustomer}
            accessibilityRole="button"
          >
            <Text style={styles.buttonOutlineText}>الاتصال بالعميل</Text>
          </Pressable>
        </View>

        {!task.navigation.hasCoordinates ? (
          <Text style={styles.warning}>
            لا توجد إحداثيات دقيقة لهذا العنوان. استخدم نسخ العنوان أو الاتصال بالعميل.
          </Text>
        ) : null}
      </View>

      {/* Stage actions — each one enabled only in the state that allows it. */}

      {/*
        * The first stage, and it was missing entirely.
        *
        * `ASSIGNED` is an active status and the API has had `/accept` and
        * `/reject` all along, but the screen drew nothing for it — so a courier
        * who had just been given an order could see it, could not take it, and
        * had no way forward. Every new assignment starts here.
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
        <Pressable
          style={[styles.button, styles.buttonPrimary]}
          onPress={() => void runTransition('pickup')}
          disabled={isSubmitting}
          accessibilityRole="button"
        >
          {isSubmitting ? (
            <ActivityIndicator color={palette.white} />
          ) : (
            <Text style={styles.buttonPrimaryText}>استلمت الطلب</Text>
          )}
        </Pressable>
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
              <Text style={styles.buttonPrimaryText}>تأكيد التسليم</Text>
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

const styles = StyleSheet.create({
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
  headerSide: { width: 32, alignItems: 'center' },

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
    textAlign: 'right',
    textAlignVertical: 'top',
  },
  headerTitle: { ...text.bodyBold, color: color.textPrimary },

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
  content: { padding: space[4], gap: space[4] },

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

  orderNumber: { ...text.bodyBold, color: color.textPrimary, writingDirection: 'ltr' },
  cashBadge: {
    backgroundColor: color.successSoft,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    borderRadius: radius.full,
  },
  cashText: { ...text.caption, color: color.success },

  customerName: { ...text.h2, color: color.textPrimary },
  addressText: { ...text.body, color: color.textSecondary },
  note: {
    ...text.small,
    color: color.textSecondary,
    backgroundColor: palette.ink[100],
    padding: space[3],
    borderRadius: radius.sm,
  },

  sectionTitle: { ...text.h3, color: color.textPrimary },
  hint: { ...text.small, color: color.textMuted },

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
    color: color.warning,
    backgroundColor: color.warningSoft,
    padding: space[3],
    borderRadius: radius.sm,
  },
  error: {
    ...text.small,
    color: color.danger,
    backgroundColor: color.dangerSoft,
    padding: space[3],
    borderRadius: radius.sm,
  },
});


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

  const active = useQuery({
    queryKey: ['driver', 'deliveries', 'active'],
    queryFn: () => api.driverDeliveries('active'),
    /*
     * A courier keeps this open while they ride, and orders arrive from
     * dispatch rather than from anything they do here — so the screen has to
     * look again on its own. Half a minute is often enough to be useful and
     * rare enough to cost nothing on a phone that is navigating at the time.
     */
    refetchInterval: 30_000,
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

  /** After a transition the task moved, and so did the list it came from. */
  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: ['driver', 'deliveries'] });
    void queryClient.invalidateQueries({ queryKey: ['driver', 'delivery'] });
  };

  const loading = active.isLoading || (Boolean(assignmentId) && task.isLoading);
  const failure = active.error ?? task.error;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.replace('/(tabs)/account')}
          accessibilityRole="button"
          accessibilityLabel="رجوع"
          hitSlop={space[2]}
          style={styles.headerSide}
        >
          <MaterialCommunityIcons name="chevron-right" size={24} color={color.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>مهمة التوصيل</Text>
        {/* Balances the back button so the title stays centred. */}
        <View style={styles.headerSide} />
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
          <MaterialCommunityIcons name="moped-outline" size={48} color={palette.ink[300]} />
          <Text style={styles.emptyTitle}>لا توجد مهمة توصيل الآن</Text>
          <Text style={styles.emptyBody}>
            ستظهر المهمة هنا فور إسنادها إليك. أبقِ التطبيق مفتوحاً.
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
