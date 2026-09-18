import { ActivityIndicator, Pressable, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, type GeographyOption } from '@/lib/api';
import { color, radius, space, TAP_TARGET } from '@/theme';
import { ErrorState, Row, Text } from './index';

/**
 * Governorate, then city — the list itself, without a sheet around it.
 *
 * Two screens ask the same question. «منطقة التوصيل» asks it to decide which
 * restaurants to show, and the address form asks it as the first line of an
 * address. They were separate implementations of the same drill-down, which is
 * one place for the capability filter to be wrong in and two places to fix it.
 *
 * The drill-down state lives with the caller rather than here, because the
 * sheet's title changes with it — «اختر منطقتك» becomes «بغداد — اختر المدينة»
 * — and a component cannot title the thing that contains it.
 */

/** What the title bar above this list should read. */
export function areaStepTitle(governorate: GeographyOption | null): string {
  return governorate ? `${governorate.name_ar} — اختر المدينة` : 'اختر منطقتك';
}

export function AreaChoice({
  governorate,
  onGovernorate,
  selected,
  onChoose,
  capability = 'ordering',
}: {
  /** The governorate being drilled into, or `null` for the top level. */
  readonly governorate: GeographyOption | null;
  readonly onGovernorate: (option: GeographyOption | null) => void;
  readonly selected: { governorateId: string; cityId: string } | null;
  readonly onChoose: (governorate: GeographyOption, city: GeographyOption) => void;
  /**
   * Which list to offer. `ordering` everywhere a delivery happens: a
   * governorate enabled for signup but not yet for ordering would otherwise be
   * pickable and then show an empty restaurant list, which reads as a broken
   * app rather than as «we are not here yet».
   */
  readonly capability?: 'ordering' | 'customer_signup';
}) {
  const governorates = useQuery({
    queryKey: ['geography', 'governorates', capability],
    queryFn: () => api.governorates(capability),
    // Geography changes when the business opens a new city, not by the hour.
    staleTime: 30 * 60_000,
  });

  const cities = useQuery({
    queryKey: ['geography', 'cities', governorate?.id, capability],
    queryFn: () => api.cities(governorate?.id as string, capability),
    staleTime: 30 * 60_000,
    enabled: Boolean(governorate),
  });

  const active = governorate ? cities : governorates;

  return (
    <>
      {governorate ? (
        <Pressable
          onPress={() => onGovernorate(null)}
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
          const isSelected = !governorate
            ? selected?.governorateId === option.id
            : selected?.cityId === option.id;

          return (
            <Pressable
              key={option.id}
              onPress={() => (governorate ? onChoose(governorate, option) : onGovernorate(option))}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={option.name_ar}
              style={({ pressed }) => [
                {
                  minHeight: TAP_TARGET + 6,
                  paddingHorizontal: space[3],
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: isSelected ? color.brand : color.borderSubtle,
                  backgroundColor: isSelected ? color.brandSoft : color.surfaceCard,
                  justifyContent: 'center',
                },
                pressed ? { opacity: 0.7 } : null,
              ]}
            >
              <Row justify="space-between">
                <Text
                  variant={isSelected ? 'bodyBold' : 'body'}
                  tone={isSelected ? 'brand' : 'primary'}
                >
                  {option.name_ar}
                </Text>
                {governorate ? (
                  isSelected ? (
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
    </>
  );
}
