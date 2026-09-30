import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import MaterialCommunityIcons from '@/ui/icon';
import { normalizeDigits } from '@jibli/validation/arabic';
import { tryToE164Iraq } from '@jibli/validation/phone';
import { api, ApiError, NetworkError } from '@/lib/api';
import { holdPendingCredentials } from '@/lib/pending-credentials';
import { PasswordField } from '@/ui/password-field';
import { IraqFlag } from '@/ui/brand';
import { BRAND, ROW, lazySheet, TAP_TARGET, color, palette, radius, space, text } from '@/theme';

/**
 * Setting a password again, for a number the customer can still receive on.
 *
 * The number is the root of the account, so it is also the only way back into
 * one: there is no email to send a link to, and there never will be — Jibli
 * identifies a customer by a phone a courier can call. A reset is therefore the
 * same proof as a sign-in, spent on a different outcome.
 *
 * Both fields are asked for here, before the code. It saves a screen, and it
 * means the new password is validated by the server *before* an SMS is spent —
 * a customer who picks something the policy refuses finds out now rather than
 * after waiting for a message.
 *
 * This is also the path for a customer who has only ever used one-time codes
 * and has no password at all. The server treats "no password" and "forgotten
 * password" identically, and so does this screen: neither tells the customer
 * which of the two they are, because saying so would confirm that the number
 * has an account.
 */
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ phone?: string }>();

  /*
   * Pre-filled from the sign-in screen when the number there was already valid,
   * so somebody who mistyped a password does not retype the number as well.
   * Stored as national digits because that is what the field shows.
   */
  const [rawInput, setRawInput] = useState(() =>
    params.phone ? params.phone.replace(/^\+964/, '') : '',
  );
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  const parsed = tryToE164Iraq(rawInput);
  const canSubmit = parsed.ok && password.length > 0 && !isSubmitting;

  const handleSubmit = async () => {
    if (!parsed.ok) return;
    setSubmitting(true);
    setError(null);

    try {
      await api.forgotPassword(parsed.value);

      // Held in memory, never in navigation state — see lib/pending-credentials.ts.
      holdPendingCredentials({ purpose: 'RESET', phone: parsed.value, password });

      router.push({
        pathname: '/(auth)/otp',
        params: { phone: parsed.value, mode: 'reset' },
      });
    } catch (caught) {
      if (caught instanceof ApiError) setError(caught.messageAr);
      else if (caught instanceof NetworkError) {
        setError('تعذّر الاتصال بالإنترنت. تحقق من الاتصال وحاول مرة أخرى.');
      } else setError('حدث خطأ غير متوقع، الرجاء المحاولة مرة أخرى');
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
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
        <Text style={styles.title}>نسيت كلمة السر؟</Text>
        <Text style={styles.subtitle}>
          أدخل رقمك وكلمة سر جديدة، وسنرسل رمزاً للتأكد أن الرقم رقمك.
        </Text>
      </View>

      <View style={styles.inputRow}>
        <View style={styles.prefix}>
          <IraqFlag width={24} />
          <Text style={styles.prefixText}>+964</Text>
        </View>

        <TextInput
          style={styles.input}
          value={rawInput}
          onChangeText={(value) => {
            setRawInput(normalizeDigits(value).replace(/\D/g, '').slice(0, 11));
            if (error) setError(null);
          }}
          placeholder="771 234 5678"
          placeholderTextColor={palette.ink[400]}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          maxLength={11}
          textAlign="left"
          accessibilityLabel="رقم الهاتف"
          editable={!isSubmitting}
        />
      </View>

      <PasswordField
        value={password}
        onChangeText={(value) => {
          setPassword(value);
          if (error) setError(null);
        }}
        placeholder="كلمة السر الجديدة"
        accessibilityLabel="كلمة السر الجديدة"
        autoComplete="new-password"
        textContentType="newPassword"
        editable={!isSubmitting}
        returnKeyType="go"
        onSubmitEditing={() => {
          if (canSubmit) void handleSubmit();
        }}
      />

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
        accessibilityLabel="إرسال رمز التأكيد"
        accessibilityState={{ disabled: !canSubmit, busy: isSubmitting }}
      >
        {isSubmitting ? (
          <ActivityIndicator color={palette.white} />
        ) : (
          <Text style={styles.buttonText}>إرسال رمز التأكيد</Text>
        )}
      </Pressable>

      {/*
       * Said out loud, because the endpoint deliberately answers the same way
       * for a number with an account and one without — and a screen that
       * promised «أرسلنا رمزاً» would be lying to half the people who see it.
       */}
      <Text style={styles.note}>
        إن كان الرقم مسجّلاً لدينا فسيصلك رمز خلال لحظات. تغيير كلمة السر يُنهي الجلسات المفتوحة على
        الأجهزة الأخرى.
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
      right: space[4],
      width: TAP_TARGET,
      height: TAP_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
    },
    header: { gap: space[2], marginBottom: space[2] },
    title: { ...text.h1, color: color.textPrimary, textAlign: 'center' },
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

    note: { ...text.small, color: color.textMuted, textAlign: 'center' },
  }),
);
