import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
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
import { clearPendingCredentials, readPendingCredentials } from '@/lib/pending-credentials';
import { useSession } from '@/lib/session';
import {
  BRAND,
  ROW,
  ROW_LTR,
  TAP_TARGET,
  color,
  palette,
  radius,
  shadow,
  space,
  text,
} from '@/theme';

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
  /**
   * Which flow spent the code, and therefore what proving the number buys.
   *
   * One screen for three outcomes — sign in, finish a registration, set a new
   * password — because the *question* is identical in all three: does this
   * person hold this number? Only the answer's consequence differs, and that
   * is one call at the bottom of `submit`.
   *
   * `login` when absent, so every existing link into this screen is unchanged.
   */
  const { phone, devCode, mode } = useLocalSearchParams<{
    phone: string;
    devCode?: string;
    mode?: 'register' | 'reset';
  }>();

  const flow: 'login' | 'register' | 'reset' = mode ?? 'login';

  /*
   * One field, drawn as four boxes.
   *
   * This was four TextInputs, one per digit, and every visible problem with
   * the screen came from that. A TextInput draws its own text: Cairo's Arabic
   * metrics reserve room for marks above and below the line, so a Latin digit
   * in a 70pt-tall field sat high and small, and iOS drew its own blue caret
   * on top. The paste and backspace handling existed only to paper over the
   * split — and iOS offers a one-time code to a single field, not to a row.
   *
   * So typing goes into one invisible input laid over the row, and the boxes
   * are plain Views that render `code`. What the customer sees is now ours:
   * the digit is centred by layout rather than by font metrics, and the caret
   * is drawn in the brand colour.
   */
  const [code, setCode] = useState('');
  const [focused, setFocused] = useState(true);
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

  const input = useRef<TextInput | null>(null);
  const caret = useBlink(focused && code.length < OTP_LENGTH);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setInterval(() => setResendIn((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendIn]);

  const handleChange = (value: string) => {
    // Arabic-Indic digits must verify identically to ASCII (plan §2).
    const typed = normalizeDigits(value).replace(/\D/g, '').slice(0, OTP_LENGTH);
    if (error) setError(null);
    setCode(typed);

    /*
     * Complete: verify it, and do not ask for a tap.
     *
     * A pasted or autofilled code arrives whole and lands here in one change,
     * exactly as four taps would — there is no longer a per-box path for it to
     * be spread across, or lost in.
     */
    if (typed.length === OTP_LENGTH) {
      input.current?.blur();
      void submit(typed);
    }
  };

  const focusInput = () => {
    if (!isSubmitting) input.current?.focus();
  };

  const submit = async (value: string) => {
    if (!phone || isSubmitting) return;
    setSubmitting(true);
    setError(null);

    try {
      /*
       * Three endpoints, one answer shape.
       *
       * Registration and reset need the password back, and it was never sent
       * to the server in the first place — it has been held in memory on this
       * device since the previous screen. If it is gone, the process was
       * restarted mid-flow and there is nothing to complete: the customer is
       * sent back to start rather than shown a code box that cannot succeed.
       */
      const held = flow === 'login' ? null : readPendingCredentials(
        flow === 'register' ? 'REGISTER' : 'RESET',
        phone,
      );

      if (flow !== 'login' && !held) {
        setError('انتهت الجلسة. ابدأ من جديد.');
        setSubmitting(false);
        router.replace('/(auth)/phone');
        return;
      }

      const result =
        flow === 'register'
          ? await api.registerVerify(held?.fullName ?? '', phone, held?.password ?? '', value)
          : flow === 'reset'
            ? await api.resetPassword(phone, value, held?.password ?? '')
            : await api.verifyOtp(phone, value);

      // The account exists, or the password is set. Nothing left to hold.
      clearPendingCredentials();

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
      setCode('');
      input.current?.focus();

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
      /*
       * Resend through the endpoint this flow started at.
       *
       * A code carries the purpose it was issued for, and only spends on that
       * purpose. Resending a registration through `requestOtp` would deliver a
       * perfectly valid *sign-in* code that the register step then refuses —
       * a dead end whose only symptom is "the code you just received is wrong".
       */
      const held = flow === 'login' ? null : readPendingCredentials(
        flow === 'register' ? 'REGISTER' : 'RESET',
        phone,
      );

      const result =
        flow === 'register' && held
          ? await api.register(held.fullName ?? '', phone, held.password)
          : flow === 'reset'
            ? await api
                .forgotPassword(phone)
                // That endpoint answers the same way for every number and so
                // reports no cooldown; the local one is what the button uses.
                .then(() => ({ resend_after_seconds: 45, dev_code: undefined }))
            : await api.requestOtp(phone);

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
        {/* WhatsApp only: production sends `provider=whatsapp` (render.yaml). */}
        <Text style={styles.subtitle}>أرسلناه إلى رقمك عبر واتساب</Text>

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

        <Pressable onPress={focusInput} accessible={false} style={styles.codeRow}>
          {Array.from({ length: OTP_LENGTH }, (_, index) => {
            const digit = code[index] ?? '';
            // The box the next digit goes into; the last one once all are in.
            const active =
              focused && !isSubmitting && index === Math.min(code.length, OTP_LENGTH - 1);
            return (
              <View
                key={index}
                style={[
                  styles.codeBox,
                  digit ? styles.codeBoxFilled : null,
                  active ? styles.codeBoxFocused : null,
                  error ? styles.codeBoxError : null,
                ]}
              >
                {digit ? (
                  <Text style={styles.codeDigit} allowFontScaling={false}>
                    {digit}
                  </Text>
                ) : active ? (
                  <Animated.View style={[styles.caret, { opacity: caret }]} />
                ) : null}
              </View>
            );
          })}

          {/*
           * The real input: over the boxes, invisible.
           *
           * Laid over the row rather than off-screen, so a tap anywhere on the
           * boxes lands in it natively — which is also what keeps the system's
           * one-time-code suggestion attached to it.
           */}
          <TextInput
            ref={input}
            value={code}
            onChangeText={handleChange}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            keyboardType="number-pad"
            maxLength={OTP_LENGTH}
            autoFocus
            caretHidden
            editable={!isSubmitting}
            accessibilityLabel={`رمز التحقق، ${OTP_LENGTH} أرقام`}
            // One-time-code autofill on both platforms.
            textContentType="oneTimeCode"
            autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
            style={styles.hiddenInput}
          />
        </Pressable>

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
              setCode(filled);
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

/**
 * A caret's blink, as an opacity. Held solid while `on` is false, so nothing
 * animates behind a keyboard that is not open.
 */
function useBlink(on: boolean): Animated.Value {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    opacity.setValue(1);
    if (!on) return;
    const useNativeDriver = Platform.OS !== 'web';
    const step = (toValue: number) =>
      Animated.timing(opacity, { toValue, duration: 450, easing: Easing.linear, useNativeDriver });
    const loop = Animated.loop(Animated.sequence([step(0), step(1)]));
    loop.start();
    return () => loop.stop();
  }, [on, opacity]);
  return opacity;
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
    color: BRAND[600],
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
    flexDirection: ROW,
    alignItems: 'center',
    gap: space[3],
    backgroundColor: BRAND[50],
    borderWidth: 1,
    borderColor: BRAND[200],
    borderRadius: radius.full,
    paddingVertical: space[2],
    paddingHorizontal: space[4],
    minHeight: TAP_TARGET,
  },
  phonePillPressed: { backgroundColor: BRAND[100] },
  phoneText: { color: color.textPrimary },
  phoneChange: { ...text.smallBold, color: BRAND[600] },

  /*
   * The boxes run left to right, against the page.
   *
   * A verification code is a number, and a number is read left to right in
   * every script — typing 1 and watching it land in the rightmost box, then 2
   * to its left, is the confusion this removes. `row-reverse` under a
   * forced-RTL layout is what produces left-to-right.
   */
  codeRow: {
    /*
     * Left to right, because a verification code is a number.
     *
     * This was `row-reverse`, which put the first digit typed in the rightmost
     * box: entering 1234 produced a row reading «4 3 2 1». The layout was
     * following the language and the content is not language — it is four
     * digits that have one order, the order they were read out or texted in.
     *
     * `ROW_LTR` rather than a literal, because "left to right" is spelled
     * differently depending on whether the platform is already laying out
     * right-to-left: `row` on a device where the native flag never took, and
     * `row-reverse` in a browser under `dir="rtl"`, where CSS has already
     * flipped the main axis.
     */
    flexDirection: ROW_LTR,
    gap: space[3],
    marginVertical: space[6],
    alignSelf: 'center',
  },
  codeBox: {
    width: 60,
    height: 70,
    borderWidth: 1.5,
    borderColor: color.borderSubtle,
    borderRadius: radius.lg,
    backgroundColor: color.surfacePage,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /*
   * The digit, in the platform's own face rather than Cairo.
   *
   * Cairo is an Arabic face whose Latin figures sit small against its tall
   * line box — at 24pt in a 70pt field they read as an afterthought, and
   * orange-on-peach took away what contrast was left. SF and Roboto have
   * figures drawn to be checked one by one against a message in another app,
   * which is exactly the job here; `tabular-nums` gives all ten the same
   * width so four digits sit identically in four boxes.
   */
  codeDigit: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    color: color.textPrimary,
    textAlign: 'center',
    includeFontPadding: false,
    // The digits are the one thing on this screen that must not be reordered.
    writingDirection: 'ltr',
  },
  // Filled and focused are deliberately different: one says "this digit is
  // entered", the other "this is where the next one goes".
  codeBoxFilled: {
    borderColor: BRAND[300],
    backgroundColor: color.surfaceCard,
  },
  codeBoxFocused: {
    borderColor: BRAND[600],
    borderWidth: 2,
    backgroundColor: color.surfaceCard,
    ...shadow.sm,
  },
  caret: {
    width: 2,
    height: 34,
    borderRadius: 1,
    backgroundColor: BRAND[600],
  },
  /*
   * Present and focusable, but never seen. Not opacity 0: some Android builds
   * refuse focus to a fully transparent view.
   */
  hiddenInput: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0.011,
    color: 'transparent',
    fontSize: 1,
    ...SUPPRESS_WEB_OUTLINE,
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
  resendText: { ...text.bodyBold, color: BRAND[600], textAlign: 'center' },

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
    backgroundColor: BRAND[500],
    minHeight: TAP_TARGET + 8,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: { backgroundColor: BRAND[600] },
  buttonDisabled: { backgroundColor: palette.ink[200] },
  buttonText: { ...text.bodyBold, color: palette.white },
});
