import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { formatIraqiPhoneDisplay, normalizeDigits } from '@jibli/validation';
import { api, ApiError, NetworkError } from '@/lib/api';
import { saveSession } from '@/lib/secure-session';
import { TAP_TARGET, color, palette, radius, space, text } from '@/theme';

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
  const { phone, devCode } = useLocalSearchParams<{ phone: string; devCode?: string }>();

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

      // Tokens go straight to Keychain/Keystore, never AsyncStorage (plan §79).
      await saveSession({
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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>تحقق من رقمك</Text>
      <Text style={styles.subtitle}>
        أدخل رمز التحقق المرسل إلى{'\n'}
        <Text style={styles.phone}>{phone ? formatIraqiPhoneDisplay(phone) : ''}</Text>
      </Text>

      <View style={styles.codeRow}>
        {digits.map((digit, index) => (
          <TextInput
            key={index}
            ref={(element) => {
              inputs.current[index] = element;
            }}
            style={[styles.codeBox, digit ? styles.codeBoxFilled : null]}
            value={digit}
            onChangeText={(value) => handleDigit(index, value)}
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

      {devHint ? (
        <Pressable
          onPress={() => {
            setDigits(devHint.slice(0, OTP_LENGTH).split(''));
            void submit(devHint.slice(0, OTP_LENGTH));
          }}
          accessibilityRole="button"
          accessibilityLabel={`استخدام رمز التطوير ${devHint}`}
          style={styles.devHint}
        >
          <Text style={styles.devHintText}>وضع التطوير — الرمز: {devHint} (اضغط للتعبئة)</Text>
        </Pressable>
      ) : null}

      {isSubmitting ? <ActivityIndicator color={color.brand} /> : null}

      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <Pressable
        onPress={resend}
        disabled={resendIn > 0}
        accessibilityRole="button"
        accessibilityLabel="إعادة إرسال رمز التحقق"
        accessibilityState={{ disabled: resendIn > 0 }}
      >
        <Text style={[styles.resend, resendIn > 0 && styles.resendDisabled]}>
          {resendIn > 0
            ? `إعادة الإرسال خلال ${String(Math.floor(resendIn / 60)).padStart(2, '0')}:${String(resendIn % 60).padStart(2, '0')}`
            : 'إعادة إرسال الرمز'}
        </Text>
      </Pressable>

      <Pressable
        style={[styles.button, code.length !== OTP_LENGTH && styles.buttonDisabled]}
        onPress={() => void submit(code)}
        disabled={code.length !== OTP_LENGTH || isSubmitting}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>تأكيد</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.surfaceCard,
    padding: space[6],
    gap: space[4],
    alignItems: 'center',
    paddingTop: space[8] * 2,
  },
  title: { ...text.h1, color: color.textPrimary },
  subtitle: { ...text.body, color: color.textMuted, textAlign: 'center' },
  phone: { ...text.bodyBold, color: color.textPrimary, writingDirection: 'ltr' },

  codeRow: { flexDirection: 'row', gap: space[3], marginVertical: space[4] },
  codeBox: {
    width: 56,
    height: 64,
    borderWidth: 1.5,
    borderColor: color.borderSubtle,
    borderRadius: radius.md,
    backgroundColor: palette.ink[50],
    ...text.h1,
    color: color.textPrimary,
  },
  codeBoxFilled: { borderColor: color.brand, backgroundColor: color.brandSoft },

  devHint: {
    backgroundColor: color.warningSoft,
    borderRadius: radius.sm,
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    minHeight: TAP_TARGET,
    justifyContent: 'center',
  },
  devHintText: { ...text.small, color: color.warningStrong, textAlign: 'center' },

  error: {
    ...text.small,
    color: color.danger,
    backgroundColor: color.dangerSoft,
    padding: space[3],
    borderRadius: radius.sm,
    textAlign: 'center',
    alignSelf: 'stretch',
  },

  resend: { ...text.body, color: color.brandStrong, fontWeight: '700' },
  resendDisabled: { color: color.textMuted, fontWeight: '400' },

  button: {
    backgroundColor: color.brand,
    minHeight: TAP_TARGET + 8,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    marginTop: 'auto',
    marginBottom: space[6],
  },
  buttonDisabled: { backgroundColor: palette.ink[300] },
  buttonText: { ...text.bodyBold, color: palette.white },
});
