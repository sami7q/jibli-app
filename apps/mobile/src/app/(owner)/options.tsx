import { useState } from 'react';
import { ActivityIndicator, Pressable, Switch, TextInput, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { normalizeDigits } from '@jibli/validation/arabic';
import { formatIqdArabic, iqd } from '@jibli/money';
import MaterialCommunityIcons from '@/ui/icon';
import { api, ApiError, type OwnerModifier, type OwnerModifierGroup } from '@/lib/api';
import { notify } from '@/lib/dialog';
import { useOwner } from '@/lib/owner';
import { color, INPUT_TEXT_START, radius, ROW, space, TAP_TARGET, text } from '@/theme';
import { Button, EmptyState, ErrorState, Row, Screen, Skeleton, Text } from '@/ui';
import { OwnerHeader } from '@/ui/owner-header';

/**
 * The options a dish can carry — «الحجم»، «الإضافات» — from the phone.
 *
 * A group is defined once here and attached to every dish that uses it from
 * the dish's own screen, so «الحجم: وسط / كبير» is written once for all the
 * pizzas. A group is a name, a rule (must the customer choose, and how many
 * at most) and its options, each with the amount it adds to the price.
 *
 * Nothing is deleted. Yesterday's orders still point at their options, so a
 * group is switched off and an option marked unavailable instead — which is
 * also what a kitchen means when it runs out of something.
 */
export default function OwnerOptionsScreen() {
  const owner = useOwner();
  const shop = owner.shop;
  const queryClient = useQueryClient();
  const canWrite = owner.can('menu.write');
  const [creating, setCreating] = useState(false);

  const groups = useQuery({
    queryKey: ['owner-modifier-groups', shop?.id],
    queryFn: () => api.ownerModifierGroups(shop?.id as string),
    enabled: Boolean(shop?.id),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['owner-modifier-groups', shop?.id] });

  if (!shop) {
    return (
      <Screen edges={['top', 'bottom']}>
        <OwnerHeader title="خيارات الأطباق" />
        <EmptyState title="لا يوجد متجر مفتوح" body="ارجع واختر متجراً." />
      </Screen>
    );
  }

  return (
    <Screen scroll edges={['top', 'bottom']} padded={false}>
      <View style={{ padding: space[4], gap: space[4], paddingBottom: space[10] }}>
        <OwnerHeader title="خيارات الأطباق" />

        <Text variant="small" tone="secondary">
          مجموعات مثل «الحجم» أو «الإضافات»، لكل خيار سعر يُضاف إلى سعر الطبق. أنشئ المجموعة
          مرة واحدة، ثم اربطها بالأطباق من صفحة كل طبق.
        </Text>

        {canWrite ? (
          creating ? (
            <NewGroupForm
              shopId={shop.id}
              onDone={async () => {
                setCreating(false);
                await invalidate();
              }}
              onCancel={() => setCreating(false)}
            />
          ) : (
            <Button
              label="مجموعة خيارات جديدة"
              block
              size="lg"
              icon={<MaterialCommunityIcons name="plus" size={20} color={color.textInverse} />}
              onPress={() => setCreating(true)}
            />
          )
        ) : null}

        {groups.isLoading ? (
          <View style={{ gap: space[2] }}>
            <Skeleton height={96} style={{ borderRadius: radius.lg }} />
            <Skeleton height={96} style={{ borderRadius: radius.lg }} />
          </View>
        ) : groups.isError ? (
          <ErrorState message="تعذّر تحميل الخيارات" onRetry={() => void groups.refetch()} />
        ) : (groups.data ?? []).length === 0 ? (
          <EmptyState
            title="لا مجموعات بعد"
            body="مثال: «الحجم» بخيارين: وسط بلا زيادة، وكبير بزيادة 2,000."
          />
        ) : (
          (groups.data ?? []).map((group) => (
            <GroupCard
              key={group.id}
              shopId={shop.id}
              group={group}
              canWrite={canWrite}
              onChanged={invalidate}
            />
          ))
        )}
      </View>
    </Screen>
  );
}

const fieldStyle = (invalid = false) => [
  text.body,
  {
    minHeight: TAP_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: invalid ? color.danger : color.borderSubtle,
    backgroundColor: color.surfaceCard,
    paddingHorizontal: space[3],
    color: color.textPrimary,
    textAlign: INPUT_TEXT_START,
  },
];

const priceStyle = (invalid = false) => [
  ...fieldStyle(invalid),
  { writingDirection: 'ltr' as const, textAlign: 'left' as const },
];

const parsePrice = (value: string) => {
  const digits = normalizeDigits(value).replace(/\D/g, '');
  return digits === '' ? 0 : Number.parseInt(digits, 10);
};

const explain = (caught: unknown) =>
  caught instanceof ApiError ? caught.messageAr : 'حاول مرة أخرى.';

/** How the rule reads to the owner, in the customer's terms. */
function ruleLine(group: Pick<OwnerModifierGroup, 'is_required' | 'max_select'>): string {
  const how = group.max_select <= 1 ? 'خيار واحد' : `حتى ${group.max_select} خيارات`;
  return group.is_required ? `إلزامي — ${how}` : `اختياري — ${how}`;
}

function NewGroupForm({
  shopId,
  onDone,
  onCancel,
}: {
  shopId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [required, setRequired] = useState(true);
  const [multiple, setMultiple] = useState(false);
  const [rows, setRows] = useState([
    { name: '', price: '' },
    { name: '', price: '' },
  ]);

  const filled = rows.filter((row) => row.name.trim().length > 0);
  const valid = name.trim().length >= 2 && filled.length > 0;

  const create = useMutation({
    mutationFn: () =>
      api.ownerCreateModifierGroup(shopId, {
        name_ar: name.trim(),
        is_required: required,
        // A required single choice is «pick exactly one»; extras let the
        // customer take as many of the options as there are.
        min_select: required ? 1 : 0,
        max_select: multiple ? Math.max(1, filled.length) : 1,
        modifiers: filled.map((row) => ({ name_ar: row.name.trim(), price_iqd: parsePrice(row.price) })),
      }),
    onSuccess: () => {
      notify('تمت الإضافة', 'اربط المجموعة بالأطباق من صفحة كل طبق.');
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
      <Text variant="bodyBold">مجموعة جديدة</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="اسم المجموعة، مثال: الحجم"
        placeholderTextColor={color.textMuted}
        maxLength={60}
        accessibilityLabel="اسم المجموعة"
        style={fieldStyle()}
      />

      <SwitchRow
        label="إلزامي"
        hint="الزبون لا يكمل الطلب قبل أن يختار"
        value={required}
        onChange={setRequired}
      />
      <SwitchRow
        label="أكثر من خيار"
        hint="مثل الإضافات: يختار الزبون ما يشاء منها"
        value={multiple}
        onChange={setMultiple}
      />

      <Text variant="smallBold" tone="secondary">
        الخيارات والسعر الإضافي
      </Text>
      {rows.map((row, index) => (
        <Row key={index} gap={space[2]}>
          <TextInput
            value={row.name}
            onChangeText={(value) =>
              setRows((current) => current.map((r, i) => (i === index ? { ...r, name: value } : r)))
            }
            placeholder={index === 0 ? 'مثال: وسط' : 'مثال: كبير'}
            placeholderTextColor={color.textMuted}
            maxLength={60}
            accessibilityLabel={`اسم الخيار ${index + 1}`}
            style={[fieldStyle(), { flex: 2 }]}
          />
          <TextInput
            value={row.price}
            onChangeText={(value) =>
              setRows((current) => current.map((r, i) => (i === index ? { ...r, price: value } : r)))
            }
            placeholder="0"
            placeholderTextColor={color.textMuted}
            keyboardType="number-pad"
            maxLength={7}
            accessibilityLabel={`السعر الإضافي للخيار ${index + 1}`}
            style={[priceStyle(), { flex: 1 }]}
          />
        </Row>
      ))}
      {rows.length < 20 ? (
        <Pressable
          onPress={() => setRows((current) => [...current, { name: '', price: '' }])}
          accessibilityRole="button"
          style={{ minHeight: TAP_TARGET - 8, justifyContent: 'center' }}
        >
          <Text variant="smallBold" tone="brand">
            + خيار آخر
          </Text>
        </Pressable>
      ) : null}

      <Row gap={space[2]}>
        <View style={{ flex: 1 }}>
          <Button
            label="حفظ المجموعة"
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

function SwitchRow({
  label,
  hint,
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={{ flexDirection: ROW, alignItems: 'center', gap: space[3] }}>
      <View style={{ flex: 1 }}>
        <Text variant="smallBold">{label}</Text>
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: color.brand, false: color.borderStrong }}
        accessibilityLabel={label}
      />
    </View>
  );
}

function GroupCard({
  shopId,
  group,
  canWrite,
  onChanged,
}: {
  shopId: string;
  group: OwnerModifierGroup;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name_ar);
  const [newOption, setNewOption] = useState({ name: '', price: '' });

  const update = useMutation({
    mutationFn: (body: Parameters<typeof api.ownerUpdateModifierGroup>[2]) =>
      api.ownerUpdateModifierGroup(shopId, group.id, body),
    onSuccess: onChanged,
    onError: (caught) => notify('تعذّر التعديل', explain(caught)),
  });

  const add = useMutation({
    mutationFn: () =>
      api.ownerAddModifier(shopId, group.id, {
        name_ar: newOption.name.trim(),
        price_iqd: parsePrice(newOption.price),
      }),
    onSuccess: () => {
      setNewOption({ name: '', price: '' });
      onChanged();
    },
    onError: (caught) => notify('تعذّرت الإضافة', explain(caught)),
  });

  const multiple = group.max_select > 1;

  return (
    <View
      style={{
        padding: space[3],
        gap: space[2],
        borderRadius: radius.lg,
        backgroundColor: color.surfaceCard,
        borderWidth: 1,
        borderColor: color.borderSubtle,
        opacity: group.is_active ? 1 : 0.7,
      }}
    >
      <Row gap={space[2]}>
        <View style={{ flex: 1, gap: 2 }}>
          {editing ? (
            <TextInput
              value={name}
              onChangeText={setName}
              autoFocus
              maxLength={60}
              accessibilityLabel="اسم المجموعة"
              onBlur={() => {
                setEditing(false);
                if (name.trim().length >= 2 && name.trim() !== group.name_ar) {
                  update.mutate({ name_ar: name.trim() });
                } else {
                  setName(group.name_ar);
                }
              }}
              style={fieldStyle()}
            />
          ) : (
            <Text variant="bodyBold">{group.name_ar}</Text>
          )}
          <Text variant="caption" tone="muted">
            {group.is_active ? ruleLine(group) : 'موقوفة — لا تظهر للزبائن'}
          </Text>
        </View>
        {canWrite && !editing ? (
          <Pressable
            onPress={() => setEditing(true)}
            accessibilityRole="button"
            accessibilityLabel={`تعديل اسم ${group.name_ar}`}
            hitSlop={8}
          >
            <MaterialCommunityIcons name="pencil-outline" size={20} color={color.textSecondary} />
          </Pressable>
        ) : null}
      </Row>

      {canWrite ? (
        <View style={{ gap: space[2] }}>
          <SwitchRow
            label="إلزامي"
            hint="الزبون لا يكمل الطلب قبل أن يختار"
            value={group.is_required}
            disabled={update.isPending}
            onChange={(value) =>
              update.mutate({ is_required: value, min_select: value ? 1 : 0 })
            }
          />
          <SwitchRow
            label="أكثر من خيار"
            hint="يختار الزبون ما يشاء من الخيارات"
            value={multiple}
            disabled={update.isPending}
            onChange={(value) =>
              update.mutate({ max_select: value ? Math.max(2, group.modifiers.length) : 1 })
            }
          />
          <SwitchRow
            label="مفعّلة"
            hint="أوقفها لتختفي عن الزبائن دون أن تُحذف"
            value={group.is_active}
            disabled={update.isPending}
            onChange={(value) => update.mutate({ is_active: value })}
          />
        </View>
      ) : null}

      <View style={{ gap: space[1], paddingTop: space[1] }}>
        {group.modifiers.map((modifier) => (
          <OptionRow
            key={modifier.id}
            shopId={shopId}
            modifier={modifier}
            canWrite={canWrite}
            onChanged={onChanged}
          />
        ))}
      </View>

      {canWrite ? (
        <Row gap={space[2]}>
          <TextInput
            value={newOption.name}
            onChangeText={(value) => setNewOption((current) => ({ ...current, name: value }))}
            placeholder="خيار جديد"
            placeholderTextColor={color.textMuted}
            maxLength={60}
            accessibilityLabel={`خيار جديد في ${group.name_ar}`}
            style={[fieldStyle(), { flex: 2 }]}
          />
          <TextInput
            value={newOption.price}
            onChangeText={(value) => setNewOption((current) => ({ ...current, price: value }))}
            placeholder="0"
            placeholderTextColor={color.textMuted}
            keyboardType="number-pad"
            maxLength={7}
            accessibilityLabel="السعر الإضافي"
            style={[priceStyle(), { flex: 1 }]}
          />
          <Button
            label="إضافة"
            size="md"
            disabled={newOption.name.trim().length < 1 || add.isPending}
            loading={add.isPending}
            onPress={() => add.mutate()}
          />
        </Row>
      ) : null}
      {update.isPending ? <ActivityIndicator color={color.brand} /> : null}
    </View>
  );
}

function OptionRow({
  shopId,
  modifier,
  canWrite,
  onChanged,
}: {
  shopId: string;
  modifier: OwnerModifier;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(modifier.name_ar);
  const [price, setPrice] = useState(String(modifier.price_iqd));

  const update = useMutation({
    mutationFn: (body: Parameters<typeof api.ownerUpdateModifier>[2]) =>
      api.ownerUpdateModifier(shopId, modifier.id, body),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
    onError: (caught) => notify('تعذّر التعديل', explain(caught)),
  });

  if (editing) {
    return (
      <Row gap={space[2]}>
        <TextInput
          value={name}
          onChangeText={setName}
          maxLength={60}
          accessibilityLabel="اسم الخيار"
          style={[fieldStyle(), { flex: 2 }]}
        />
        <TextInput
          value={price}
          onChangeText={setPrice}
          keyboardType="number-pad"
          maxLength={7}
          accessibilityLabel="السعر الإضافي"
          style={[priceStyle(), { flex: 1 }]}
        />
        <Button
          label="حفظ"
          size="md"
          disabled={name.trim().length < 1 || update.isPending}
          loading={update.isPending}
          onPress={() => update.mutate({ name_ar: name.trim(), price_iqd: parsePrice(price) })}
        />
      </Row>
    );
  }

  return (
    <View
      style={{
        flexDirection: ROW,
        alignItems: 'center',
        gap: space[2],
        minHeight: TAP_TARGET - 4,
        paddingHorizontal: space[2],
        borderRadius: radius.md,
        backgroundColor: color.surfacePage,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text variant="small" tone={modifier.is_available ? 'primary' : 'muted'}>
          {modifier.name_ar}
        </Text>
        <Text variant="caption" tone="muted">
          {modifier.price_iqd === 0 ? 'بلا زيادة' : `+ ${formatIqdArabic(iqd(modifier.price_iqd))}`}
          {modifier.is_available ? '' : ' · غير متوفر'}
        </Text>
      </View>
      {canWrite ? (
        <>
          <Pressable
            onPress={() => setEditing(true)}
            accessibilityRole="button"
            accessibilityLabel={`تعديل ${modifier.name_ar}`}
            hitSlop={8}
          >
            <MaterialCommunityIcons name="pencil-outline" size={18} color={color.textSecondary} />
          </Pressable>
          <Switch
            value={modifier.is_available}
            disabled={update.isPending}
            onValueChange={(value) => update.mutate({ is_available: value })}
            trackColor={{ true: color.success, false: color.borderStrong }}
            accessibilityLabel={`${modifier.name_ar} متوفر`}
          />
        </>
      ) : null}
    </View>
  );
}
