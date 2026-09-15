import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { api, ApiError, NetworkError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { color, radius, space, TAP_TARGET, text } from '@/theme';
import { Button, Row, Text } from '@/ui';
import { JibliWordmark } from '@/ui/brand';

/**
 * Sign-in for couriers, in the app.
 *
 * The portal has the same form, and this is not a duplicate of it for the
 * usual reason a second one gets written: a courier works from a phone. They
 * are outside, one-handed, and the thing they need on arrival is the map
 * button and the buttons for «استلمت» and «سلّمت» — which are in the app,
 * beside the phone's own maps and its own keypad.
 *
 * A username and a password rather than an OTP, because the account is created
 * by the restaurant that hired them and the handset a delivery runs on is
 * often shared: a code sent to that number reaches whoever is holding it.
 */
export default function DriverLoginScreen() {
  const router = useRouter();
  const { signIn } = useSession();

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
      const result = await api.passwordSignIn(username.trim(), password);

      /*
       * A restaurant or platform account signing in here would get a session
       * the app cannot use for anything — every screen behind it is a
       * customer's or a courier's. Saying so beats a home screen that refuses
       * every action for reasons it cannot explain.
       */
      if (result.portal !== 'DRIVER') {
        setError('هذا الحساب ليس حساب مندوب. استخدم لوحة التحكم على المتصفّح.');
        return;
      }

      await signIn({
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        userId: result.user.id,
      });

      router.replace('/(driver)/delivery');
    } catch (caught) {
      if (caught instanceof ApiError) setError(caught.messageAr);
      else if (caught instanceof NetworkError) setError('تعذّر الاتصال. تحقّق من الإنترنت.');
      else setError('تعذّر تسجيل الدخول، حاول مرة أخرى');
    } finally {
      setSubmitting(false);
    }
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
            insetInlineStart: space[4],
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
          دخول المندوبين
        </Text>
        <Text variant="small" tone="secondary" align="center">
          اسم المستخدم وكلمة المرور من المطعم الذي تعمل معه.
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
          // The credential is Latin whatever the keyboard's language is.
          textContentType="username"
          placeholder="ahmed.ali"
          placeholderTextColor={color.textMuted}
          accessibilityLabel="اسم المستخدم"
          style={[
            text.body,
            {
              minHeight: TAP_TARGET + 6,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: color.borderSubtle,
              backgroundColor: color.surfacePage,
              paddingHorizontal: space[3],
              color: color.textPrimary,
              writingDirection: 'ltr',
              textAlign: 'left',
            },
          ]}
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
            style={[
              text.body,
              {
                flex: 1,
                minHeight: TAP_TARGET + 6,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: color.borderSubtle,
                backgroundColor: color.surfacePage,
                paddingHorizontal: space[3],
                color: color.textPrimary,
                writingDirection: 'ltr',
                textAlign: 'left',
              },
            ]}
          />
          {/*
            A reveal, because this password was read off somebody else's screen
            and is being typed on a phone keyboard, outdoors.
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
        نسيت بياناتك؟ اطلب من المطعم إصدارها من جديد.
      </Text>
    </KeyboardAvoidingView>
  );
}
