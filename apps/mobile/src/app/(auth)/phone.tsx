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
import { configString } from '@/lib/app-config';
import { useRouter } from 'expo-router';
import MaterialCommunityIcons from '@/ui/icon';
import { normalizeDigits } from '@jibli/validation/arabic';
import { tryToE164Iraq } from '@jibli/validation/phone';
import { api, ApiError, NetworkError } from '@/lib/api';
import {
  BRAND,
  ROW,
  ROW_LTR,
  lazySheet,
  TAP_TARGET,
  color,
  palette,
  radius,
  space,
  text,
} from '@/theme';
import { IraqFlag, JibliWordmark } from '@/ui/brand';
import { isGoogleSignInConfigured, signInWithGoogle } from '@/lib/google-signin';
import { useSession } from '@/lib/session';

/**
 * The way in — a number, then a code (plan §10).
 *
 * The +964 prefix is shown as fixed chrome so the customer types only their
 * national number, which is what they know. Arabic-Indic digits are normalised
 * as they type, so a customer on an Arabic keypad is never told their correct
 * number is invalid (plan §2).
 *
 * **One field and one button.** This screen carried two tabs — number and
 * password, or a new account with a password — beside the code. The password
 * was a second key that the product never meant to issue to customers: a
 * customer is their number, the code proves they hold it, and a password on
 * top of that is a second secret to forget, reset and support. Shop owners and
 * couriers keep theirs; they enter through «صاحب متجر؟» on the welcome screen.
 *
 * The code travels over WhatsApp — that is what the deployed gateway sends,
 * and only that — so the screen says so rather than «SMS».
 *
 * Google, when it is configured, signs a customer in but does not give Jibli a
 * number a driver can call; the gate sends them to verification afterwards.
 * Apple is not offered: there is no social provider configured by default,
 * and a third-party login obliges Sign in with Apple beside it (guideline 4.8).
 */
export default function PhoneScreen() {
  const router = useRouter();
  const [rawInput, setRawInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);
  const { signIn } = useSession();

  // Validate against the same rules the server uses, so the button state and
  // the server's answer agree.
  const parsed = tryToE164Iraq(rawInput);
  const canSubmit = !isSubmitting && parsed.ok;

  const handleChange = (value: string) => {
    // Fold Arabic-Indic digits, keep only digits, then peel the international
    // prefixes a pasted number may carry — +964 / 00964 / 964 — before slicing,
    // so «+964 771 000 0001» becomes the national number rather than being cut
    // mid-prefix to «96477100» (CUST-9).
    let digits = normalizeDigits(value).replace(/\D/g, '');
    if (digits.startsWith('00964')) digits = digits.slice(5);
    else if (digits.startsWith('964')) digits = digits.slice(3);
    // A subscriber number without the trunk zero: restore it once there are
    // enough digits for the server's national form.
    if (!digits.startsWith('0') && digits.length >= 10) digits = `0${digits}`;
    setRawInput(digits.slice(0, 11));
    if (error) setError(null);
  };

  // Once a plausible length is typed and it still will not parse, say why —
  // rather than a greyed button with no explanation (CUST-9).
  const invalidHint =
    !parsed.ok && rawInput.length >= 10 ? 'أدخل رقم موبايل عراقي يبدأ بـ ٠٧' : null;
  const shownError = error ?? invalidHint;

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

  /** Ask for a code, then go and enter it. */
  const handleSubmit = async () => {
    if (!parsed.ok) return;
    setSubmitting(true);
    setError(null);

    try {
      await api.requestOtp(parsed.value);
      router.push({
        pathname: '/(auth)/otp',
        params: { phone: parsed.value },
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
       * A way back, because there is somewhere to go back to: a guest who
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
          service is Iraq-only in Release 1 (plan §10). The flag is drawn, not
          🇮🇶: that emoji is two regional-indicator letters, and a font without
          the flag glyph renders them literally.
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
          // Not 11: a pasted +964/00964 form is longer than the national number
          // it normalises to, and clipping the raw text first threw the tail
          // away before it could be peeled (CUST-9).
          maxLength={20}
          // The number itself reads left-to-right even inside an RTL layout.
          textAlign="left"
          accessibilityLabel="رقم الهاتف"
          accessibilityHint="أدخل رقم هاتفك العراقي بدون مفتاح الدولة"
          editable={!isSubmitting}
          returnKeyType="go"
          onSubmitEditing={() => {
            if (canSubmit) void handleSubmit();
          }}
        />
      </View>

      {shownError ? (
        <Text style={styles.error} accessibilityRole="alert">
          {shownError}
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
       * The channel, named. WhatsApp only: that is what the deployed gateway
       * sends (render.yaml, provider=whatsapp), and a customer who reads
       * «SMS» here and watches the wrong app is a customer who gives up.
       */}
      <View style={styles.channel}>
        <MaterialCommunityIcons name="whatsapp" size={18} color={color.textMuted} />
        <Text style={styles.channelText}>سيصلك رمز التحقق عبر واتساب</Text>
      </View>

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
    </KeyboardAvoidingView>
  );
}

const styles = lazySheet(() =>
  StyleSheet.create({
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
      // The start corner, which in Arabic is the right one — and where a
      // right-pointing chevron belongs.
      right: space[4],
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
      // Left to right, so the country code reads «+964 771…» — the prefix on
      // the left of the LTR number, not stranded to its right (CUST-26).
      flexDirection: ROW_LTR,
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
      flexDirection: ROW_LTR,
      alignItems: 'center',
      gap: space[1],
      // The prefix leads on the left now, so the rule separating it from the
      // number sits on its right.
      paddingRight: space[3],
      borderRightWidth: 1,
      borderRightColor: color.borderSubtle,
    },
    prefixText: { ...text.bodyBold, color: color.textPrimary, writingDirection: 'ltr' },
    input: {
      flex: 1,
      // Without this a flex TextInput keeps its intrinsic min width and pushes
      // the row wider than a 320px screen (CUST-22).
      minWidth: 0,
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

    channel: {
      flexDirection: ROW,
      alignItems: 'center',
      justifyContent: 'center',
      gap: space[2],
    },
    channelText: { ...text.small, color: color.textMuted, textAlign: 'center' },

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

    legal: { ...text.small, color: color.textMuted, textAlign: 'center' },
    link: { color: BRAND[600] },
  }),
);

/** Opens one of the legal URLs from the Expo config. */
function openLegal(key: 'termsUrl' | 'privacyPolicyUrl'): void {
  const url = configString(key);
  if (url) void Linking.openURL(url).catch(() => undefined);
}
