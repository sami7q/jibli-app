import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import MaterialCommunityIcons from '@/ui/icon';
import { isShopSupported, useOwner } from '@/lib/owner';
import { sectionOf } from '@/lib/sections';
import { color, radius, ROW, space, TAP_TARGET } from '@/theme';
import { EmptyState, Row, Screen, Text } from '@/ui';
import { OwnerHeader } from './index';

/**
 * Which shop the phone is working on.
 *
 * Only reachable when there is a genuine choice — one shop means the home
 * screen never draws the switch. It lists the unsupported ones too, greyed and
 * labelled, because an owner of a market and a restaurant who saw only one of
 * them would reasonably conclude the app had lost the other.
 */
export default function OwnerShopsScreen() {
  const router = useRouter();
  const owner = useOwner();

  if (owner.shops.length === 0) {
    return (
      <Screen edges={['top', 'bottom']}>
        <OwnerHeader title="متاجري" />
        <EmptyState title="لا توجد متاجر على هذا الحساب" />
      </Screen>
    );
  }

  return (
    <Screen scroll edges={['top']} padded={false}>
      <View style={{ padding: space[4], gap: space[3] }}>
        <OwnerHeader title="متاجري" />

        {owner.shops.map((entry) => {
          const supported = isShopSupported(entry);
          const current = owner.shop?.id === entry.id;

          return (
            <Pressable
              key={entry.id}
              disabled={!supported}
              onPress={async () => {
                await owner.select(entry.id);
                router.replace('/(owner)');
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: current, disabled: !supported }}
              accessibilityLabel={entry.display_name}
              style={({ pressed }) => [
                {
                  flexDirection: ROW,
                  alignItems: 'center',
                  gap: space[3],
                  minHeight: TAP_TARGET + 16,
                  padding: space[3],
                  borderRadius: radius.lg,
                  backgroundColor: current ? color.brandSoft : color.surfaceCard,
                  borderWidth: 1,
                  borderColor: current ? color.brand : color.borderSubtle,
                  opacity: supported ? 1 : 0.55,
                },
                pressed ? { opacity: 0.8 } : null,
              ]}
            >
              <MaterialCommunityIcons
                name={sectionOf(entry.merchant_type).shopIcon}
                size={24}
                color={current ? color.brand : color.textSecondary}
              />

              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="smallBold" numberOfLines={1}>
                  {entry.display_name}
                </Text>
                <Row gap={space[2]}>
                  <Text variant="caption" tone="muted">
                    {sectionOf(entry.merchant_type).shopNoun}
                  </Text>
                  {!supported ? (
                    <Text variant="caption" tone="muted">
                      · يُدار من لوحة التحكم
                    </Text>
                  ) : null}
                </Row>
              </View>

              {current ? (
                <MaterialCommunityIcons name="check-circle" size={22} color={color.brand} />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}
