import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, type GeographyOption } from '@/lib/api';
import { useArea, type DeliveryArea } from '@/lib/area';
import { useIsGuest, useSession } from '@/lib/session';
import { color, radius, space, TAP_TARGET } from '@/theme';
import { ErrorState, Row, Text } from './index';
import { Sheet } from './catalog';

/**
 * Choosing the delivery area — governorate, then city.
 *
 * Only areas with `capability=ordering` are offered. A governorate that is
 * enabled for signup but not yet for ordering would otherwise be pickable and
 * then show an empty restaurant list, which reads as a broken app rather than
 * as "we are not here yet".
 */
export function AreaPicker({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { area, setArea } = useArea();
  const { refresh } = useSession();
  const isGuest = useIsGuest();
  const [governorate, setGovernorate] = useState<GeographyOption | null>(null);

  // Reopening should start from the current area, not from wherever the last
  // visit was abandoned.
  useEffect(() => {
    if (visible) setGovernorate(null);
  }, [visible]);

  const governorates = useQuery({
    queryKey: ['geography', 'governorates', 'ordering'],
    queryFn: () => api.governorates('ordering'),
    // Geography changes when the business opens a new city, not by the hour.
    staleTime: 30 * 60_000,
    enabled: visible,
  });

  const cities = useQuery({
    queryKey: ['geography', 'cities', governorate?.id, 'ordering'],
    queryFn: () => api.cities(governorate?.id as string, 'ordering'),
    staleTime: 30 * 60_000,
    enabled: visible && Boolean(governorate),
  });

  const choose = async (city: GeographyOption) => {
    if (!governorate) return;
    const next: DeliveryArea = {
      governorateId: governorate.id,
      governorateNameAr: governorate.name_ar,
      cityId: city.id,
      cityNameAr: city.name_ar,
    };
    await setArea(next);
    onClose();

    /*
     * A signed-in customer's area is part of their profile, so the change
     * follows them to another phone. Deliberately after the sheet has closed
     * and deliberately not awaited: the screen behind is already showing the
     * new city, and a slow request must not hold the sheet open.
     *
     * A failure costs the sync, not the choice, and there is one failure that
     * is expected rather than exceptional: this list is filtered by the
     * `ordering` capability while the profile is validated against
     * `customer_signup`, so a city open for ordering but not for signup is
     * refused here. Browsing it still works, which is what the customer asked
     * for; only the cross-device default does not move.
     */
    if (!isGuest) {
      void api
        .updateProfile({ governorate_id: governorate.id, city_id: city.id })
        .then(() => refresh())
        .catch(() => undefined);
    }
  };

  const active = governorate ? cities : governorates;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={governorate ? `${governorate.name_ar} — اختر المدينة` : 'اختر منطقتك'}
    >
      {governorate ? (
        <Pressable
          onPress={() => setGovernorate(null)}
          accessibilityRole="button"
          accessibilityLabel="رجوع إلى المحافظات"
          style={{ minHeight: TAP_TARGET, justifyContent: 'center' }}
        >
          <Row gap={space[1]}>
            <MaterialCommunityIcons name="chevron-right" size={18} color={color.brand} />
            <Text variant="smallBold" tone="brand">
              كل المحافظات
            </Text>
          </Row>
        </Pressable>
      ) : null}

      {active.isLoading ? (
        <View style={{ paddingVertical: space[8], alignItems: 'center' }}>
          <ActivityIndicator color={color.brand} />
        </View>
      ) : active.isError ? (
        <ErrorState
          message={active.error instanceof ApiError ? active.error.messageAr : 'تعذّر تحميل المناطق'}
          onRetry={() => void active.refetch()}
        />
      ) : (active.data ?? []).length === 0 ? (
        <Text tone="muted" align="center">
          لا توجد مناطق متاحة للطلب حالياً
        </Text>
      ) : (
        (active.data ?? []).map((option) => {
          const selected = !governorate
            ? area?.governorateId === option.id
            : area?.cityId === option.id;

          return (
            <Pressable
              key={option.id}
              onPress={() => (governorate ? void choose(option) : setGovernorate(option))}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={option.name_ar}
              style={({ pressed }) => [
                {
                  minHeight: TAP_TARGET + 6,
                  paddingHorizontal: space[3],
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: selected ? color.brand : color.borderSubtle,
                  backgroundColor: selected ? color.brandSoft : color.surfaceCard,
                  justifyContent: 'center',
                },
                pressed ? { opacity: 0.7 } : null,
              ]}
            >
              <Row justify="space-between">
                <Text variant={selected ? 'bodyBold' : 'body'} tone={selected ? 'brand' : 'primary'}>
                  {option.name_ar}
                </Text>
                {governorate ? (
                  selected ? (
                    <MaterialCommunityIcons name="check" size={18} color={color.brand} />
                  ) : null
                ) : (
                  <MaterialCommunityIcons name="chevron-left" size={18} color={color.textMuted} />
                )}
              </Row>
            </Pressable>
          );
        })
      )}
    </Sheet>
  );
}
