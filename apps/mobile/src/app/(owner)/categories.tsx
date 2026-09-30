import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import MaterialCommunityIcons from '@/ui/icon';
import { api, ApiError, type OwnerCategory } from '@/lib/api';
import { countAr } from '@/lib/arabic-count';
import { confirmAsync, notify } from '@/lib/dialog';
import { useOwner } from '@/lib/owner';
import { PRODUCTS, suggestedCategories } from '@/lib/owner-catalog';
import { sectionOf } from '@/lib/sections';
import { color, INPUT_TEXT_START, radius, ROW, space, TAP_TARGET, text } from '@/theme';
import { Button, EmptyState, ErrorState, Row, Screen, Skeleton, Text } from '@/ui';
import { OwnerHeader } from './index';

/**
 * The aisles — «الأقسام» — from the phone.
 *
 * A product has to live in a category, and the app used to send owners to the
 * web portal to make one: the first thing a new shop hit was a dead end. This
 * is the whole job on one screen. The usual aisles for this kind of shop are
 * one tap each (or all at once), a custom one is a field and a button, and an
 * existing one can be renamed, hidden, or removed while it is still empty.
 */
export default function OwnerCategoriesScreen() {
  const owner = useOwner();
  const shop = owner.shop;
  const queryClient = useQueryClient();
  const canWrite = owner.can('menu.write');

  const catalog = useQuery({
    queryKey: ['owner-catalog', shop?.id],
    queryFn: () => api.ownerCatalog(shop?.id as string),
    enabled: Boolean(shop?.id),
    staleTime: 60_000,
  });

  const categories = useMemo<OwnerCategory[]>(() => catalog.data?.categories ?? [], [catalog.data]);
  const suggestions = useMemo(
    () =>
      shop
        ? suggestedCategories(
            shop.merchant_type,
            categories.map((entry) => entry.name_ar),
          )
        : [],
    [shop, categories],
  );

  const [draft, setDraft] = useState('');
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['owner-catalog', shop?.id] });
  const explain = (caught: unknown, fallback: string) =>
    caught instanceof ApiError ? caught.messageAr : fallback;

  /*
   * Several at once, in order. Sequential rather than parallel so the aisles
   * keep the order they were offered in — the sort order is the position in
   * this list, and eight parallel inserts would land in whatever order the
   * network returned them.
   */
  const create = useMutation({
    mutationFn: async (names: string[]) => {
      if (!shop) return;
      let position = Math.max(0, ...categories.map((entry) => entry.sort_order)) + 1;
      for (const name of names) {
        await api.ownerCreateCategory(shop.id, { name_ar: name, sort_order: position });
        position += 1;
      }
    },
    onSuccess: async (_, names) => {
      await invalidate();
      setDraft('');
      if (names.length > 1) notify('تمت الإضافة', `أُضيفت ${countAr(names.length, CATEGORIES)}.`);
    },
    onError: (caught) => notify('تعذّرت الإضافة', explain(caught, 'حاول مرة أخرى.')),
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.ownerUpdateCategory(shop?.id as string, id, { name_ar: name }),
    onSuccess: invalidate,
    onError: (caught) => notify('تعذّر التعديل', explain(caught, 'حاول مرة أخرى.')),
  });

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.ownerUpdateCategory(shop?.id as string, id, { is_active: active }),
    onSuccess: invalidate,
    onError: (caught) => notify('تعذّر التعديل', explain(caught, 'حاول مرة أخرى.')),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.ownerDeleteCategory(shop?.id as string, id),
    onSuccess: invalidate,
    onError: (caught) =>
      notify('تعذّر الحذف', explain(caught, 'انقل منتجات القسم إلى قسم آخر أو احذفها أولاً.')),
  });

  if (!shop) {
    return (
      <Screen edges={['top', 'bottom']}>
        <OwnerHeader title="الأقسام" />
        <EmptyState title="لا يوجد متجر مفتوح" body="ارجع واختر متجراً." />
      </Screen>
    );
  }

  const draftName = draft.trim();
  const draftTaken = categories.some((entry) => entry.name_ar.trim() === draftName);
  const canAddDraft = canWrite && draftName.length >= 2 && !draftTaken && !create.isPending;

  return (
    <Screen scroll edges={['top', 'bottom']} padded={false}>
      <View style={{ padding: space[4], gap: space[4], paddingBottom: space[10] }}>
        <OwnerHeader title="الأقسام" />

        <Text variant="small" tone="secondary">
          كل منتج يقع تحت قسم، والزبون يتصفّح متجرك قسماً قسماً. أضف الأقسام التي تبيع فيها، ثم
          املأها بالمنتجات.
        </Text>

        {canWrite ? (
          <View style={{ gap: space[2] }}>
            <Text variant="smallBold" tone="secondary">
              قسم جديد
            </Text>
            <Row gap={space[2]}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={
                  shop.merchant_type === 'COSMETICS' ? 'مثال: عناية بالأظافر' : 'مثال: مكسرات'
                }
                placeholderTextColor={color.textMuted}
                accessibilityLabel="اسم القسم الجديد"
                maxLength={60}
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (canAddDraft) create.mutate([draftName]);
                }}
                style={[
                  text.body,
                  {
                    flex: 1,
                    minHeight: TAP_TARGET + 4,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: draftTaken ? color.danger : color.borderSubtle,
                    backgroundColor: color.surfaceCard,
                    paddingHorizontal: space[3],
                    color: color.textPrimary,
                    textAlign: INPUT_TEXT_START,
                  },
                ]}
              />
              <Button
                label="إضافة"
                disabled={!canAddDraft}
                loading={create.isPending && (create.variables?.length ?? 0) === 1}
                onPress={() => create.mutate([draftName])}
              />
            </Row>
            {draftTaken ? (
              <Text variant="caption" tone="danger">
                هذا القسم موجود.
              </Text>
            ) : null}
          </View>
        ) : null}

        {/*
         * The aisles this kind of shop usually has. One tap makes one; the
         * button makes the rest. A brand-new shop is set up in a few seconds
         * instead of typing eight names.
         */}
        {canWrite && suggestions.length > 0 ? (
          <View
            style={{
              padding: space[3],
              gap: space[2],
              borderRadius: radius.lg,
              backgroundColor: color.brandSoft,
              borderWidth: 1,
              borderColor: color.borderSubtle,
            }}
          >
            <Row justify="space-between">
              <Text variant="smallBold">
                أقسام معتادة في {sectionOf(shop.merchant_type).shopNoun}
              </Text>
              <Text variant="caption" tone="muted">
                اضغط لإضافة قسم
              </Text>
            </Row>
            <View style={{ flexDirection: ROW, flexWrap: 'wrap', gap: space[2] }}>
              {suggestions.map((aisle) => (
                <Pressable
                  key={aisle.key}
                  disabled={create.isPending}
                  onPress={() => create.mutate([aisle.labelAr])}
                  accessibilityRole="button"
                  accessibilityLabel={`إضافة قسم ${aisle.labelAr}`}
                  style={({ pressed }) => ({
                    flexDirection: ROW,
                    alignItems: 'center',
                    gap: space[1],
                    minHeight: TAP_TARGET - 6,
                    paddingHorizontal: space[3],
                    borderRadius: radius.full,
                    borderWidth: 1,
                    borderColor: color.brand,
                    backgroundColor: pressed ? color.brand : color.surfaceCard,
                  })}
                >
                  {({ pressed }) => (
                    <>
                      <MaterialCommunityIcons
                        name="plus"
                        size={16}
                        color={pressed ? color.textInverse : color.brand}
                      />
                      <Text variant="small" tone={pressed ? 'inverse' : 'primary'}>
                        {`${aisle.emoji} ${aisle.labelAr}`}
                      </Text>
                    </>
                  )}
                </Pressable>
              ))}
            </View>
            {suggestions.length > 1 ? (
              <Button
                label={`إضافة الكل (${suggestions.length})`}
                variant="secondary"
                block
                loading={create.isPending && (create.variables?.length ?? 0) > 1}
                disabled={create.isPending}
                onPress={() => create.mutate(suggestions.map((aisle) => aisle.labelAr))}
              />
            ) : null}
          </View>
        ) : null}

        {catalog.isLoading ? (
          <View style={{ gap: space[2] }}>
            <Skeleton height={64} style={{ borderRadius: radius.lg }} />
            <Skeleton height={64} style={{ borderRadius: radius.lg }} />
          </View>
        ) : catalog.isError ? (
          <ErrorState message="تعذّر تحميل الأقسام" onRetry={() => void catalog.refetch()} />
        ) : categories.length === 0 ? (
          <EmptyState
            title="لا أقسام بعد"
            body="ابدأ من الأقسام المعتادة أعلاه، أو اكتب اسم قسمك الخاص."
          />
        ) : (
          <View style={{ gap: space[2] }}>
            <Text variant="smallBold" tone="secondary">
              أقسام متجرك ({categories.length})
            </Text>
            {categories.map((entry) => (
              <CategoryRow
                key={entry.id}
                category={entry}
                canWrite={canWrite}
                busy={rename.isPending || toggle.isPending || remove.isPending}
                onRename={(name) => rename.mutate({ id: entry.id, name })}
                onToggle={() => toggle.mutate({ id: entry.id, active: !entry.is_active })}
                onRemove={() =>
                  void confirmAsync({
                    title: 'حذف القسم',
                    message: `سيُحذف «${entry.name_ar}». القسم الفارغ فقط يمكن حذفه.`,
                    confirmLabel: 'حذف',
                    destructive: true,
                  }).then((yes) => {
                    if (yes) remove.mutate(entry.id);
                  })
                }
              />
            ))}
          </View>
        )}
      </View>
    </Screen>
  );
}

