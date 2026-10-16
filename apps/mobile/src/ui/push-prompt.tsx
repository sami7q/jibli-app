import { Linking, Pressable, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import MaterialCommunityIcons from '@/ui/icon';
import { Text } from '@/ui';
import { isPushBroken, pushPermission, registerForPush } from '@/lib/push';
import { BRAND, ROW, color, radius, space } from '@/theme';

/**
 * «Order alerts are off» — for the two people who cannot afford that.
 *
 * With the app open a new order rings regardless; closed, only a push reaches
 * the phone, and a shop owner who once tapped «Don't allow» would never find
 * out why orders go unanswered overnight. So the shop's home and the courier's
 * screen say so, and offer the one step that fixes it: asking again while the
 * system still allows it, the settings page once it does not.
 *
 * Draws nothing when push is on, or where it does not exist (Expo Go, web).
 */
export function PushPrompt({ audience }: { audience: 'owner' | 'driver' }) {
  const queryClient = useQueryClient();
  const permission = useQuery({
    queryKey: ['push-permission'],
    queryFn: pushPermission,
    staleTime: 30_000,
  });

  const enable = useMutation({
    mutationFn: registerForPush,
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['push-permission'] }),
  });

  /*
   * Permission granted is not the same as reachable. With it granted, the
   * token request still fails on a build without FCM credentials — and the
   * owner, told nothing, believes the phone will ring with the app closed.
   */
  const registration = useQuery({
    queryKey: ['push-registration'],
    queryFn: registerForPush,
    enabled: permission.data === 'granted',
    staleTime: 10 * 60_000,
  });

  const state = permission.data;
  if (state === 'granted' && isPushBroken(registration.data)) {
    return (
      <View
        style={{
          flexDirection: ROW,
          alignItems: 'center',
          gap: space[3],
          padding: space[3],
          borderRadius: radius.lg,
          backgroundColor: color.dangerSoft,
          borderWidth: 1,
          borderColor: color.danger,
        }}
      >
        <MaterialCommunityIcons name="bell-alert-outline" size={24} color={color.dangerStrong} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="smallBold" style={{ color: color.dangerStrong }}>
            {audience === 'owner' ? 'الطلبات لا تصل والتطبيق مغلق' : 'المهام لا تصل والتطبيق مغلق'}
          </Text>
          <Text variant="caption" tone="secondary">
            تعذّر تسجيل هذا الهاتف للإشعارات. أبقِ التطبيق مفتوحاً لتسمع{' '}
            {audience === 'owner' ? 'الطلبات الجديدة' : 'المهام الجديدة'}، وأبلغ فريق جيبلي.
          </Text>
        </View>
        <Pressable
          onPress={() => void registration.refetch()}
          disabled={registration.isFetching}
          accessibilityRole="button"
          style={({ pressed }) => ({
            paddingVertical: space[2],
            paddingHorizontal: space[3],
            borderRadius: radius.full,
            backgroundColor: pressed ? BRAND[600] : BRAND[500],
          })}
        >
          <Text variant="smallBold" tone="inverse">
            إعادة المحاولة
          </Text>
        </Pressable>
      </View>
    );
  }
  if (!state || state === 'granted' || state === 'unavailable') return null;

  const blocked = state === 'blocked';

  return (
    <View
      style={{
        flexDirection: ROW,
        alignItems: 'center',
        gap: space[3],
        padding: space[3],
        borderRadius: radius.lg,
        backgroundColor: color.warningSoft,
        borderWidth: 1,
        borderColor: color.warning,
      }}
    >
      <MaterialCommunityIcons name="bell-alert-outline" size={24} color={color.warningStrong} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="smallBold" style={{ color: color.warningStrong }}>
          إشعارات {audience === 'owner' ? 'الطلبات' : 'المهام'} متوقفة
        </Text>
        <Text variant="caption" tone="secondary">
          {audience === 'owner'
            ? 'فعّلها ليصلك الطلب الجديد حتى والتطبيق مغلق.'
            : 'فعّلها لتصلك مهام التوصيل حتى والتطبيق مغلق.'}
        </Text>
      </View>
      <Pressable
        onPress={() => (blocked ? void Linking.openSettings() : enable.mutate())}
        disabled={enable.isPending}
        accessibilityRole="button"
        style={({ pressed }) => ({
          paddingVertical: space[2],
          paddingHorizontal: space[3],
          borderRadius: radius.full,
          backgroundColor: pressed ? BRAND[600] : BRAND[500],
        })}
      >
        <Text variant="smallBold" tone="inverse">
          {blocked ? 'الإعدادات' : 'تفعيل'}
        </Text>
      </Pressable>
    </View>
  );
}
