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
import { useRouter } from 'expo-router';
import { tryToE164Iraq, normalizeDigits } from '@jibli/validation';
import { api, ApiError, NetworkError } from '@/lib/api';
import { colors, radius, spacing, TAP_TARGET, typography } from '@/theme';

/**
 * Phone entry — the first screen of the customer journey (plan §10).
 *
 * The +964 prefix is shown as fixed chrome so the customer types only their
 * national number, which is what they know. Arabic-Indic digits are normalised
 * as they type, so a customer on an Arabic keypad is never told their correct
 * number is invalid (plan §2).
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
      await api.requestOtp(parsed.value);
      router.push({ pathname: '/(auth)/otp', params: { phone: parsed.value } });
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
      <View style={styles.header}>
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
          placeholderTextColor={colors.ink400}
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
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.buttonText}>إرسال رمز التحقق</Text>
        )}
      </Pressable>

      <Text style={styles.legal}>
        بالدخول فإنك توافق على الشروط والأحكام وسياسة الخصوصية
      </Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    padding: spacing.xl,
    justifyContent: 'center',
    gap: spacing.lg,
  },
  header: { gap: spacing.sm, alignItems: 'center', marginBottom: spacing.lg },
  title: { ...typography.h1, color: colors.textPrimary, textAlign: 'center' },
  brand: { color: colors.orange500 },
  subtitle: { ...typography.body, color: colors.textMuted, textAlign: 'center' },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.ink50,
    paddingHorizontal: spacing.md,
    minHeight: TAP_TARGET + 8,
  },
  prefix: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingEnd: spacing.md,
    borderEndWidth: 1,
    borderEndColor: colors.border,
  },
  prefixText: { ...typography.bodyBold, color: colors.textPrimary },
  flag: { fontSize: 18 },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.textPrimary,
    paddingVertical: spacing.md,
    // Digits stay LTR regardless of layout direction.
    writingDirection: 'ltr',
  },

  error: {
    ...typography.caption,
    color: colors.danger,
    backgroundColor: colors.dangerBg,
    padding: spacing.md,
    borderRadius: radius.sm,
  },

  button: {
    backgroundColor: colors.orange500,
    minHeight: TAP_TARGET + 8,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { backgroundColor: colors.ink300 },
  buttonText: { ...typography.bodyBold, color: colors.white },

  legal: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});
