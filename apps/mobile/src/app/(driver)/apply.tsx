import { useState } from 'react';
import { Alert, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { api, ApiError } from '@/lib/api';
import { useIsGuest } from '@/lib/session';
import { color, palette, radius, space, TAP_TARGET, text } from '@/theme';
import { Button, EmptyState, Row, Screen, Skeleton, Text } from '@/ui';

/**
 * Applying to deliver for Jibli.
 *
 * A driver account could only be created from inside a restaurant's portal,
 * which meant anyone who wanted to deliver had to already know a restaurant
 * owner. This is the other door, and it is the first screen in the app that
 * belongs to somebody other than a customer.
 *
 * It does not make anyone a driver. The application lands in
 * `PENDING_ACTIVATION` and an operator reviews it — which is why most of this
 * screen is about the waiting rather than the form: an application with no
 * visible state is indistinguishable from one that was never received.
 */

const VEHICLES = [
  { value: 'MOTORCYCLE', label: 'دراجة نارية', icon: 'motorbike', needsPlate: true },
  { value: 'CAR', label: 'سيارة', icon: 'car', needsPlate: true },
  { value: 'BICYCLE', label: 'دراجة هوائية', icon: 'bike', needsPlate: false },
  { value: 'ON_FOOT', label: 'سيراً على الأقدام', icon: 'walk', needsPlate: false },
] as const;

type Vehicle = (typeof VEHICLES)[number]['value'];

/** What each application state means, in the applicant's words. */
const STATUS_COPY: Record<
  string,
  {
    title: string;
    body: string;
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
    tone: 'brand' | 'success' | 'danger';
  }
> = {
  PENDING_ACTIVATION: {
    title: 'طلبك قيد المراجعة',
    body: 'سنتواصل معك على رقم هاتفك بعد مراجعة الطلب. لا حاجة لإعادة التقديم.',
    icon: 'clock-outline',
    tone: 'brand',
  },
  ACTIVE: {
    title: 'أنت مندوب نشط',
    body: 'يمكنك الآن استلام الطلبات من وضع التوصيل.',
    icon: 'check-circle',
    tone: 'success',
  },
  SUSPENDED: {
    title: 'الحساب موقوف',
    body: 'تواصل مع الدعم لمعرفة التفاصيل.',
    icon: 'alert-circle-outline',
    tone: 'danger',
  },
};

export default function DriverApplyScreen() {
  const router = useRouter();
  const isGuest = useIsGuest();

  const [vehicle, setVehicle] = useState<Vehicle>('MOTORCYCLE');
  const [plate, setPlate] = useState('');

  const application = useQuery({
    queryKey: ['driver-application'],
    queryFn: () => api.driverApplication(),
    enabled: !isGuest,
  });

  const apply = useMutation({
    mutationFn: () =>
      api.applyAsDriver({
        vehicle_type: vehicle,
        ...(plate.trim() ? { plate_number: plate.trim() } : {}),
      }),
    onSuccess: () => void application.refetch(),
    onError: (error) =>
      Alert.alert(
        'تعذّر إرسال الطلب',
        error instanceof ApiError ? error.messageAr : 'حاول مرة أخرى.',
      ),
  });

  const selected = VEHICLES.find((entry) => entry.value === vehicle);
  const plateMissing = selected?.needsPlate === true && plate.trim().length < 2;

  return (
    <Screen edges={['top']} padded={false}>
      <Row justify="space-between" style={{ paddingHorizontal: space[4], minHeight: TAP_TARGET }}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/account'))}
          accessibilityRole="button"
          accessibilityLabel="رجوع"
          style={{ width: TAP_TARGET, height: TAP_TARGET, justifyContent: 'center' }}
        >
          <MaterialCommunityIcons name="chevron-right" size={26} color={color.textPrimary} />
        </Pressable>
        <Text variant="h3">الانضمام كمندوب</Text>
        <View style={{ width: TAP_TARGET }} />
      </Row>

      <ScrollView
        contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: space[10] }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {isGuest ? (
          <EmptyState
            title="سجّل دخولك للتقديم"
            body="نحتاج رقم هاتفك واسمك لمراجعة الطلب."
            action={{ label: 'تسجيل الدخول', onPress: () => router.push('/(auth)/phone') }}
          />
        ) : application.isLoading ? (
          <Skeleton height={160} style={{ borderRadius: radius.lg }} />
        ) : application.data ? (
          <ApplicationStatus
            status={application.data.status}
            vehicleLabel={
              VEHICLES.find((entry) => entry.value === application.data?.vehicle_type)?.label ?? '—'
            }
            onOpenDriverMode={() => router.replace('/(driver)/delivery')}
          />
        ) : (
          <>
            <View
              style={{
                padding: space[4],
                borderRadius: radius.lg,
                backgroundColor: color.brandSoft,
                borderWidth: 1,
                borderColor: palette.orange[200],
                gap: space[1],
              }}
            >
              <Text variant="bodyBold" tone="brand">
                وصّل مع جيبلي
              </Text>
              <Text variant="small" tone="secondary">
                اختر وسيلتك وأرسل الطلب. سنراجعه ونتواصل معك على رقم هاتفك المسجّل.
              </Text>
            </View>

            <View style={{ gap: space[2] }}>
              <Text variant="smallBold">وسيلة التوصيل</Text>
              {VEHICLES.map((entry) => {
                const active = vehicle === entry.value;
                return (
                  <Pressable
                    key={entry.value}
                    onPress={() => setVehicle(entry.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={entry.label}
                    style={{
                      minHeight: TAP_TARGET + 6,
                      paddingHorizontal: space[3],
                      borderRadius: radius.md,
                      borderWidth: 1,
                      borderColor: active ? color.brand : color.borderSubtle,
                      backgroundColor: active ? color.brandSoft : color.surfaceCard,
                      justifyContent: 'center',
                    }}
                  >
                    <Row gap={space[3]}>
                      <MaterialCommunityIcons
                        name={entry.icon}
                        size={22}
                        color={active ? color.brand : color.textMuted}
                      />
                      <Text
                        variant={active ? 'bodyBold' : 'body'}
                        tone={active ? 'brand' : 'primary'}
                        style={{ flex: 1 }}
                      >
                        {entry.label}
                      </Text>
                      {active ? (
                        <MaterialCommunityIcons name="check" size={20} color={color.brand} />
                      ) : null}
                    </Row>
                  </Pressable>
                );
              })}
            </View>

            {selected?.needsPlate ? (
              <View style={{ gap: space[1] }}>
                <Text variant="caption" tone="muted">
                  رقم المركبة
                </Text>
                <TextInput
                  value={plate}
                  onChangeText={setPlate}
                  placeholder="مثال: بغداد ١٢٣٤٥"
                  placeholderTextColor={color.textMuted}
                  accessibilityLabel="رقم المركبة"
                  maxLength={20}
                  style={[
                    text.small,
                    {
                      minHeight: TAP_TARGET,
                      borderRadius: radius.md,
                      borderWidth: 1,
                      borderColor: color.borderSubtle,
                      backgroundColor: color.surfaceCard,
                      paddingHorizontal: space[3],
                      color: color.textPrimary,
                    },
                  ]}
                />
              </View>
            ) : null}

            <Button
              label="إرسال الطلب"
              block
              disabled={plateMissing || apply.isPending}
              loading={apply.isPending}
              onPress={() => apply.mutate()}
            />

            <Text variant="caption" tone="muted" align="center">
              بإرسال الطلب توافق على شروط العمل كمندوب لدى جيبلي.
            </Text>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function ApplicationStatus({
  status,
  vehicleLabel,
  onOpenDriverMode,
}: {
  status: string;
  vehicleLabel: string;
  onOpenDriverMode: () => void;
}) {
  const copy = STATUS_COPY[status] ?? STATUS_COPY.PENDING_ACTIVATION!;
  const tint =
    copy.tone === 'success'
      ? color.successSoft
      : copy.tone === 'danger'
        ? color.dangerSoft
        : color.brandSoft;

  return (
    <View style={{ gap: space[4] }}>
      <View
        style={{
          padding: space[5],
          borderRadius: radius.lg,
          backgroundColor: tint,
          alignItems: 'center',
          gap: space[2],
        }}
      >
        <MaterialCommunityIcons
          name={copy.icon}
          size={44}
          color={
            copy.tone === 'success'
              ? color.successStrong
              : copy.tone === 'danger'
                ? color.dangerStrong
                : color.brand
          }
        />
        <Text variant="h3" align="center" tone={copy.tone}>
          {copy.title}
        </Text>
        <Text variant="small" tone="secondary" align="center">
          {copy.body}
        </Text>
      </View>

      <Row
        justify="space-between"
        style={{
          padding: space[3],
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: color.borderSubtle,
        }}
      >
        <Text variant="small" tone="muted">
          وسيلة التوصيل
        </Text>
        <Text variant="smallBold">{vehicleLabel}</Text>
      </Row>

      {status === 'ACTIVE' ? (
        <Button label="فتح وضع التوصيل" block onPress={onOpenDriverMode} />
      ) : null}
    </View>
  );
}
