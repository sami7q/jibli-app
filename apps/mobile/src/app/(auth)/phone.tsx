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
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { tryToE164Iraq, normalizeDigits } from '@jibli/validation';
import { api, ApiError, NetworkError } from '@/lib/api';
import { BRAND, TAP_TARGET, color, palette, radius, space, text } from '@/theme';
import { IraqFlag, JibliWordmark } from '@/ui/brand';
import { isGoogleSignInConfigured, signInWithGoogle } from '@/lib/google-signin';
import { useSession } from '@/lib/session';

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
  const [devAvailable, setDevAvailable] = useState(true);
  const { signIn } = useSession();

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

  /**
   * One tap to a signed-in session, in development only.
   *
   * Requests a code for a fixed number and verifies it in the same gesture.
   * It is drawn only when the server answers with `dev_code`, which it does
   * solely for the mock provider or a local run — so there is no build in which
   * a customer can see this, and no flag to remember to turn off.
   */
  const handleDevSignIn = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const code = await devCode();
      if (!code) {
        setError('الدخول السريع متاح فقط عندما يعمل الخادم في وضع التطوير.');
        setDevAvailable(false);
        return;
      }

      const result = await api.verifyOtp(DEV_PHONE, code);
      await signIn({
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        userId: result.user.id,
      });
      router.replace(result.next_step === 'COMPLETE_PROFILE' ? '/(auth)/profile' : '/(tabs)');
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.messageAr : 'تعذّر الدخول السريع. جرّب الرقم يدوياً.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setSubmitting(true);
    setError(null);

    const outcome = await signInWithGoogle();

    if (outcome.status === 'cancelled') {
      setSubmitting(false);
      return;
    }
    if (outcome.status !== 'ok') {
      setSubmitting(false);
      setError('تعذّر تسجيل الدخول عبر جوجل. جرّب رقم هاتفك.');
      return;
    }

    try {
      const result = await api.googleSignIn(outcome.idToken);
      await signIn({
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        userId: result.user.id,
      });
      // The gate routes from here: a Google account with no phone lands on
      // verification, which is the same screen a phone sign-in starts from.
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.messageAr
          : 'تعذّر تسجيل الدخول عبر جوجل. جرّب رقم هاتفك.',
      );
    } finally {
      setSubmitting(false);
    }
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
        <JibliWordmark width={168} tint={BRAND[500]} pinTint={palette.white} />
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
        {/*
         * The flag before the code, as the comp draws it — and drawn, not
         * 🇮🇶: that emoji is two regional-indicator letters, and a font
         * without the flag glyph renders them literally. This screen was
         * showing "IQ".
         */}
        <View style={styles.prefix}>
          <IraqFlag width={24} />
          <Text style={styles.prefixText}>+964</Text>
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
       * The development shortcut.
       *
       * Rendered only when the bundle itself is a development one, and it
       * still checks with the server before signing anyone in — a release
       * build has `__DEV__` false and never draws it.
       */}
      {__DEV__ && devAvailable ? (
        <Pressable
          onPress={handleDevSignIn}
          disabled={isSubmitting}
          accessibilityRole="button"
          accessibilityLabel="دخول سريع لوضع التطوير"
          style={({ pressed }) => [styles.devButton, pressed ? { opacity: 0.8 } : null]}
        >
          <Text style={styles.devButtonTitle}>دخول سريع — وضع التطوير</Text>
          <Text style={styles.devButtonText}>{DEV_PHONE_DISPLAY}</Text>
        </Pressable>
      ) : null}

      {/*
       * Google, when it is configured.
       *
       * It signs the customer in but does not give Jibli a number a driver
       * can call, so the server answers `VERIFY_PHONE` and routes them
       * straight back to this screen's sibling — the phone is not optional,
       * it is only later.
       */}
      {isGoogleSignInConfigured() ? (
        <View style={styles.alternatives}>
          <Text style={styles.divider}>أو تابع باستخدام</Text>
          <Pressable
            onPress={handleGoogle}
            disabled={isSubmitting}
            accessibilityRole="button"
            accessibilityLabel="المتابعة عبر جوجل"
            style={({ pressed }) => [styles.googleButton, pressed ? { opacity: 0.75 } : null]}
          >
            <Text style={styles.googleLabel}>المتابعة عبر جوجل</Text>
          </Pressable>
        </View>
      ) : null}

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

      {/*
       * The couriers' door, at the bottom and quiet.
       *
       * Almost everybody arriving here is a customer with a phone number, so
       * this is the last line rather than a second button beside the first —
       * but it has to exist somewhere a driver can find without being told,
       * and «سجّل بالرقم» is not a door they have a key to: their account was
       * created by a restaurant, with a username and a password.
       */}
      <Pressable
        onPress={() => router.push('/(auth)/driver-login')}
        accessibilityRole="button"
        accessibilityLabel="دخول المندوبين"
        style={({ pressed }) => [
          { minHeight: TAP_TARGET, alignItems: 'center', justifyContent: 'center' },
          pressed ? { opacity: 0.7 } : null,
        ]}
      >
        <Text style={styles.driverLink}>
          <MaterialCommunityIcons name="moped" size={15} /> دخول المندوبين
        </Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

