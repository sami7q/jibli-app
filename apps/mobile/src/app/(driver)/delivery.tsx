import { useState } from 'react';
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
import * as Clipboard from 'expo-clipboard';
import { formatIqdArabic, iqd } from '@jibli/money';
import { normalizeDigits } from '@jibli/validation';
import { apiRequest, ApiError, idempotencyKey, NetworkError } from '@/lib/api';
import { notify } from '@/lib/dialog';
import { BRAND, TAP_TARGET, color, palette, radius, space, text } from '@/theme';

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

interface NavigationLinks {
  googleMaps: string | null;
  waze: string | null;
  copyableAddress: string | null;
  hasCoordinates: boolean;
}

interface DeliveryTask {
  assignment_id: string;
  order_id: string;
  public_order_number: string;
  status: string;
  cash_to_collect_iqd: number;
  customer: { name: string; phone: string };
  customer_notes: string | null;
  delivery_address: Record<string, unknown>;
  navigation: NavigationLinks;
  restaurant_navigation: NavigationLinks;
}

export default function DeliveryScreen({
  task,
  onChanged,
}: {
  task: DeliveryTask;
  onChanged: () => void;
}) {
  const [pin, setPin] = useState('');
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinAttemptsLeft, setPinAttemptsLeft] = useState<number | null>(null);

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

  const runTransition = async (action: 'pickup' | 'arrived-customer') => {
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
        <View style={styles.row}>
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
  content: { padding: space[4], gap: space[4] },

  card: {
    backgroundColor: color.surfaceCard,
    borderRadius: radius.lg,
    padding: space[4],
    gap: space[3],
    borderWidth: 1,
    borderColor: color.borderSubtle,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  flex: { flex: 1 },

  orderNumber: { ...text.bodyBold, color: color.textPrimary, writingDirection: 'ltr' },
  cashBadge: {
    marginStart: 'auto',
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
