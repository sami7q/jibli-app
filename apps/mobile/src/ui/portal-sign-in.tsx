import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { color, radius, space, TAP_TARGET, text } from '@/theme';
import { Button, Row, Text } from '@/ui';
import { JibliWordmark } from '@/ui/brand';

/**
 * The username-and-password screen, for the two audiences that have one.
 *
 * A courier and a shop owner sign in the same way and for the same reason: the
 * account is issued to them by somebody else — the restaurant that hired the
 * courier, the platform that onboarded the shop — so there is a credential to
 * type rather than a number to verify. An OTP would be wrong for both: a
 * delivery handset is often shared, and a shop's login is a business account
 * that outlives whoever is holding the phone.
 *
 * Extracted because the two screens were otherwise the same two hundred lines
 * with four strings changed, and the second copy is where the reveal button
 * quietly stops matching the first.
 *
 * What the caller owns is what actually differs: the words, and what a
 * successful sign-in means.
 */
export function PortalSignIn({
  title,
  subtitle,
  footnote,
  usernamePlaceholder = 'ahmed.ali',
  onSubmit,
}: {
  title: string;
  subtitle: string;
  /** The line under the button — usually how to recover a lost credential. */
  footnote: string;
  usernamePlaceholder?: string;
  /**
   * Resolve to `null` when the sign-in is accepted and the caller has navigated
   * away; resolve to an Arabic message to show it under the fields.
   *
   * Returning the message rather than throwing keeps the "wrong kind of
   * account" case — which is not an error, just the wrong door — in the same
   * shape as a wrong password.
   */
  onSubmit: (username: string, password: string) => Promise<string | null>;
}) {
  const router = useRouter();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = username.trim().length >= 3 && password.length > 0 && !submitting;

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      setError(await onSubmit(username.trim(), password));
    } finally {
      setSubmitting(false);
    }
  };

  const field = {
    minHeight: TAP_TARGET + 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.borderSubtle,
    backgroundColor: color.surfacePage,
    paddingHorizontal: space[3],
    color: color.textPrimary,
    // The credential is Latin whatever the keyboard's language is.
    writingDirection: 'ltr' as const,
    textAlign: 'left' as const,
  };

  return (
    <KeyboardAvoidingView
      style={{
        flex: 1,
        backgroundColor: color.surfaceCard,
        padding: space[6],
        justifyContent: 'center',
        gap: space[4],
      }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {router.canGoBack() ? (
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="رجوع"
          style={{
            position: 'absolute',
            top: space[10],
            // The start corner: the right, where the chevron points.
            right: space[4],
            width: TAP_TARGET,
            height: TAP_TARGET,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MaterialCommunityIcons name="chevron-right" size={26} color={color.textPrimary} />
        </Pressable>
      ) : null}

      <View style={{ alignItems: 'center', gap: space[2] }}>
        <JibliWordmark width={140} />
        <Text variant="h2" align="center">
          {title}
        </Text>
        <Text variant="small" tone="secondary" align="center">
          {subtitle}
        </Text>
      </View>

      <View style={{ gap: space[1] }}>
        <Text variant="caption" tone="muted">
          اسم المستخدم
        </Text>
        <TextInput
          value={username}
          onChangeText={(value) => {
            setUsername(value.trim());
            if (error) setError(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="username"
          placeholder={usernamePlaceholder}
          placeholderTextColor={color.textMuted}
          accessibilityLabel="اسم المستخدم"
          style={[text.body, field]}
        />
      </View>

      <View style={{ gap: space[1] }}>
        <Text variant="caption" tone="muted">
          كلمة المرور
        </Text>
        <Row gap={space[2]}>
          <TextInput
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              if (error) setError(null);
            }}
            secureTextEntry={!reveal}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            accessibilityLabel="كلمة المرور"
            onSubmitEditing={() => void submit()}
            style={[text.body, field, { flex: 1 }]}
          />
          {/*
            A reveal, because this password was read off somebody else's screen
            and is being typed on a phone keyboard, often outdoors.
          */}
          <Pressable
            onPress={() => setReveal((value) => !value)}
            accessibilityRole="button"
            accessibilityState={{ selected: reveal }}
            accessibilityLabel={reveal ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
            style={{
              width: TAP_TARGET,
              height: TAP_TARGET + 6,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MaterialCommunityIcons
              name={reveal ? 'eye-off-outline' : 'eye-outline'}
              size={22}
              color={color.textSecondary}
            />
          </Pressable>
        </Row>
      </View>

      {error ? (
        <View
          style={{
            padding: space[3],
            borderRadius: radius.md,
            backgroundColor: color.dangerSoft,
            borderWidth: 1,
            borderColor: color.danger,
          }}
        >
          <Text variant="small" tone="danger">
            {error}
          </Text>
        </View>
      ) : null}

      <Button
        label={submitting ? 'جارٍ الدخول…' : 'دخول'}
        block
        size="lg"
        disabled={!canSubmit}
        loading={submitting}
        onPress={() => void submit()}
      />

      <Text variant="caption" tone="muted" align="center">
        {footnote}
      </Text>
    </KeyboardAvoidingView>
  );
}