/**
 * The number the development shortcut signs in as.
 *
 * A real Iraqi format so it passes the same validation every other number
 * does — a test account that skips validation tests nothing.
 */
const DEV_PHONE = '+9647712345678';
const DEV_PHONE_DISPLAY = '+964 771 234 5678';

/**
 * The last code the server handed back.
 *
 * The resend cooldown and the per-number hourly cap are real protections and
 * apply to this number like any other — so a second tap inside the cooldown,
 * or a sixth inside an hour, is refused. That is precisely what someone
 * testing does, and being locked out of your own preview for an hour is worse
 * than the two taps this replaced.
 *
 * Both refusals throw before the service invalidates the outstanding
 * challenge, so the code already issued is still live; the mock provider's
 * code is fixed in any case. Reusing it turns the refusal into a no-op.
 *
 * The limits themselves stay untouched. A local server raises them by
 * configuration (see `docs/mobile/running-the-app.md`), which is the actual
 * fix — this is only what keeps the button honest when it hits one.
 */
let lastDevCode: string | null = null;

const RATE_LIMIT_CODES = new Set(['OTP_COOLDOWN_ACTIVE', 'OTP_RATE_LIMITED']);

async function devCode(): Promise<string | null> {
  try {
    const requested = await api.requestOtp(DEV_PHONE);
    lastDevCode = requested.dev_code ?? null;
    return lastDevCode;
  } catch (caught) {
    if (caught instanceof ApiError && RATE_LIMIT_CODES.has(caught.code) && lastDevCode) {
      return lastDevCode;
    }
    throw caught;
  }
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
  brand: { color: BRAND[500] },
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
  prefixText: { ...text.bodyBold, color: color.textPrimary, writingDirection: 'ltr' },
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
    backgroundColor: BRAND[500],
    minHeight: TAP_TARGET + 8,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { backgroundColor: palette.ink[300] },
  buttonText: { ...text.bodyBold, color: palette.white },

  devButton: {
    alignSelf: 'stretch',
    backgroundColor: color.warningSoft,
    borderWidth: 1,
    borderColor: palette.warning[500],
    borderRadius: radius.md,
    minHeight: TAP_TARGET + 8,
    justifyContent: 'center',
    paddingHorizontal: space[4],
    gap: 2,
  },
  devButtonTitle: { ...text.bodyBold, color: palette.warning[700], textAlign: 'center' },
  devButtonText: {
    ...text.small,
    color: palette.warning[700],
    textAlign: 'center',
    writingDirection: 'ltr',
  },

  alternatives: { gap: space[3], alignItems: 'stretch' },
  divider: { ...text.small, color: color.textMuted, textAlign: 'center' },
  googleButton: {
    minHeight: TAP_TARGET + 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.surfaceCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleLabel: { ...text.bodyBold, color: color.textPrimary },

  driverLink: {
    ...text.small,
    color: color.textSecondary,
    fontWeight: '700',
  },
  legal: { ...text.small, color: color.textMuted, textAlign: 'center' },
  link: { color: BRAND[600] },
});

/** Opens one of the legal URLs from the Expo config. */
function openLegal(key: 'termsUrl' | 'privacyPolicyUrl'): void {
  const extra = Constants.expoConfig?.extra as Record<string, string | undefined> | undefined;
  const url = extra?.[key];
  if (url) void Linking.openURL(url).catch(() => undefined);
}
