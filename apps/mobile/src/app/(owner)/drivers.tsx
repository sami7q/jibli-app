import { useState } from 'react';
import { ActivityIndicator, Pressable, Switch, TextInput, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { normalizeDigits } from '@jibli/validation/arabic';
import MaterialCommunityIcons from '@/ui/icon';
import { api, ApiError, type OwnerDriver, type OwnerVehicleType } from '@/lib/api';
import { notify } from '@/lib/dialog';
import { useOwner } from '@/lib/owner';
import { color, INPUT_TEXT_START, radius, ROW, space, TAP_TARGET, text } from '@/theme';
import { Button, EmptyState, ErrorState, Ltr, Row, Screen, Skeleton, Text } from '@/ui';
import { OwnerHeader } from '@/ui/owner-header';

/**
 * The shop's own couriers — «المندوبون» — from the phone.
 *
 * An order can only be handed to a courier who belongs to the shop and is
 * active, so this is where that list is made: add a courier by name and
 * phone, activate them, and issue the username and one-time password they
 * sign in with in courier mode. The password is shown once, here, for the
 * owner to pass on; the server keeps only its hash.
 */
export default function OwnerDriversScreen() {
  const owner = useOwner();
  const shop = owner.shop;
  const queryClient = useQueryClient();
  const canWrite = owner.can('driver.manage');
  const [adding, setAdding] = useState(false);

  const drivers = useQuery({
    queryKey: ['owner-drivers', shop?.id],
    queryFn: () => api.ownerDrivers(shop?.id as string),
    enabled: Boolean(shop?.id),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['owner-drivers', shop?.id] });
    // The picker on an order reads the eligible list; it changes with this one.
    await queryClient.invalidateQueries({ queryKey: ['owner-eligible-drivers'] });
  };

  if (!shop) {
    return (
      <Screen edges={['top', 'bottom']}>
        <OwnerHeader title="المندوبون" />
        <EmptyState title="لا يوجد متجر مفتوح" body="ارجع واختر متجراً." />
      </Screen>
    );
  }

  return (
    <Screen scroll edges={['top', 'bottom']} padded={false}>
      <View style={{ padding: space[4], gap: space[4], paddingBottom: space[10] }}>
        <OwnerHeader title="المندوبون" />

        <Text variant="small" tone="secondary">
          مندوبو متجرك. المفعّل منهم يظهر لك عند إسناد طلب، ويدخل إلى وضع المندوب في تطبيق جيبلي
          باسم المستخدم وكلمة المرور اللذين تصدرهما له هنا.
        </Text>

        {canWrite ? (
          adding ? (
            <NewDriverForm
              shopId={shop.id}
              onDone={async () => {
                setAdding(false);
                await invalidate();
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <Button
              label="إضافة مندوب"
              block
              size="lg"
              icon={<MaterialCommunityIcons name="plus" size={20} color={color.textInverse} />}
              onPress={() => setAdding(true)}
            />
          )
        ) : null}

        {drivers.isLoading ? (
          <View style={{ gap: space[2] }}>
            <Skeleton height={88} style={{ borderRadius: radius.lg }} />
            <Skeleton height={88} style={{ borderRadius: radius.lg }} />
          </View>
        ) : drivers.isError ? (
          <ErrorState message="تعذّر تحميل المندوبين" onRetry={() => void drivers.refetch()} />
        ) : (drivers.data ?? []).length === 0 ? (
          <EmptyState
            title="لا مندوبين بعد"
            body="أضف مندوبك الأول برقم هاتفه، ثم فعّله وأصدر له بيانات الدخول."
          />
        ) : (
          (drivers.data ?? []).map((driver) => (
            <DriverCard
              key={driver.id}
              shopId={shop.id}
              driver={driver}
              canWrite={canWrite}
              onChanged={invalidate}
            />
          ))
        )}
      </View>
    </Screen>
  );
}

const VEHICLES: readonly { type: OwnerVehicleType; label: string }[] = [
  { type: 'MOTORCYCLE', label: 'دراجة نارية' },
  { type: 'CAR', label: 'سيارة' },
  { type: 'BICYCLE', label: 'دراجة هوائية' },
  { type: 'ON_FOOT', label: 'سيراً' },
];

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'مفعّل',
  PENDING: 'بانتظار التفعيل',
  PENDING_APPROVAL: 'بانتظار التفعيل',
  SUSPENDED: 'موقوف',
  INACTIVE: 'غير نشط',
};

const AVAILABILITY_LABELS: Record<string, string> = {
  ONLINE: 'متاح الآن',
  AVAILABLE: 'متاح الآن',
  BUSY: 'في توصيل',
  OFFLINE: 'غير متصل',
};

const explain = (caught: unknown) =>
  caught instanceof ApiError ? caught.messageAr : 'حاول مرة أخرى.';

const fieldStyle = (invalid = false) => [
  text.body,
  {
    minHeight: TAP_TARGET + 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: invalid ? color.danger : color.borderSubtle,
    backgroundColor: color.surfaceCard,
    paddingHorizontal: space[3],
    color: color.textPrimary,
    textAlign: INPUT_TEXT_START,
  },
];

/** «07701234567» or «7701234567» or «+9647701234567» → «+9647701234567». */
function toE164(raw: string): string | null {
  const digits = normalizeDigits(raw).replace(/\D/g, '');
  const local = digits.startsWith('964') ? digits.slice(3) : digits.replace(/^0/, '');
  return /^7\d{9}$/.test(local) ? `+964${local}` : null;
}

function NewDriverForm({
  shopId,
  onDone,
  onCancel,
}: {
  shopId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicle, setVehicle] = useState<OwnerVehicleType>('MOTORCYCLE');
  const [cash, setCash] = useState(true);

  const e164 = toE164(phone);
  const valid = name.trim().length >= 3 && e164 !== null;

  const create = useMutation({
    mutationFn: () =>
      api.ownerCreateDriver(shopId, {
        full_name: name.trim(),
        phone: e164 as string,
        vehicle_type: vehicle,
        can_collect_cash: cash,
      }),
    onSuccess: (result) => {
      notify('تمت الإضافة', result.note_ar || 'فعّل المندوب ثم أصدر له بيانات الدخول.');
      onDone();
    },
    onError: (caught) => notify('تعذّرت الإضافة', explain(caught)),
  });

  return (
    <View
      style={{
        padding: space[3],
        gap: space[3],
        borderRadius: radius.lg,
        backgroundColor: color.surfaceCard,
        borderWidth: 1,
        borderColor: color.brand,
      }}
    >
      <Text variant="bodyBold">مندوب جديد</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="الاسم الكامل"
        placeholderTextColor={color.textMuted}
        maxLength={80}
        accessibilityLabel="اسم المندوب"
        style={fieldStyle()}
      />
      <TextInput
        value={phone}
        onChangeText={setPhone}
        placeholder="07XX XXX XXXX"
        placeholderTextColor={color.textMuted}
        keyboardType="phone-pad"
        maxLength={16}
        accessibilityLabel="هاتف المندوب"
        style={[
          fieldStyle(Boolean(phone) && !e164),
          { writingDirection: 'ltr', textAlign: 'left' },
        ]}
      />
      {phone && !e164 ? (
        <Text variant="caption" tone="danger">
          رقم عراقي من 11 رقماً يبدأ بـ 07
        </Text>
      ) : null}

      <View style={{ flexDirection: ROW, flexWrap: 'wrap', gap: space[2] }}>
        {VEHICLES.map((entry) => {
          const selected = vehicle === entry.type;
          return (
            <Pressable
              key={entry.type}
              onPress={() => setVehicle(entry.type)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={{
                minHeight: TAP_TARGET - 8,
                paddingHorizontal: space[3],
                justifyContent: 'center',
                borderRadius: radius.full,
                borderWidth: 1,
                borderColor: selected ? color.brand : color.borderSubtle,
                backgroundColor: selected ? color.brand : color.surfaceCard,
              }}
            >
              <Text variant="small" tone={selected ? 'inverse' : 'primary'}>
                {entry.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ flexDirection: ROW, alignItems: 'center', gap: space[3] }}>
        <View style={{ flex: 1 }}>
          <Text variant="smallBold">يستلم النقد من الزبون</Text>
          <Text variant="caption" tone="muted">
            الدفع عند الاستلام يمر عبره
          </Text>
        </View>
        <Switch
          value={cash}
          onValueChange={setCash}
          trackColor={{ true: color.brand, false: color.borderStrong }}
          accessibilityLabel="يستلم النقد"
        />
      </View>

      <Row gap={space[2]}>
        <View style={{ flex: 1 }}>
          <Button
            label="حفظ المندوب"
            block
            disabled={!valid || create.isPending}
            loading={create.isPending}
            onPress={() => create.mutate()}
          />
        </View>
        <Button label="إلغاء" variant="secondary" onPress={onCancel} />
      </Row>
    </View>
  );
}

function DriverCard({
  shopId,
  driver,
  canWrite,
  onChanged,
}: {
  shopId: string;
  driver: OwnerDriver;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [issuing, setIssuing] = useState(false);
  const [username, setUsername] = useState('');
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);

  const activate = useMutation({
    mutationFn: () => api.ownerActivateDriver(shopId, driver.id),
    onSuccess: onChanged,
    onError: (caught) => notify('تعذّر التفعيل', explain(caught)),
  });

  const toggle = useMutation({
    mutationFn: (isActive: boolean) => api.ownerUpdateDriver(shopId, driver.id, { is_active: isActive }),
    onSuccess: onChanged,
    onError: (caught) => notify('تعذّر التعديل', explain(caught)),
  });

  const credentials = useMutation({
    mutationFn: () =>
      api.ownerIssueDriverCredentials(shopId, driver.id, username.trim().toLowerCase()),
    onSuccess: (result) => {
      setIssued({ username: result.username, password: result.password });
      setIssuing(false);
      onChanged();
    },
    onError: (caught) => notify('تعذّر إصدار البيانات', explain(caught)),
  });

  const live = driver.status === 'ACTIVE';

  return (
    <View
      style={{
        padding: space[3],
        gap: space[2],
        borderRadius: radius.lg,
        backgroundColor: color.surfaceCard,
        borderWidth: 1,
        borderColor: color.borderSubtle,
        opacity: driver.is_active ? 1 : 0.7,
      }}
    >
      <Row gap={space[3]}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: color.brandSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MaterialCommunityIcons name="moped-outline" size={22} color={color.brand} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyBold">{driver.full_name ?? 'مندوب'}</Text>
          <Ltr variant="caption" tone="muted">
            {driver.phone}
          </Ltr>
          <Text variant="caption" tone={live ? 'success' : 'muted'}>
            {STATUS_LABELS[driver.status] ?? driver.status}
            {live ? ` · ${AVAILABILITY_LABELS[driver.availability] ?? driver.availability}` : ''}
            {driver.active_assignments > 0 ? ` · ${driver.active_assignments} طلب جارٍ` : ''}
          </Text>
        </View>
        {canWrite && live ? (
          <Switch
            value={driver.is_active}
            disabled={toggle.isPending}
            onValueChange={(value) => toggle.mutate(value)}
            trackColor={{ true: color.success, false: color.borderStrong }}
            accessibilityLabel={`${driver.full_name ?? 'المندوب'} نشط`}
          />
        ) : null}
      </Row>

      {canWrite && !live ? (
        <Button
          label="تفعيل المندوب"
          variant="secondary"
          block
          loading={activate.isPending}
          disabled={activate.isPending}
          onPress={() => activate.mutate()}
        />
      ) : null}

      {issued ? (
        <View
          style={{
            padding: space[3],
            gap: space[1],
            borderRadius: radius.md,
            backgroundColor: color.warningSoft,
          }}
        >
          <Text variant="smallBold">بيانات الدخول — تظهر مرة واحدة فقط</Text>
          <Text variant="caption" tone="secondary">
            أرسلها للمندوب الآن؛ يدخل بها من «مندوب توصيل؟ ← دخول المندوبين».
          </Text>
          <Ltr variant="bodyBold">{issued.username}</Ltr>
          <Ltr variant="bodyBold">{issued.password}</Ltr>
        </View>
      ) : null}

      {canWrite && live && !issued ? (
        issuing ? (
          <Row gap={space[2]}>
            <TextInput
              value={username}
              onChangeText={setUsername}
              placeholder="اسم مستخدم، مثال: ali.driver"
              placeholderTextColor={color.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={40}
              accessibilityLabel="اسم مستخدم المندوب"
              style={[fieldStyle(), { flex: 1, writingDirection: 'ltr', textAlign: 'left' }]}
            />
            <Button
              label="إصدار"
              size="md"
              disabled={username.trim().length < 3 || credentials.isPending}
              loading={credentials.isPending}
              onPress={() => credentials.mutate()}
            />
          </Row>
        ) : (
          <Pressable
            onPress={() => setIssuing(true)}
            accessibilityRole="button"
            style={{ minHeight: TAP_TARGET - 8, justifyContent: 'center' }}
          >
            <Text variant="smallBold" tone="brand">
              {driver.activated ? 'إصدار بيانات دخول جديدة' : 'إصدار بيانات الدخول'}
            </Text>
          </Pressable>
        )
      ) : null}
      {toggle.isPending ? <ActivityIndicator color={color.brand} /> : null}
    </View>
  );
}
