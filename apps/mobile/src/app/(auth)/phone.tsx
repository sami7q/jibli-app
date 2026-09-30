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
import { holdPendingCredentials } from '@/lib/pending-credentials';
import { PasswordField } from '@/ui/password-field';
import {
  BRAND,
  INPUT_TEXT_START,
  ROW,
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
import { signedInDestination } from '@/lib/after-sign-in';

/**
 * The way in — sign in, or create an account (plan §10).
 *
 * The +964 prefix is shown as fixed chrome so the customer types only their
 * national number, which is what they know. Arabic-Indic digits are normalised
 * as they type, so a customer on an Arabic keypad is never told their correct
 * number is invalid (plan §2).
 *
 * **Two tabs and three ways in.** The screen was one field and one button: a
 * number, and a code by SMS. That is still the strongest proof of a number and
 * it is still here — but it costs a message for every sign-in and it fails
 * whenever delivery does, which on Iraqi networks loses orders. So a password
 * is a second key to the same door:
 *
 *   **تسجيل الدخول** — number and password, instant, no SMS.
 *   **حساب جديد** — name, number, password; the code proves the number before
 *   the account exists, which is what stops somebody registering a number they
 *   do not hold and locking its owner out of their own.
 *   **رمز عبر SMS** — the original flow, kept as the way in for a customer who
 *   has no password yet, and as the one that never depends on remembering one.
 *
 * The comp also draws Apple beside Google. Neither is here by default: there is
 * no social provider configured, and offering one would pull in App Store
 * guideline 4.8 — a third-party login obliges Sign in with Apple beside it.
 */
type Tab = 'signin' | 'signup';

export default function PhoneScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('signin');
  const [rawInput, setRawInput] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);
  const { signIn } = useSession();

  // Validate against the same rules the server uses, so the button state and
  // the server's answer agree.
  const parsed = tryToE164Iraq(rawInput);

  /*
   * What each tab needs before its button lights up.
   *
   * The password length is *not* checked here beyond being non-empty. The
   * policy lives on the server and its refusal names every problem at once, in
   * Arabic; a client-side length rule would either disagree with it or have to
   * be kept in step with it, and the failure mode of disagreeing is a button
   * that stays grey with nothing saying why.
   */
  const canSubmit =
    !isSubmitting &&
    parsed.ok &&
    password.length > 0 &&
    (tab === 'signin' || fullName.trim().length >= 2);

  const handleChange = (value: string) => {
    // Fold Arabic-Indic digits immediately and keep only digits, so the field
    // shows exactly what will be sent.
    setRawInput(normalizeDigits(value).replace(/\D/g, '').slice(0, 11));
    if (error) setError(null);
  };

  /** Switching tabs keeps the number — it is the same person either way. */
  const switchTab = (next: Tab) => {
    setTab(next);
    setError(null);
  };

  /**
   * Turn a thrown error into something the customer can read.
   *
   * The server's Arabic message is authoritative wherever there is one: it
   * knows whether this was a cooldown, a weak password with three specific
   * problems, or a number already registered (plan §76).
   */
  const describe = (caught: unknown, fallback: string): string => {
    if (caught instanceof ApiError) return caught.messageAr;
    if (caught instanceof NetworkError) {
      return 'تعذّر الاتصال بالإنترنت. تحقق من الاتصال وحاول مرة أخرى.';
    }
    return fallback;
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

  /** Number and password — no SMS, no wait. */
  const handlePasswordSignIn = async () => {
    if (!parsed.ok) return;
    setSubmitting(true);
    setError(null);

    try {
      const result = await api.phonePasswordSignIn(parsed.value, password);
      await signIn({
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        userId: result.user.id,
      });
      router.replace(
        (result.next_step === 'COMPLETE_PROFILE'
          ? '/(auth)/profile'
          : signedInDestination()) as never,
      );
    } catch (caught) {
      setError(describe(caught, 'تعذّر تسجيل الدخول، الرجاء المحاولة مرة أخرى'));
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Begin a registration: the server checks the number is free and sends a code.
   *
   * No account exists yet, and the password is not sent anywhere it would be
   * kept. It is held in memory on this device until the code is entered — see
   * `lib/pending-credentials.ts` for why that is not a route param.
   */
  const handleRegister = async () => {
    if (!parsed.ok) return;
    setSubmitting(true);
    setError(null);

    try {
      await api.register(fullName.trim(), parsed.value, password);

      holdPendingCredentials({
        purpose: 'REGISTER',
        phone: parsed.value,
        password,
        fullName: fullName.trim(),
      });

      router.push({
        pathname: '/(auth)/otp',
        params: {
          phone: parsed.value,
          mode: 'register',
        },
      });
    } catch (caught) {
      setError(describe(caught, 'تعذّر إنشاء الحساب، الرجاء المحاولة مرة أخرى'));
    } finally {
      setSubmitting(false);
    }
  };

  /** The original flow, now one of three rather than the only one. */
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
        <Text style={styles.subtitle}>
          {tab === 'signin' ? 'سجّل الدخول للمتابعة' : 'أنشئ حسابك في دقيقة'}
        </Text>
      </View>

      {/*
       * One control, two states — not two buttons that happen to look related.
       *
       * `accessibilityRole="tab"` and `selected` are what make this readable to
       * a screen reader as a choice between two things rather than as two
       * buttons of which one is mysteriously highlighted.
       */}
      <View style={styles.tabs} accessibilityRole="tablist">
        {(
          [
            ['signin', 'تسجيل الدخول'],
            ['signup', 'حساب جديد'],
          ] as const
        ).map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => switchTab(key)}
            disabled={isSubmitting}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: tab === key }}
            style={[styles.tab, tab === key && styles.tabActive]}
          >
            <Text numberOfLines={1} style={[styles.tabText, tab === key && styles.tabTextActive]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/*
       * The name, on signup only.
       *
       * Asked here rather than left to the profile screen because it is the one
       * field of a profile that a *registration* obviously needs — an order
       * arrives at a door and somebody has to be asked for. The governorate and
       * city still come later; a form that asks for everything at once is the
       * form people leave.
       */}
      {tab === 'signup' ? (
        <View style={styles.inputRow}>
          <MaterialCommunityIcons name="account-outline" size={20} color={color.textMuted} />
          <TextInput
            style={[styles.input, styles.textInput]}
            value={fullName}
            onChangeText={(value) => {
              setFullName(value);
              if (error) setError(null);
            }}
            placeholder="الاسم"
            placeholderTextColor={palette.ink[400]}
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            maxLength={80}
            accessibilityLabel="الاسم الكامل"
            editable={!isSubmitting}
          />
        </View>
      ) : null}

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

      <PasswordField
        value={password}
        onChangeText={(value) => {
          setPassword(value);
          if (error) setError(null);
        }}
        placeholder="كلمة السر"
        editable={!isSubmitting}
        /*
         * `new-password` on signup so the keychain offers to *save* rather than
         * to fill, and suggests a strong one. `current-password` on sign-in so
         * it offers the saved one. Getting these the wrong way round is why
         * some apps never autofill.
         */
        autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
        textContentType={tab === 'signup' ? 'newPassword' : 'password'}
        returnKeyType="go"
        onSubmitEditing={() => {
          if (canSubmit) void (tab === 'signin' ? handlePasswordSignIn() : handleRegister());
        }}
      />

      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <Pressable
        style={[styles.button, !canSubmit && styles.buttonDisabled]}
        onPress={tab === 'signin' ? handlePasswordSignIn : handleRegister}
        disabled={!canSubmit}
        accessibilityRole="button"
        accessibilityLabel={tab === 'signin' ? 'دخول' : 'إنشاء حساب'}
        accessibilityState={{ disabled: !canSubmit, busy: isSubmitting }}
      >
        {isSubmitting ? (
          <ActivityIndicator color={palette.white} />
        ) : (
          <Text style={styles.buttonText}>{tab === 'signin' ? 'دخول' : 'إنشاء حساب'}</Text>
        )}
      </Pressable>

      {/*
       * The two ways out of a forgotten password, side by side.
       *
       * A code by SMS is not only the fallback for somebody who never set a
       * password — it is the *only* way to reset one, because the number is
       * what proves the account. Offering both here means a customer who
       * cannot get in has somewhere to go without leaving the screen.
       */}
      {tab === 'signin' ? (
        <View style={styles.recovery}>
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/(auth)/forgot-password',
                ...(parsed.ok ? { params: { phone: parsed.value } } : {}),
              })
            }
            disabled={isSubmitting}
            accessibilityRole="button"
            accessibilityLabel="نسيت كلمة السر"
            hitSlop={space[2]}
            style={styles.recoveryTap}
          >
            <Text style={styles.recoveryLink}>نسيت كلمة السر؟</Text>
          </Pressable>

          <Pressable
            onPress={handleSubmit}
            disabled={!parsed.ok || isSubmitting}
            accessibilityRole="button"
            accessibilityLabel="الدخول برمز عبر رسالة"
            accessibilityState={{ disabled: !parsed.ok || isSubmitting }}
            hitSlop={space[2]}
            style={styles.recoveryTap}
          >
            <Text style={[styles.recoveryLink, !parsed.ok && styles.recoveryLinkDisabled]}>
              الدخول برمز عبر SMS
            </Text>
          </Pressable>
        </View>
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
    /*
     * A segmented control, drawn as one object with a moving fill rather than as
     * two buttons. The tray carries the border; the active tab carries the brand.
     */
    tabs: {
      flexDirection: ROW,
      backgroundColor: palette.ink[50],
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: color.borderSubtle,
      padding: space[1],
      gap: space[1],
    },
    tab: {
      flex: 1,
      minHeight: TAP_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.sm,
    },
    tabActive: { backgroundColor: BRAND[500] },
    // Stretched and centred, never measured at its own width: see the label in `Button`.
    tabText: {
      ...text.bodyBold,
      color: color.textSecondary,
      textAlign: 'center',
      alignSelf: 'stretch',
    },
    tabTextActive: { color: palette.white },

    /** Words, unlike a phone number, follow the layout direction. */
    textInput: { writingDirection: 'auto', textAlign: INPUT_TEXT_START },

    recovery: {
      flexDirection: ROW,
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    recoveryTap: { minHeight: TAP_TARGET, justifyContent: 'center' },
    recoveryLink: { ...text.small, color: BRAND[600], fontWeight: '700' },
    recoveryLinkDisabled: { color: palette.ink[400] },

    header: { gap: space[2], alignItems: 'center', marginBottom: space[4] },
    title: { ...text.h1, color: color.textPrimary, textAlign: 'center' },
    brand: { color: BRAND[500] },
    subtitle: { ...text.body, color: color.textMuted, textAlign: 'center' },

    inputRow: {
      flexDirection: ROW,
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
      flexDirection: ROW,
      alignItems: 'center',
      gap: space[1],
      // The prefix block leads on the right, so the rule that separates it from
      // the number sits on its left. Physical, like every other position in the
      // app: the logical pair follows the native flag.
      paddingLeft: space[3],
      borderLeftWidth: 1,
      borderLeftColor: color.borderSubtle,
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
