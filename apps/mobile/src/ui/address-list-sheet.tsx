import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { api, ApiError, type Address } from '@/lib/api';
import { useArea } from '@/lib/area';
import { confirmAsync, notify } from '@/lib/dialog';
import { loadPreferredAddressId, savePreferredAddressId } from '@/lib/preferred-address';
import { color, radius, space, TAP_TARGET } from '@/theme';
import { ErrorState, Row, Text } from '@/ui';
import { AddressSheet } from '@/ui/address-sheet';
import { Sheet } from '@/ui/catalog';

/**
 * «التوصيل إلى» — the customer's own addresses, not a catalogue of Iraq.
 *
 * Tapping the delivery line used to open all nineteen governorates, or the two
 * this pilot has opened, and ask the customer to find themselves in a list. But
 * they have already answered that question: they pinned their home on a map.
 * Being asked to pick a governorate afterwards is being asked to repeat
 * yourself to a form that was not listening.
 *
 * So this shows what they saved. One tap switches which address the next order
 * goes to, and adding another opens the map, because an address without a point
 * is a courier phoning from the end of the street.
 *
 * The governorate list has not gone anywhere — it is inside the address form,
 * where it belongs, as the correction for when the phone reads the city wrong.
 */
export function AddressListSheet({
  visible,
  onClose,
  title = 'عناويني',
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly title?: string;
}) {
  const queryClient = useQueryClient();
  const { setArea } = useArea();

  /** The address being edited, or `'new'` while adding one. */
  const [editing, setEditing] = useState<Address | 'new' | null>(null);

  const addresses = useQuery({
    queryKey: ['addresses'],
    queryFn: () => api.addresses(),
    enabled: visible,
    staleTime: 5 * 60_000,
  });

  const preferred = useQuery({
    queryKey: ['addresses', 'preferred'],
    queryFn: () => loadPreferredAddressId(),
    staleTime: Infinity,
  });

  /**
   * Choosing one moves the storefront too.
   *
   * Picking «الأنبار — حديثة» and still being shown Baghdad's restaurants would
   * make the choice look ignored, and the order that followed would be the one
   * nobody can deliver.
   */
  const choose = async (address: Address) => {
    await savePreferredAddressId(address.id);
    await setArea({
      governorateId: address.governorate.id,
      governorateNameAr: address.governorate.name_ar,
      cityId: address.city.id,
      cityNameAr: address.city.name_ar,
    });
    await preferred.refetch();
    onClose();
  };

  const remove = useMutation({
    mutationFn: (address: Address) => api.deleteAddress(address.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['addresses'] }),
    onError: (error) =>
      notify('تعذّر الحذف', error instanceof ApiError ? error.messageAr : 'حاول مرة أخرى.'),
  });

  const confirmRemove = async (address: Address) => {
    const label = [address.city.name_ar, address.landmark].filter(Boolean).join(' — ');
    const confirmed = await confirmAsync({
      title: 'حذف العنوان',
      message: `سيُحذف «${label}». الطلبات السابقة لا تتأثر.`,
      confirmLabel: 'حذف',
      destructive: true,
    });
    if (confirmed) remove.mutate(address);
  };

  const rows = addresses.data ?? [];

  return (
    <>
      <Sheet visible={visible} onClose={onClose} title={title}>
        {addresses.isLoading ? (
          <View style={{ paddingVertical: space[8], alignItems: 'center' }}>
            <ActivityIndicator color={color.brand} />
          </View>
        ) : addresses.isError ? (
          <ErrorState
            message={
              addresses.error instanceof ApiError
                ? addresses.error.messageAr
                : 'تعذّر تحميل العناوين'
            }
            onRetry={() => void addresses.refetch()}
          />
        ) : rows.length === 0 ? (
          <Text tone="muted" align="center">
            لا عناوين محفوظة بعد — أضف عنوانك وثبّته على الخريطة.
          </Text>
        ) : (
          rows.map((entry) => {
            const chosen = (preferred.data ?? null) === entry.id || (!preferred.data && entry.is_default);
            const pinned = entry.latitude != null && entry.longitude != null;

            return (
              <View
                key={entry.id}
                style={{
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: chosen ? color.brand : color.borderSubtle,
                  backgroundColor: chosen ? color.brandSoft : color.surfaceCard,
                  overflow: 'hidden',
                }}
              >
                <Pressable
                  onPress={() => void choose(entry)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: chosen }}
                  accessibilityLabel={`${entry.governorate.name_ar} ${entry.city.name_ar}${entry.landmark ? ` — ${entry.landmark}` : ''}`}
                  style={({ pressed }) => [
                    { minHeight: TAP_TARGET + 10, paddingHorizontal: space[3], justifyContent: 'center' },
                    pressed ? { opacity: 0.7 } : null,
                  ]}
                >
                  <Row gap={space[2]}>
                    <MaterialCommunityIcons
                      name={pinned ? 'map-marker-check' : 'map-marker-alert-outline'}
                      size={20}
                      color={pinned ? color.successStrong : color.dangerStrong}
                    />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="smallBold" tone={chosen ? 'brand' : 'primary'}>
                        {entry.governorate.name_ar} — {entry.city.name_ar}
                      </Text>
                      <Text variant="caption" tone="muted" numberOfLines={2}>
                        {/*
                          * A missing pin is called out rather than left blank.
                          * It is the difference between a courier arriving and
                          * a courier phoning, and it is fixable in two taps.
                          */}
                        {pinned
                          ? (entry.landmark ?? entry.district_text ?? 'مثبّت على الخريطة')
                          : 'بلا دبوس — افتحه وثبّته على الخريطة'}
                      </Text>
                    </View>
                    {chosen ? (
                      <MaterialCommunityIcons name="check-circle" size={20} color={color.brand} />
                    ) : null}
                  </Row>
                </Pressable>

                <Row
                  justify="space-between"
                  style={{
                    borderTopWidth: 1,
                    borderTopColor: color.borderSubtle,
                    paddingHorizontal: space[3],
                  }}
                >
                  <Pressable
                    onPress={() => setEditing(entry)}
                    accessibilityRole="button"
                    accessibilityLabel="تعديل العنوان"
                    style={({ pressed }) => [
                      { minHeight: TAP_TARGET, justifyContent: 'center' },
                      pressed ? { opacity: 0.6 } : null,
                    ]}
                  >
                    <Row gap={space[1]}>
                      <MaterialCommunityIcons name="pencil-outline" size={16} color={color.brand} />
                      <Text variant="caption" tone="brand">
                        تعديل
                      </Text>
                    </Row>
                  </Pressable>

                  <Pressable
                    onPress={() => void confirmRemove(entry)}
                    disabled={remove.isPending}
                    accessibilityRole="button"
                    accessibilityLabel="حذف العنوان"
                    style={({ pressed }) => [
                      { minHeight: TAP_TARGET, justifyContent: 'center' },
                      pressed ? { opacity: 0.6 } : null,
                    ]}
                  >
                    <Row gap={space[1]}>
                      <MaterialCommunityIcons
                        name="trash-can-outline"
                        size={16}
                        color={color.dangerStrong}
                      />
                      <Text variant="caption" tone="danger">
                        حذف
                      </Text>
                    </Row>
                  </Pressable>
                </Row>
              </View>
            );
          })
        )}

        <Pressable
          onPress={() => setEditing('new')}
          accessibilityRole="button"
          accessibilityLabel="إضافة عنوان جديد"
          style={({ pressed }) => [
            {
              minHeight: TAP_TARGET + 6,
              borderRadius: radius.md,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: color.brand,
              justifyContent: 'center',
              paddingHorizontal: space[3],
            },
            pressed ? { opacity: 0.7 } : null,
          ]}
        >
          <Row gap={space[2]}>
            <MaterialCommunityIcons name="plus" size={20} color={color.brand} />
            <Text variant="smallBold" tone="brand">
              إضافة عنوان جديد
            </Text>
          </Row>
        </Pressable>
      </Sheet>

      {/*
        * One form for both, opened over the list.
        *
        * A new address starts on the map — that is what «each address gets
        * pinned the first time» means in practice — and an edit starts on the
        * point it already has.
        */}
      <AddressSheet
        visible={editing !== null}
        address={editing === 'new' ? null : editing}
        title={editing === 'new' ? 'عنوان جديد' : 'تعديل العنوان'}
        onClose={() => setEditing(null)}
        onSaved={(addressId) => {
          setEditing(null);
          // A freshly saved address is the one they meant to order to.
          void savePreferredAddressId(addressId).then(() => preferred.refetch());
          void queryClient.invalidateQueries({ queryKey: ['addresses'] });
        }}
      />
    </>
  );
}
