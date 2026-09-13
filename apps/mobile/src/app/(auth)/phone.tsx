import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { tryToE164Iraq, normalizeDigits } from '@jibli/validation';
import { api, ApiError, NetworkError } from '@/lib/api';
import { TAP_TARGET, color, palette, radius, space, text } from '@/theme';
import { JibliWordmark } from '@/ui/brand';

/**
 * Phone entry — the first screen of the customer journey (plan §10).
 *
 * The +964 prefix is shown as fixed chrome so the customer types only their
 * national number, which is what they know. Arabic-Indic digits are normalised
 * as they type, so a customer on an Arabic keypad is never told their correct
 * number is invalid (plan §2).
 *
 * The comp also draws «أو تابع باستخدام» with Google and Apple buttons. They
 * are deliberately not here: there is no social identity provider behind them,
 * and offering one would pull in App Store guideline 4.8 — a third-party login
 * obliges the app to offer Sign in with Apple beside it. Phone OTP is the only
 * way in, which keeps 4.8 out of scope entirely.
 */
export default function PhoneScreen() {
  const router = useRouter();
  const [rawInput, setRawInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  // Validate against the same rules the server uses, so the button state and
  // the server's answer agree.
  const parsed = tryToE164Iraq(rawInput);
  const canSubmit = parsed.ok && !isSubmitting;

  const handleChange = (value: string) => {
    // Fold Arabic-Indic digits immediately and keep only digits, so the field
    // shows exactly what will be sent.
    setRawInput(normalizeDigits(value).replace(/\D/g, '').slice(0, 11));
    if (error) setError(null);
  };

  const handleSubmit = async () => {
    if (!parsed.ok) return;
    setSubmitting(true);
    setError(null);

    try {
      const result = await api.requestOtp(parsed.value);
      /*
       * `dev_code` is carried through only because the server chose to send it,
       * and it does that solely when APP_ENV is `local` (otp-service.ts) — the
       * plan forbids logging or returning OTP values anywhere else. Passing it
       * along means a developer running the API locally can sign in without an
       * SMS gateway; against staging or production the field is simply absent.
       */
      router.push({
        pathname: '/(auth)/otp',
        params: { phone: parsed.value, ...(result.dev_code ? { devCode: result.dev_code } : {}) },
      });
    } catch (caught) {
      if (caught instanceof ApiError) {
        // The server's Arabic message is authoritative — it knows whether this
        // is a cooldown, a rate limit or a delivery failure (plan §76).
        setError(caught.messageAr);
      } else if (caught instanceof NetworkError) {
        setError('تعذّر الاتصال بالإنترنت. تحقق من الاتصال وحاول مرة أخرى.');
      } else {
        setError('حدث خطأ غير متوقع، الرجاء المحاولة مرة أخرى');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/*
       * A way back, because there is somewhere to go back to now: a guest who
       * tapped «تسجيل الدخول» from the home header is browsing, not committed,
       * and a sign-in screen with no exit is a trap.
       */}
      {router.canGoBack() ? (
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="رجوع"
          style={styles.back}
        >
          <MaterialCommunityIcons name="chevron-right" size={26} color={color.textPrimary} />
        </Pressable>
      ) : null}

      <View style={styles.header}>
        <JibliWordmark width={168} tint={color.brand} pinTint={palette.white} />
        <Text style={styles.title}>
          مرحباً بك في <Text style={styles.brand}>جيبلي</Text>
        </Text>
        <Text style={styles.subtitle}>أدخل رقم هاتفك للمتابعة</Text>
      </View>

      <View style={styles.inputRow}>
        {/*
          The country prefix is display chrome, not an editable field — the
          service is Iraq-only in Release 1 (plan §10).
        */}
        <View style={styles.prefix}>
          <Text style={styles.prefixText}>+964</Text>
          <Text style={styles.flag}>🇮🇶</Text>
        </View>

        <TextInput
          style={styles.input}
          value={rawInput}
          onChangeText={handleChange}
          placeholder="771 234 5678"
          placeholderTextColor={palette.ink[400]}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          maxLength={11}
          // The number itself reads left-to-right even inside an RTL layout.
          textAlign="left"
          accessibilityLabel="رقم الهاتف"
          accessibilityHint="أدخل رقم هاتفك العراقي بدون مفتاح الدولة"
          editable={!isSubmitting}
        />
      </View>

      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <Pressable
        style={[styles.button, !canSubmit && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={!canSubmit}
        accessibilityRole="button"
        accessibilityLabel="إرسال رمز التحقق"
        accessibilityState={{ disabled: !canSubmit, busy: isSubmitting }}
      >
        {isSubmitting ? (
          <ActivityIndicator color={palette.white} />
        ) : (
          <Text style={styles.buttonText}>إرسال رمز التحقق</Text>
        )}
      </Pressable>

      {/*
       * Tappable, not decorative. App Review looks for the privacy policy to be
       * reachable from inside the app, and this is the screen where consent is
       * actually being given.
       */}
      <Text style={styles.legal}>
        بالدخول فإنك توافق على{' '}
        <Text style={styles.link} onPress={() => openLegal('termsUrl')}>
          الشروط والأحكام
        </Text>{' '}
        و
        <Text style={styles.link} onPress={() => openLegal('privacyPolicyUrl')}>
          سياسة الخصوصية
        </Text>
      </Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.surfaceCard,
    padding: space[6],
    justifyContent: 'center',
    gap: space[4],
  },
  back: {
    position: 'absolute',
    top: space[10],
    insetInlineStart: space[4],
    width: TAP_TARGET,
    height: TAP_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { gap: space[2], alignItems: 'center', marginBottom: space[4] },
  title: { ...text.h1, color: color.textPrimary, textAlign: 'center' },
  brand: { color: color.brand },
  subtitle: { ...text.body, color: color.textMuted, textAlign: 'center' },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    borderWidth: 1,
    borderColor: color.borderSubtle,
    borderRadius: radius.md,
    backgroundColor: palette.ink[50],
    paddingHorizontal: space[3],
    minHeight: TAP_TARGET + 8,
  },
  prefix: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    paddingEnd: space[3],
    borderEndWidth: 1,
    borderEndColor: color.borderSubtle,
  },
  prefixText: { ...text.bodyBold, color: color.textPrimary },
  flag: { fontSize: 18 },
  input: {
    flex: 1,
    ...text.body,
    color: color.textPrimary,
    paddingVertical: space[3],
    // Digits stay LTR regardless of layout direction.
    writingDirection: 'ltr',
  },

  error: {
    ...text.small,
    color: color.danger,
    backgroundColor: color.dangerSoft,
    padding: space[3],
    borderRadius: radius.sm,
  },

  button: {
    backgroundColor: color.brand,
    minHeight: TAP_TARGET + 8,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { backgroundColor: palette.ink[300] },
  buttonText: { ...text.bodyBold, color: palette.white },

  legal: { ...text.small, color: color.textMuted, textAlign: 'center' },
  link: { color: color.textBrand },
});

/** Opens one of the legal URLs from the Expo config. */
function openLegal(key: 'termsUrl' | 'privacyPolicyUrl'): void {
  const extra = Constants.expoConfig?.extra as Record<string, string | undefined> | undefined;
  const url = extra?.[key];
  if (url) void Linking.openURL(url).catch(() => undefined);
}
