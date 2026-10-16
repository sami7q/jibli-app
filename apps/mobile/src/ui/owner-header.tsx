import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import MaterialCommunityIcons from '@/ui/icon';
import { color, TAP_TARGET } from '@/theme';
import { Row, Text } from '@/ui';

/**
 * The bar every owner screen wears: a title and the way back out.
 *
 * Lifted out of the owner home screen so it can be shared without that screen
 * being a route's index. Owner Mode's home lives at `/(owner)/owner` — a real
 * URL segment, so a cold start resolves to the customer tabs rather than the
 * seller screen (CUST-3) — and a header imported from a route file would have
 * moved with it, breaking every sub-screen that renders one.
 */
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
