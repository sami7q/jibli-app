import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import MaterialCommunityIcons from '@/ui/icon';
import { clearAfterSignIn, continueAfterSignIn } from '@/lib/after-sign-in';
import { SECTIONS } from '@/lib/sections';
import { useSession } from '@/lib/session';
import { BRAND, color, palette, space, TAP_TARGET } from '@/theme';
import { Row, Screen, Text } from '@/ui';
import { JibliWordmark } from '@/ui/brand';
import { Door, KindBadge, Step } from '@/ui/partner-doors';

/**
 * «صاحب متجر؟» — the two ways in for a seller, asked before anything else.
 *
 * The welcome screen's seller link used to go straight to the phone sign-in
 * with the application form remembered as the destination. That is right for
 * somebody registering a shop for the first time, and wrong for the other
 * seller the app has: the owner of a market or cosmetics shop whose username
 * and password Jibli's team issued. They were asked for a phone number, then
 * for the details of a shop that already exists, and the door they wanted
 * was two screens away behind a ghost link.
 *
 * So the question comes first. Two doors of the same size:
 *
 *   register — the application form, filed by the signed-in account, which is
 *              why a visitor signs in with their number on the way there;
 *   sign in  — the shop's own username and password, straight to «متجري».
 *
 * Reached signed out (from the welcome screen) and signed in alike: the first
 * door simply skips the phone step when there is already an account.
 */
export default function PartnerDoorsScreen() {
  const router = useRouter();
  const { state } = useSession();
  const signedIn =
    state.status === 'ready' ||
    state.status === 'offline-ready' ||
    state.status === 'needs-profile';

  // Arriving here is a choice not yet made; whatever an earlier tap remembered is stale.
  useEffect(() => clearAfterSignIn(), []);

  const startRegistration = () => {
    if (signedIn) {
      router.push('/(owner)/apply');
      return;
    }
    // The form files the application as the signed-in account, so the visitor
    // signs in first and the sign-in screens bring them here rather than home.
    continueAfterSignIn('/(owner)/apply');
    router.push('/(auth)/phone');
  };

  return (
    <Screen scroll edges={['top', 'bottom']} padded={false}>
      <StatusBar style="dark" />

      <Row justify="space-between" style={{ paddingHorizontal: space[4], minHeight: TAP_TARGET }}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(auth)/welcome'))}
          accessibilityRole="button"
          accessibilityLabel="رجوع"
          style={{ width: TAP_TARGET, height: TAP_TARGET, justifyContent: 'center' }}
        >
          <MaterialCommunityIcons name="chevron-right" size={26} color={color.textPrimary} />
        </Pressable>
        <Text variant="h3">صاحب متجر؟</Text>
        <View style={{ width: TAP_TARGET }} />
      </Row>

      <View style={{ padding: space[4], gap: space[4], paddingBottom: space[10] }}>
        <View style={{ alignItems: 'center', gap: space[3] }}>
          <JibliWordmark width={120} tint={BRAND[500]} pinTint={palette.white} />
          <Row gap={space[2]}>
            <KindBadge kind="MARKET" />
            <KindBadge kind="COSMETICS" />
          </Row>
          <Text variant="body" tone="secondary" align="center">
            جيبلي يوصّل من الماركتات ومتاجر التجميل كما يوصّل من المطاعم. كيف تريد الدخول؟
          </Text>
        </View>

        <Door
          icon="storefront-outline"
          title="سجّل متجرك في جيبلي"
          body="ماركت أو متجر تجميل جديد على جيبلي. قدّم بياناته، يوافق عليه فريق جيبلي، ثم تديره من هذا التطبيق: منتجات بالصور، أسعار، وطلبات تستلمها وتجهّزها."
          cta={signedIn ? 'ابدأ التسجيل — دقيقتان' : 'سجّل الدخول وابدأ التسجيل'}
          note={signedIn ? undefined : 'يُسجَّل المتجر باسم حسابك، لذا يُطلب رقم هاتفك أولاً.'}
          onPress={startRegistration}
        >
          <View style={{ gap: space[2] }}>
            <Step number="١" text="بيانات المتجر — اسمه، نوعه، ومدينته" />
            <Step number="٢" text="يتصل بك فريق جيبلي ويوافق على المتجر" />
            <Step number="٣" text="أضف منتجاتك وأسعارك، واستلم الطلبات من التطبيق" />
          </View>
        </Door>

        <Door
          icon="key-outline"
          tint={SECTIONS.MARKET.ramp}
          title="لديّ حساب متجر"
          body="أصدر لك فريق جيبلي اسم مستخدم وكلمة مرور؟ ادخل بهما لتفتح متجرك: المنتجات، الأسعار، والطلبات الحيّة."
          cta="الدخول باسم المستخدم"
          onPress={() => router.push('/(auth)/owner-login')}
        />

        {/*
          The courier's door. A driver's username and password are issued by
          the shop that hired them, and the screen that takes them existed
          with nothing leading to it — reachable by deep link and by nobody
          who had not been told the link. The welcome screen's seller door is
          where somebody who is not a customer looks first, so it is here.
        */}
        <Door
          icon="motorbike"
          title="مندوب توصيل؟"
          body="أصدر لك المطعم أو المتجر الذي تعمل معه اسم مستخدم وكلمة مرور؟ ادخل بهما لتستلم التوصيلات وتتابعها من هذا التطبيق."
          cta="دخول المندوبين"
          onPress={() => router.push('/(auth)/driver-login')}
        />

        <Text variant="caption" tone="muted" align="center">
          صاحب مطعم؟ قوائم المطاعم تُدار من لوحة التحكم على المتصفّح.
        </Text>
      </View>
    </Screen>
  );
}
