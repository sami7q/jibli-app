import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { api } from '@/lib/api';
import { useIsGuest } from '@/lib/session';
import { dismissPinHome, pinHomeDismissed } from '@/lib/home-pin-store';
import { color, radius, ROW, space } from '@/theme';
import { Text } from '@/ui';
import { AddressSheet } from '@/ui/address-sheet';

/**
 * «ثبّت منزلك على الخريطة» — offered once, on the way in.
 *
 * A courier given «قرب صيدلية النور» and nothing else is guessing, and the
 * moment that gets fixed used to be checkout: the customer is hungry, mid-
 * payment, and being asked to drag a map. Almost nobody did, so almost no
 * address had a point on it.
 *
 * So the app asks earlier, when nothing is at stake — and asks as a **card, not
 * a dialog**. A modal over the home screen on first launch is the same mistake
 * as opening the tracking screen over it: the customer came to look at
 * restaurants, and a thing they did not ask for standing in front of that is a
 * cost whatever it is selling. A card sits in the scroll, says what it is for,
 * and is dismissible in one tap.
 *
 * It appears at most once. Shown only to a signed-in customer with no address
 * yet — a guest has nothing to attach one to, and somebody who already saved an
 * address has already answered.
 */
export function PinHomeCard() {
  const isGuest = useIsGuest();
  const queryClient = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);

  const dismissed = useQuery({
    queryKey: ['pin-home-dismissed'],
    queryFn: () => pinHomeDismissed(),
    staleTime: Infinity,
  });

  /*
   * Whether there is already an address, and whether any of them has a point.
   *
   * The second half matters as much as the first: a customer who saved an
   * address before this existed has one with no coordinate on it, and they are
   * exactly the person a courier is currently phoning from the end of the
   * street. They get the offer too.
   */
  const addresses = useQuery({
    queryKey: ['addresses'],
    queryFn: () => api.addresses(),
    enabled: !isGuest,
    staleTime: 5 * 60_000,
  });

  if (isGuest || dismissed.data !== false || addresses.isLoading || addresses.isError) return null;

  const rows = addresses.data ?? [];
  const anyPinned = rows.some((row) => row.latitude != null && row.longitude != null);
  if (anyPinned) return null;

  const hasAddressWithoutPin = rows.length > 0;

  return (
    <>
      <View style={{ paddingHorizontal: space[4], paddingTop: space[4] }}>
        <View
          style={{
            flexDirection: ROW,
            alignItems: 'center',
            gap: space[3],
            padding: space[3],
            borderRadius: radius.lg,
            backgroundColor: color.brandSoft,
            borderWidth: 1,
            borderColor: color.borderSubtle,
          }}
        >
          <MaterialCommunityIcons name="map-marker-radius" size={26} color={color.brand} />

          <Pressable
            onPress={() => setSheetOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="تثبيت المنزل على الخريطة"
            style={({ pressed }) => [{ flex: 1, gap: 2 }, pressed ? { opacity: 0.7 } : null]}
          >
            <Text variant="smallBold" tone="brand">
              ثبّت منزلك على الخريطة
            </Text>
            <Text variant="caption" tone="secondary">
              {hasAddressWithoutPin
                ? 'عنوانك محفوظ بلا نقطة على الخريطة — ثبّتها ليصل المندوب دون اتصال.'
                : 'دبوس واحد، ويصل المندوب إلى بابك مباشرة دون أن يتصل ويسأل.'}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => void dismissPinHome().then(() => dismissed.refetch())}
            accessibilityRole="button"
            accessibilityLabel="إخفاء"
            hitSlop={space[2]}
            style={({ pressed }) => [{ padding: space[1] }, pressed ? { opacity: 0.6 } : null]}
          >
            <MaterialCommunityIcons name="close" size={18} color={color.textMuted} />
          </Pressable>
        </View>
      </View>

      <AddressSheet
        visible={sheetOpen}
        title="ثبّت منزلك"
        onClose={() => setSheetOpen(false)}
        onSaved={() => {
          setSheetOpen(false);
          // The card disappears because the address now has a point, not
          // because it was dismissed — so nothing is remembered here.
          void queryClient.invalidateQueries({ queryKey: ['addresses'] });
        }}
      />
    </>
  );
}
