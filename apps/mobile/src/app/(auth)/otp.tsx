import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  type TextStyle,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { formatIraqiPhoneDisplay, normalizeDigits } from '@jibli/validation';
import { Ltr } from '@/ui';
import { api, ApiError, NetworkError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { TAP_TARGET, color, palette, radius, shadow, space, text } from '@/theme';

const OTP_LENGTH = 4;

/**
 * OTP verification (plan §10).
 *
 * The resend countdown mirrors the server's cooldown, so the button is disabled
 * for exactly as long as a resend would be refused — the user never taps into a
 * rejection they could not have predicted.
 */
export default function OtpScreen() {
  const router = useRouter();
  const { signIn } = useSession();
  const { phone, devCode } = useLocalSearchParams<{ phone: string; devCode?: string }>();

  /*
   * Which box takes the next digit.
   *
   * Four identical empty boxes say nothing about where typing lands, and on a
   * phone there is no caret to give it away — the web preview only looked
   * right because the browser drew its own focus ring, which no device does.
   */
  const [focused, setFocused] = useState<number | null>(0);

  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);
  const [resendIn, setResendIn] = useState(45);
  /**
   * The code, when the server sent it.
   *
   * Only a server running with APP_ENV=local does that; staging and production
   * never put an OTP in a response or a log. So this block cannot appear to a
   * real customer — it exists because without it, signing into a locally-run
   * API means reading the server console on every attempt.
   */
  const [devHint, setDevHint] = useState<string | null>(devCode ?? null);

  const inputs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setInterval(() => setResendIn((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendIn]);

  const code = digits.join('');

  const handleDigit = (index: number, value: string) => {
    // Arabic-Indic digits must verify identically to ASCII (plan §2).
    const digit = normalizeDigits(value).replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    if (error) setError(null);

    if (digit && index < OTP_LENGTH - 1) {
      inputs.current[index + 1]?.focus();
    }

    // Auto-submit once the last box is filled — one less tap on a slow phone.
    const assembled = next.join('');
    if (assembled.length === OTP_LENGTH && !assembled.includes('')) {
      void submit(assembled);
    }
  };

  const handleKeyPress = (index: number, key: string) => {
    // Backspace on an empty box moves focus back, which is what users expect.
    if (key === 'Backspace' && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  const submit = async (value: string) => {
    if (!phone || isSubmitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const result = await api.verifyOtp(phone, value);

      /*
       * Through the session provider, not straight to storage.
       *
       * `saveSession` writes the tokens to Keychain/Keystore (plan §79) and
       * stops there — the provider's own state never hears about it. So the
       * app was signed in and the Gate still believed it was signed out, and
       * the moment anything navigated outside `(auth)` it redirected back to
       * the welcome screen. The profile screen survived only because it is
       * inside `(auth)` too; finishing it was what finally left the group and
       * sent a customer who had just verified their number back to «أدخل رقم
       * هاتفك».
       *
       * `signIn` does the same write, clears the guest flag, and re-resolves —
       * which is what `phone.tsx` and `driver-login.tsx` were already doing.
       */
      await signIn({
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        userId: result.user.id,
      });

      // The server decides where the user goes next: profile completion is
      // mandatory and the client does not get to skip it (plan §11).
      router.replace(result.next_step === 'COMPLETE_PROFILE' ? '/(auth)/profile' : '/(tabs)');
    } catch (caught) {
      setDigits(Array(OTP_LENGTH).fill(''));
      inputs.current[0]?.focus();

      if (caught instanceof ApiError) {
        setError(caught.messageAr);
        // An expired or exhausted challenge needs a new code, not another guess.
        if (caught.code === 'OTP_EXPIRED' || caught.code === 'OTP_MAX_ATTEMPTS') {
          setResendIn(0);
        }
      } else if (caught instanceof NetworkError) {
        setError('تعذّر الاتصال بالإنترنت. تحقق من الاتصال وحاول مرة أخرى.');
      } else {
        setError('حدث خطأ غير متوقع، الرجاء المحاولة مرة أخرى');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    if (resendIn > 0 || !phone) return;
    try {
      const result = await api.requestOtp(phone);
      setResendIn(result.resend_after_seconds);
      setDevHint(result.dev_code ?? null);
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.messageAr);
        // Honour the server's cooldown if it disagrees with ours.
        const retryAfter = caught.details.resendAfterSeconds;
        if (typeof retryAfter === 'number') setResendIn(retryAfter);
      }
    }
  };

  const complete = code.length === OTP_LENGTH;

  return (
    <View style={styles.container}>
      <View style={styles.sheet}>
        {/*
         * Two steps, and the screen says which one this is.
         *
         * Sign-in genuinely is a sequence — the code, then the name and area —
         * so a step counter is information rather than decoration. It also
         * answers the question this screen used to leave open: whether
         * entering the code is the end of it.
         */}
        <Text style={styles.step}>الخطوة ١ من ٢</Text>

        <Text style={styles.title}>أدخل رمز التحقق</Text>
        <Text style={styles.subtitle}>أرسلناه إلى رقمك عبر واتساب أو رسالة نصية</Text>

        {/*
         * The number, and a way back to it.
         *
         * A mistyped digit used to be a dead end: the number was printed as
         * plain text with nothing to tap, so the only way to correct it was
         * the system back gesture, which is not visible on this screen. The
         * pill is the affordance — it reads as the value it is, and it is the
         * control that changes it.
         *
         * `Ltr` because `+964 771 234 5678` inside an Arabic paragraph comes
         * out as `5678 234 771 964+`: the bidi algorithm orders Latin runs by
         * the paragraph's direction, and a nested Text inherits it.
         */}
        <Pressable
          onPress={() => router.replace('/(auth)/welcome')}
          accessibilityRole="button"
          accessibilityLabel={`تغيير الرقم، الرقم الحالي ${phone ?? ''}`}
          style={({ pressed }) => [styles.phonePill, pressed ? styles.phonePillPressed : null]}
        >
          <Ltr variant="bodyBold" style={styles.phoneText}>
            {phone ? formatIraqiPhoneDisplay(phone) : ''}
          </Ltr>
          <Text style={styles.phoneChange}>تغيير</Text>
        </Pressable>

        <View style={styles.codeRow}>
          {digits.map((digit, index) => (
            <TextInput
              key={index}
              ref={(element) => {
                inputs.current[index] = element;
              }}
              style={[
                styles.codeBox,
                digit ? styles.codeBoxFilled : null,
                focused === index ? styles.codeBoxFocused : null,
                error ? styles.codeBoxError : null,
              ]}
              value={digit}
              onChangeText={(value) => handleDigit(index, value)}
              onFocus={() => setFocused(index)}
              onBlur={() => setFocused((current) => (current === index ? null : current))}
              onKeyPress={({ nativeEvent }) => handleKeyPress(index, nativeEvent.key)}
              keyboardType="number-pad"
              maxLength={1}
              textAlign="center"
              autoFocus={index === 0}
              editable={!isSubmitting}
              accessibilityLabel={`الرقم ${index + 1} من ${OTP_LENGTH}`}
              // One-time-code autofill on both platforms.
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
            />
          ))}
        </View>

        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}

        {/*
         * The wait, stated rather than greyed out.
         *
         * A disabled link with a timer inside it reads as broken. Two
         * distinct things instead: a quiet line while the clock runs, and a
         * real action when it does not.
         */}
        {resendIn > 0 ? (
          <Text style={styles.resendWaiting}>
            {`يمكن طلب رمز جديد بعد ${String(Math.floor(resendIn / 60)).padStart(2, '0')}:${String(resendIn % 60).padStart(2, '0')}`}
          </Text>
        ) : (
          <Pressable
            onPress={resend}
            accessibilityRole="button"
            accessibilityLabel="إعادة إرسال رمز التحقق"
            style={({ pressed }) => [styles.resendButton, pressed ? { opacity: 0.6 } : null]}
          >
            <Text style={styles.resendText}>لم يصلك الرمز؟ أعد الإرسال</Text>
          </Pressable>
        )}

        {/*
         * One tap, signed in.
         *
         * Only appears when the *server* sent the code, which it does solely
         * for the mock provider or a local run — so this cannot appear to a
         * customer. It fills the boxes and submits in the same gesture,
         * because "fill it and then press confirm" is two taps to prove
         * nothing.
         */}
        {devHint ? (
          <Pressable
            onPress={() => {
              const filled = devHint.slice(0, OTP_LENGTH);
              setDigits(filled.split(''));
              void submit(filled);
            }}
            disabled={isSubmitting}
            accessibilityRole="button"
            accessibilityLabel={`تسجيل الدخول برمز التطوير ${devHint}`}
            style={({ pressed }) => [styles.devHint, pressed ? { opacity: 0.8 } : null]}
          >
            <Text style={styles.devHintTitle}>دخول سريع — وضع التطوير</Text>
            <Text style={styles.devHintText}>اضغط هنا لتسجيل الدخول بالرمز {devHint}</Text>
          </Pressable>
        ) : null}
      </View>

      {/*
       * The action sits on a bar, not in the void.
       *
       * It used to be pushed down by `marginTop: auto` onto a flat white
       * background, which on a tall phone left it stranded a screen away from
       * the boxes it submits with nothing tying them together.
       */}
      <View style={styles.actionBar}>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            !complete || isSubmitting ? styles.buttonDisabled : null,
            pressed && complete ? styles.buttonPressed : null,
          ]}
          onPress={() => void submit(code)}
          disabled={!complete || isSubmitting}
          accessibilityRole="button"
          accessibilityState={{ disabled: !complete || isSubmitting, busy: isSubmitting }}
        >
          {isSubmitting ? (
            <ActivityIndicator color={palette.white} />
          ) : (
            <Text style={styles.buttonText}>تأكيد</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

/*
 * The browser draws a black rectangle over the rounded box on focus, which is
 * what made the code entry look unfinished in the web preview. `outlineStyle`
 * is react-native-web's own property and is absent from React Native's style
 * types, so it is applied only where it exists.
 */
const SUPPRESS_WEB_OUTLINE = (Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) as TextStyle;

/**
 * A layered page, not a flat sheet.
 *
 * The screen was white text fields on a white background with the brand
 * appearing only on the submit button — nothing established depth, so every
 * element floated at the same level and the whole thing read as unfinished.
 * A tinted page behind a white card is the smallest change that fixes it, and
 * it costs no new colour: both values are already in the token set.
 */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surfacePage },

  sheet: {
    flex: 1,
    backgroundColor: color.surfaceCard,
    margin: space[4],
    marginBottom: 0,
    borderRadius: radius.xl,
    paddingHorizontal: space[5],
    paddingTop: space[8],
    gap: space[3],
    alignItems: 'center',
    ...shadow.sm,
  },

  step: {
    ...text.captionBold,
    color: color.textBrand,
    letterSpacing: 0.5,
    marginBottom: space[1],
  },

  title: { ...text.display, color: color.textPrimary, textAlign: 'center' },
  subtitle: {
    ...text.body,
    color: color.textMuted,
    textAlign: 'center',
    marginBottom: space[2],
  },

  phonePill: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: color.brandSoft,
    borderWidth: 1,
    borderColor: palette.orange[200],
    borderRadius: radius.full,
    paddingVertical: space[2],
    paddingHorizontal: space[4],
    minHeight: TAP_TARGET,
  },
  phonePillPressed: { backgroundColor: palette.orange[100] },
  phoneText: { color: color.textPrimary },
  phoneChange: { ...text.smallBold, color: color.textBrand },

  /*
   * The boxes run left to right, against the page.
   *
   * A verification code is a number, and a number is read left to right in
   * every script — typing 1 and watching it land in the rightmost box, then 2
   * to its left, is the confusion this removes. `row-reverse` under a
   * forced-RTL layout is what produces left-to-right.
   */
  codeRow: {
    flexDirection: 'row-reverse',
    gap: space[3],
    marginVertical: space[5],
    alignSelf: 'center',
  },
  codeBox: {
    width: 64,
    height: 76,
    borderWidth: 2,
    borderColor: color.borderSubtle,
    borderRadius: radius.lg,
    backgroundColor: color.surfacePage,
    ...text.display,
    color: color.textPrimary,
    textAlign: 'center',
    ...SUPPRESS_WEB_OUTLINE,
  },
  // Filled and focused are deliberately different: one says "this digit is
  // entered", the other "this is where the next one goes".
  codeBoxFilled: {
    borderColor: color.brand,
    backgroundColor: color.brandSoft,
    color: color.brandDeep,
  },
  /*
   * No shadow here, deliberately: `shadow` is a ViewStyle and these are
   * TextInputs. The focus ring is carried by the border and the lighter fill
   * against the sunken boxes around it, which reads as clearly on a phone.
   */
  codeBoxFocused: {
    borderColor: color.brandStrong,
    borderWidth: 2.5,
    backgroundColor: color.surfaceCard,
  },
  codeBoxError: { borderColor: color.danger, backgroundColor: color.dangerSoft },

  error: {
    ...text.smallBold,
    color: color.dangerStrong,
    backgroundColor: color.dangerSoft,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    textAlign: 'center',
    alignSelf: 'stretch',
  },

  resendWaiting: { ...text.small, color: color.textMuted, textAlign: 'center' },
  resendButton: {
    minHeight: TAP_TARGET,
    justifyContent: 'center',
    paddingHorizontal: space[4],
  },
  resendText: { ...text.bodyBold, color: color.textBrand, textAlign: 'center' },

  devHint: {
    backgroundColor: color.warningSoft,
    borderWidth: 1,
    borderColor: palette.warning[500],
    borderRadius: radius.lg,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    minHeight: TAP_TARGET + 8,
    justifyContent: 'center',
    alignSelf: 'stretch',
    marginTop: space[2],
    gap: 2,
  },
  devHintTitle: { ...text.bodyBold, color: palette.warning[700], textAlign: 'center' },
  devHintText: { ...text.small, color: palette.warning[700], textAlign: 'center' },

  actionBar: {
    backgroundColor: color.surfaceCard,
    paddingHorizontal: space[5],
    paddingTop: space[4],
    paddingBottom: space[6],
    borderTopWidth: 1,
    borderTopColor: color.borderSubtle,
  },
  button: {
    backgroundColor: color.brand,
    minHeight: TAP_TARGET + 8,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: { backgroundColor: color.brandStrong },
  buttonDisabled: { backgroundColor: palette.ink[200] },
  buttonText: { ...text.bodyBold, color: palette.white },
});
