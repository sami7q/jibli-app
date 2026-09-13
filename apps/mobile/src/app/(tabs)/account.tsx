import { useState } from 'react';
import { View } from 'react-native';
import Constants from 'expo-constants';
import { useSession } from '@/lib/session';
import { space } from '@/theme';
import { Button, Card, Divider, Ltr, Row, Screen, Text } from '@/ui';

/**
 * Account.
 *
 * Deliberately small. Everything a customer needs to *do* lives on the other
 * two tabs; this is where they check who they are signed in as, find the app
 * version when support asks for it, and sign out.
 */
export default function AccountScreen() {
  const { state, signOut } = useSession();
  const [confirming, setConfirming] = useState(false);

  const me = state.status === 'ready' || state.status === 'needs-profile' ? state.me : null;

  return (
    <Screen scroll edges={['top']}>
      <Text variant="h2" style={{ marginBottom: space[3] }}>
        حسابي
      </Text>

      <Card>
        <Text variant="bodyBold">{me?.full_name ?? 'مستخدم جيبلي'}</Text>
        <Divider />

        <Row justify="space-between">
          <Text tone="muted" variant="small">
            حالة الملف
          </Text>
          <Text variant="small">
            {me?.profile_completed ? 'مكتمل' : 'غير مكتمل'}
          </Text>
        </Row>

        {state.status === 'offline-ready' ? (
          <>
            <Divider spacing={space[2]} />
            <Text variant="caption" tone="muted">
              أنت غير متصل — بعض البيانات قد تكون قديمة.
            </Text>
          </>
        ) : null}
      </Card>

      <View style={{ height: space[4] }} />

      <Card>
        <Row justify="space-between">
          <Text tone="muted" variant="small">
            إصدار التطبيق
          </Text>
          {/* Latin inside Arabic: isolated so "1.0.0" is not reordered. */}
          <Ltr variant="small" tone="secondary">
            {Constants.expoConfig?.version ?? '1.0.0'}
          </Ltr>
        </Row>
      </Card>

      <View style={{ height: space[6] }} />

      {confirming ? (
        <Card>
          <Text variant="bodyBold">تسجيل الخروج؟</Text>
          <Text tone="muted" variant="small" style={{ marginTop: space[1] }}>
            ستحتاج إلى رمز تحقق جديد لتسجيل الدخول مرة أخرى. طلباتك محفوظة ولا تتأثر.
          </Text>
          <Row gap={space[2]} style={{ marginTop: space[3] }}>
            <Button label="خروج" variant="danger" onPress={() => void signOut()} />
            <Button label="إلغاء" variant="ghost" onPress={() => setConfirming(false)} />
          </Row>
        </Card>
      ) : (
        <Button label="تسجيل الخروج" variant="secondary" block onPress={() => setConfirming(true)} />
      )}
    </Screen>
  );
}
