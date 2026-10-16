import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import MaterialCommunityIcons from '@/ui/icon';
import { normalizeDigits } from '@jibli/validation/arabic';
import { api, ApiError, NetworkError } from '@/lib/api';
import { notify } from '@/lib/dialog';
import { useOwner } from '@/lib/owner';
import { useMe, useSession } from '@/lib/session';
import { color, radius, space, TAP_TARGET, text } from '@/theme';
import { Button, EmptyState, Field, Ltr, Row, Screen, Text } from '@/ui';
import { PasswordField } from '@/ui/password-field';
import { OwnerHeader } from '@/ui/owner-header';

/**
 * A new password for the shop's account, proved by the owner's phone.
 *
 * The account was issued by Jibli with a password read out and written on a
 * slip of paper. The way to replace it used to want the current one, on the
 * web. Here the proof is the owner's number instead: Jibli sends a code to
 * the number it holds for the shop — never to one typed here — and whoever
 * enters it chooses the new password. The owner is the one who consents.
 *
 * Two steps on one screen: send, then enter the code with the new password.
 * A phone-only owner has no password to change and is told so.
 */
export default function OwnerPasswordScreen() {
  const router = useRouter();
  const owner = useOwner();
  const me = useMe();
  const { signIn } = useSession();
  const shop = owner.shop;

  const [phoneMasked, setPhoneMasked] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setInterval(() => setResendIn((left) => Math.max(0, left - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendIn]);

  const explain = (caught: unknown) =>
    caught instanceof ApiError
      ? caught.messageAr
      : caught instanceof NetworkError
        ? 'تعذّر الاتصال. تحقّق من الإنترنت.'
        : 'حاول مرة أخرى.';

  const challenge = useMutation({
    mutationFn: () => api.ownerPasswordChallenge(shop?.id as string),
    onSuccess: (result) => {
      setProblem(null);
      setPhoneMasked(result.phone_masked);
      setResendIn(result.resend_after_seconds);
    },
    onError: (caught) => setProblem(explain(caught)),
  });

  const change = useMutation({
    mutationFn: () => api.ownerChangePassword(shop?.id as string, code, password),
    onSuccess: async (result) => {
      /*
       * Every other session was just revoked, this one included. The tokens
       * in the answer are this device's new session; storing them is what
       * keeps the owner signed in after their own change.
       */
      await signIn({
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        userId: me?.user_id as string,
      });
      notify('تم التغيير', result.note_ar);
      router.back();
    },
    onError: (caught) => setProblem(explain(caught)),
  });

  const codeDigits = normalizeDigits(code).replace(/\D/g, '');
  const passwordsMatch = password.length > 0 && password === confirm;
  const canChange =
    codeDigits.length >= 4 && password.length >= 8 && passwordsMatch && !change.isPending;

  if (!shop) {
    return (
      <Screen edges={['top', 'bottom']}>
        <OwnerHeader title="كلمة مرور المتجر" />
        <EmptyState title="لا يوجد متجر مفتوح" body="ارجع واختر متجراً." />
      </Screen>
    );
  }

  if (!me?.username) {
    return (
      <Screen edges={['top', 'bottom']}>
        <OwnerHeader title="كلمة مرور المتجر" />
        <EmptyState
          title="حسابك يدخل برقم الهاتف"
          body="هذا الحساب لا يملك اسم مستخدم وكلمة مرور؛ تدخل إليه برمز يصلك على هاتفك. كلمة المرور تخص الحسابات التي أصدرها فريق جيبلي."
        />
      </Screen>
    );
  }

  return (
    <Screen scroll edges={['top', 'bottom']} padded={false}>
      <View style={{ padding: space[4], gap: space[4], paddingBottom: space[10] }}>
        <OwnerHeader title="كلمة مرور المتجر" />

        <View
          style={{
            padding: space[4],
            gap: space[2],
            borderRadius: radius.xl,
            backgroundColor: color.brandSoft,
            borderWidth: 1,
            borderColor: color.borderSubtle,
          }}
        >
          <Row gap={space[2]}>
            <MaterialCommunityIcons name="shield-check-outline" size={22} color={color.brand} />
            <Text variant="bodyBold">التحقق برقم مالك المتجر</Text>
          </Row>
          <Text variant="small" tone="secondary">
            يُرسل رمز تحقق إلى رقم مالك «{shop.display_name}» المسجّل لدى جيبلي، لا إلى أي رقم آخر.
            بعد إدخاله تختار كلمة مرور جديدة لحساب <Ltr variant="smallBold">{me.username}</Ltr>.
          </Text>
        </View>

        {!phoneMasked ? (
          <Button
            label="أرسل رمز التحقق"
            block
            size="lg"
            loading={challenge.isPending}
            disabled={challenge.isPending}
            onPress={() => challenge.mutate()}
          />
        ) : (
          <>
            <View style={{ gap: space[1] }}>
              <Text variant="small" tone="secondary">
                أُرسل الرمز إلى <Ltr variant="smallBold">{phoneMasked}</Ltr>
              </Text>
              {resendIn > 0 ? (
                <Text variant="caption" tone="muted">
                  يمكنك طلب رمز جديد بعد {resendIn} ثانية.
                </Text>
              ) : (
                <Button
                  label="إعادة إرسال الرمز"
                  variant="ghost"
                  loading={challenge.isPending}
                  onPress={() => challenge.mutate()}
                />
              )}
            </View>

            <Field label="رمز التحقق" hint="الأرقام التي وصلت في الرسالة">
              <TextInput
                value={code}
                onChangeText={(value) => {
                  setCode(normalizeDigits(value).replace(/\D/g, '').slice(0, 8));
                  setProblem(null);
                }}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                maxLength={8}
                accessibilityLabel="رمز التحقق"
                style={[
                  text.h2,
                  {
                    minHeight: TAP_TARGET + 12,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: color.borderSubtle,
                    backgroundColor: color.surfaceCard,
                    paddingHorizontal: space[3],
                    color: color.textPrimary,
                    letterSpacing: 6,
                    textAlign: 'center',
                    writingDirection: 'ltr',
                  },
                ]}
              />
            </Field>

            <Field label="كلمة المرور الجديدة" hint="٨ أحرف على الأقل، ولا تحوي اسم المستخدم.">
              <PasswordField
                value={password}
                onChangeText={(value) => {
                  setPassword(value);
                  setProblem(null);
                }}
                placeholder="كلمة المرور الجديدة"
                accessibilityLabel="كلمة المرور الجديدة"
                autoComplete="new-password"
                textContentType="newPassword"
              />
            </Field>

            <Field
              label="تأكيد كلمة المرور"
              error={confirm.length > 0 && !passwordsMatch ? 'كلمتا المرور غير متطابقتين' : null}
            >
              <PasswordField
                value={confirm}
                onChangeText={setConfirm}
                placeholder="أعد كتابتها"
                accessibilityLabel="تأكيد كلمة المرور"
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (canChange) change.mutate();
                }}
              />
            </Field>

            <Button
              label="تغيير كلمة المرور"
              block
              size="lg"
              disabled={!canChange}
              loading={change.isPending}
              onPress={() => change.mutate()}
            />
          </>
        )}

        {problem ? (
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
              {problem}
            </Text>
          </View>
        ) : null}

        <Text variant="caption" tone="muted" align="center">
          بعد التغيير تُنهى كل الجلسات الأخرى لهذا الحساب، ويبقى هذا الهاتف مسجّلاً.
        </Text>
      </View>
    </Screen>
  );
}
