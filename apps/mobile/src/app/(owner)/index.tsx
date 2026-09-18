import { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import MaterialCommunityIcons from '@/ui/icon';
import { api, ApiError } from '@/lib/api';
import { catalogNoun, useOwner } from '@/lib/owner';
import { useSession } from '@/lib/session';
import { color, radius, ROW, shadow, space, TAP_TARGET } from '@/theme';
import { Button, EmptyState, ErrorState, Row, Screen, Skeleton, Text } from '@/ui';

/**
 * Owner Mode — the shop, on one screen.
 *
 * Three questions, in the order a shopkeeper asks them: which shop is this, how
 * many products are in it, and where do I add one. Everything else a merchant
 * account can do — finance, staff, working hours, settlement — stays on the web
 * portal, which is better at tables and is where that work actually gets done.
 *
 * This screen is deliberately small. It is the lobby, and the product list is
 * the room.
 */
export default function OwnerHomeScreen() {
  const router = useRouter();
  const { state } = useSession();
  const owner = useOwner();

  const shop = owner.shop;

  const catalog = useQuery({
    queryKey: ['owner-catalog', shop?.id],
    queryFn: () => api.ownerCatalog(shop?.id as string),
    enabled: Boolean(shop?.id),
    staleTime: 60_000,
  });

  const counts = useMemo(() => {
    const categories = catalog.data?.categories ?? [];
    const products = categories.flatMap((entry) => entry.items);
    return {
      categories: categories.length,
      products: products.length,
      unavailable: products.filter((item) => !item.is_available).length,
      withoutPhoto: products.filter((item) => !item.image_asset_id).length,
    };
  }, [catalog.data]);

  if (state.status === 'signed-out' || state.status === 'guest') {
    return (
      <Screen edges={['top', 'bottom']}>
        <OwnerHeader title="متجري" />
        <EmptyState
          title="سجّل دخولك كصاحب متجر"
          body="بنفس اسم المستخدم وكلمة المرور اللذين تدخل بهما إلى لوحة التحكم."
          action={{ label: 'دخول أصحاب المتاجر', onPress: () => router.push('/(auth)/owner-login') }}
        />
      </Screen>
    );
  }

  if (owner.isLoading) {
    return (
      <Screen edges={['top', 'bottom']}>
        <OwnerHeader title="متجري" />
        <View style={{ gap: space[3], paddingTop: space[4] }}>
          <Skeleton height={104} style={{ borderRadius: radius.xl }} />
          <Skeleton height={72} style={{ borderRadius: radius.lg }} />
        </View>
      </Screen>
    );
  }

  if (owner.isError) {
    return (
      <Screen edges={['top', 'bottom']}>
        <OwnerHeader title="متجري" />
        <ErrorState message="تعذّر تحميل متاجرك" onRetry={owner.refetch} />
      </Screen>
    );
  }

  /*
   * Signed in, but nothing here for them.
   *
   * Two different situations that must not be told as one: an account with no
   * shop at all, and an account whose only shop is a restaurant — which Owner
   * Mode does not serve on purpose, because a dish's modifier groups are a
   * worse job on a phone than in the portal. Saying "you have no shops" to a
   * restaurant owner who plainly does would be a lie about their own account.
   */
  if (!shop) {
    const onlyRestaurants = owner.shops.length > 0;
    return (
      <Screen edges={['top', 'bottom']}>
        <OwnerHeader title="متجري" />
        <EmptyState
          title={onlyRestaurants ? 'إدارة المطاعم على المتصفّح' : 'لا يوجد متجر على هذا الحساب'}
          body={
            onlyRestaurants
              ? 'قوائم المطاعم فيها خيارات وإضافات وأسعار لكل خيار، وتحريرها أدقّ على لوحة التحكم. إدارة المنتجات من التطبيق متاحة لمتاجر الماركت.'
              : 'هذا الحساب لا يملك متجراً. تواصل مع دعم جيبلي إن كان يفترض أن يملك واحداً.'
          }
        />
      </Screen>
    );
  }

  const noun = catalogNoun(shop);

  return (
    <Screen scroll edges={['top']} padded={false}>
      <View style={{ padding: space[4], gap: space[4] }}>
        <OwnerHeader title="متجري" />

        {/* Which shop this is — and, when there is more than one, the way to
            switch. A grocer who adds stock to the wrong branch blames the app,
            and rightly: the app never told them which one it was on. */}
        <View
          style={{
            padding: space[4],
            borderRadius: radius.xl,
            backgroundColor: color.brand,
            gap: space[1],
            ...shadow.md,
          }}
        >
          <Row justify="space-between" align="flex-start">
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="caption" tone="inverse" style={{ opacity: 0.85 }}>
                {shop.merchant_type === 'MARKET' ? 'جيبلي ماركت' : 'جيبلي أكل'}
              </Text>
              <Text variant="h3" tone="inverse" numberOfLines={2}>
                {shop.display_name}
              </Text>
            </View>
            <MaterialCommunityIcons
              name={shop.merchant_type === 'MARKET' ? 'storefront' : 'silverware-fork-knife'}
              size={30}
              color="rgba(255,255,255,0.9)"
            />
          </Row>

          {owner.usable.length > 1 ? (
            <Pressable
              onPress={() => router.push('/(owner)/shops')}
              accessibilityRole="button"
              accessibilityLabel="تبديل المتجر"
              style={({ pressed }) => [
                {
                  flexDirection: ROW,
                  alignItems: 'center',
                  alignSelf: 'flex-start',
                  gap: space[1],
                  marginTop: space[2],
                  paddingVertical: space[1],
                  paddingHorizontal: space[3],
                  borderRadius: radius.full,
                  backgroundColor: 'rgba(255,255,255,0.22)',
                },
                pressed ? { opacity: 0.8 } : null,
              ]}
            >
              <MaterialCommunityIcons name="swap-horizontal" size={15} color="#fff" />
              <Text variant="caption" tone="inverse">
                تبديل المتجر ({owner.usable.length})
              </Text>
            </Pressable>
          ) : null}
        </View>

        {catalog.isError ? (
          <ErrorState
            message={
              catalog.error instanceof ApiError ? catalog.error.messageAr : `تعذّر تحميل ${noun}`
            }
            onRetry={() => void catalog.refetch()}
          />
        ) : (
          <>
            <Row gap={space[3]}>
              <Stat label={noun} value={catalog.isLoading ? '…' : String(counts.products)} />
              <Stat
                label="الأقسام"
                value={catalog.isLoading ? '…' : String(counts.categories)}
              />
              <Stat
                label="غير متوفر"
                value={catalog.isLoading ? '…' : String(counts.unavailable)}
                tone={counts.unavailable > 0 ? 'warning' : 'plain'}
              />
            </Row>

            {/*
              The one number that is a to-do rather than a fact.
              A product with no photograph is the commonest reason a customer
              scrolls past it, and it is the thing the phone is uniquely good at
              fixing — the camera is right here.
            */}
            {!catalog.isLoading && counts.withoutPhoto > 0 ? (
              <Pressable
                onPress={() => router.push('/(owner)/products?filter=no-photo')}
                accessibilityRole="button"
                style={({ pressed }) => [
                  {
                    flexDirection: ROW,
                    alignItems: 'center',
                    gap: space[3],
                    padding: space[3],
                    borderRadius: radius.lg,
                    backgroundColor: color.warningSoft,
                  },
                  pressed ? { opacity: 0.85 } : null,
                ]}
              >
                <MaterialCommunityIcons name="camera-plus-outline" size={22} color={color.warningStrong} />
                <Text variant="small" style={{ flex: 1, color: color.warningStrong }}>
                  {counts.withoutPhoto} من {noun} بلا صورة
                </Text>
                <MaterialCommunityIcons name="chevron-left" size={20} color={color.warningStrong} />
              </Pressable>
            ) : null}

            <Button
              label={`عرض ${noun}`}
              block
              size="lg"
              onPress={() => router.push('/(owner)/products')}
            />

            {owner.can('menu.write') ? (
              <Button
                label="إضافة منتج"
                variant="secondary"
                block
                onPress={() => router.push('/(owner)/product/new')}
              />
            ) : (
              <Text variant="caption" tone="muted" align="center">
                حسابك يستطيع العرض فقط. الإضافة والتعديل تحتاج صلاحية من صاحب المتجر.
              </Text>
            )}
          </>
        )}
      </View>
    </Screen>
  );
}

/** A number and what it counts. Three of these fit one row on the narrowest phone. */
function Stat({
  label,
  value,
  tone = 'plain',
}: {
  label: string;
  value: string;
  tone?: 'plain' | 'warning';
}) {
  return (
    <View
      style={{
        flex: 1,
        padding: space[3],
        borderRadius: radius.lg,
        backgroundColor: color.surfaceCard,
        borderWidth: 1,
        borderColor: tone === 'warning' ? color.warning : color.borderSubtle,
        alignItems: 'center',
        gap: 2,
      }}
    >
      <Text variant="h3" tone={tone === 'warning' ? 'danger' : 'primary'}>
        {value}
      </Text>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** The bar every owner screen wears: a title and the way back out. */
export function OwnerHeader({ title }: { title: string }) {
  const router = useRouter();

  return (
    <Row justify="space-between" style={{ minHeight: TAP_TARGET }}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/account'))}
        accessibilityRole="button"
        accessibilityLabel="رجوع"
        style={{ width: TAP_TARGET, height: TAP_TARGET, justifyContent: 'center' }}
      >
        <MaterialCommunityIcons name="chevron-right" size={26} color={color.textPrimary} />
      </Pressable>
      <Text variant="h3">{title}</Text>
      <View style={{ width: TAP_TARGET }} />
    </Row>
  );
}