const CATEGORIES = { one: 'قسم واحد', two: 'قسمان', few: 'أقسام', many: 'قسماً' };

/** One aisle: its name, how full it is, and the three things that can happen to it. */
function CategoryRow({
  category,
  canWrite,
  busy,
  onRename,
  onToggle,
  onRemove,
}: {
  category: OwnerCategory;
  canWrite: boolean;
  busy: boolean;
  onRename: (name: string) => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name_ar);
  const count = category.items.length;
  const hidden = !category.is_active;

  const commit = () => {
    const next = name.trim();
    setEditing(false);
    if (next.length >= 2 && next !== category.name_ar) onRename(next);
    else setName(category.name_ar);
  };

  return (
    <View
      style={{
        padding: space[3],
        gap: space[2],
        borderRadius: radius.lg,
        backgroundColor: color.surfaceCard,
        borderWidth: 1,
        borderColor: color.borderSubtle,
        opacity: hidden ? 0.7 : 1,
      }}
    >
      <Row gap={space[3]}>
        <View style={{ flex: 1, gap: 2 }}>
          {editing ? (
            <TextInput
              value={name}
              onChangeText={setName}
              autoFocus
              maxLength={60}
              onBlur={commit}
              onSubmitEditing={commit}
              accessibilityLabel="اسم القسم"
              style={[
                text.body,
                {
                  minHeight: TAP_TARGET,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: color.brand,
                  backgroundColor: color.surfacePage,
                  paddingHorizontal: space[3],
                  color: color.textPrimary,
                  textAlign: INPUT_TEXT_START,
                },
              ]}
            />
          ) : (
            <Text variant="bodyBold" numberOfLines={1}>
              {category.name_ar}
            </Text>
          )}
          <Row gap={space[2]}>
            <Text variant="caption" tone="muted">
              {count === 0 ? 'فارغ' : countAr(count, PRODUCTS)}
            </Text>
            {hidden ? (
              <Text variant="caption" tone="danger">
                مخفي عن الزبائن
              </Text>
            ) : null}
          </Row>
        </View>

        {canWrite ? (
          <Row gap={space[1]}>
            <IconAction
              icon="pencil-outline"
              label={`تعديل اسم ${category.name_ar}`}
              disabled={busy}
              onPress={() => setEditing(true)}
            />
            <IconAction
              icon={hidden ? 'eye-outline' : 'eye-off-outline'}
              label={hidden ? `إظهار ${category.name_ar}` : `إخفاء ${category.name_ar}`}
              disabled={busy}
              onPress={onToggle}
            />
            <IconAction
              icon="trash-can-outline"
              label={`حذف ${category.name_ar}`}
              disabled={busy || count > 0}
              tone="danger"
              onPress={onRemove}
            />
          </Row>
        ) : null}
      </Row>
      {busy ? <ActivityIndicator color={color.brand} /> : null}
    </View>
  );
}

function IconAction({
  icon,
  label,
  disabled,
  tone = 'neutral',
  onPress,
}: {
  icon: 'pencil-outline' | 'eye-outline' | 'eye-off-outline' | 'trash-can-outline';
  label: string;
  disabled: boolean;
  tone?: 'neutral' | 'danger';
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({
        width: TAP_TARGET - 4,
        height: TAP_TARGET - 4,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? color.surfaceSunken : 'transparent',
        opacity: disabled ? 0.35 : 1,
      })}
    >
      <MaterialCommunityIcons
        name={icon}
        size={20}
        color={tone === 'danger' ? color.dangerStrong : color.textSecondary}
      />
    </Pressable>
  );
}
