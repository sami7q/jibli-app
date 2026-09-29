'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogoUpload } from '@jibli/ui-web';
import type { MerchantType } from '@jibli/contracts';
import { AdminShell } from '@/components/shell';
import { Badge, Card, ConfirmDialog, ErrorState, Skeleton } from '@/components/ui';
import { Icon } from '@/components/icon';
import { ApiError, adminApi } from '@/lib/api';
import { admin, type AppCategory } from '@/lib/admin-endpoints';
import { SessionGate } from '@/components/session-gate';
import { STOREFRONT_COPY, StorefrontTabs } from '@/components/storefront-tabs';
import { useAdminSession } from '@/hooks/use-session';

/**
 * The categories the customer app browses by.
 *
 * They used to be a constant compiled into the code: this screen could count
 * restaurants per category and nothing else, so adding one, renaming one, or
 * putting حلويات above برغر for Ramadan meant a release.
 *
 * Three things are deliberately not editable here:
 *
 *   The key. A restaurant carries it in `cuisine_tags`; renaming it would
 *   leave every restaurant tagged with something nothing matches, and the
 *   category would empty itself in silence.
 *
 *   Deletion of a category in use. The server refuses it and says how many
 *   restaurants are in the way. Hiding is what an operator means anyway.
 *
 *   The order, by typing a number. Order is a list you rearrange, not a column
 *   of integers to keep consistent by hand.
 */
export default function CategoriesPage() {
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AppCategory | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<AppCategory | null>(null);
  /*
   * Which storefront's categories are on screen. One at a time rather than one
   * list with a column: the two are ordered independently, and an operator
   * dragging «برجر» up is not thinking about groceries.
   */
  const [storefront, setStorefront] = useState<MerchantType>('RESTAURANT');
  const copy = STOREFRONT_COPY[storefront];

  const token = session.status === 'authenticated' ? session.accessToken : '';

  const categories = useQuery({
    queryKey: ['admin-categories', storefront],
    queryFn: () => admin.categories(token, storefront),
    enabled: session.status === 'authenticated',
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-categories'] });
  };

  const reorder = useMutation({
    mutationFn: (ids: string[]) => admin.reorderCategories(token, ids),
    onSuccess: invalidate,
  });

  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      admin.updateCategory(token, id, { is_active: isActive }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => admin.deleteCategory(token, id),
    onSuccess: () => {
      setDeleting(null);
      invalidate();
    },
  });

  if (session.status !== 'authenticated') {
    return <SessionGate session={session} />;
  }

  const rows = categories.data ?? [];

  /**
   * Move one category one place.
   *
   * The whole order is sent, not a "move up" command: a per-row nudge needs a
   * request per step and races itself when the list is reloaded mid-drag.
   */
  const move = (index: number, direction: -1 | 1) => {
    const next = index + direction;
    if (next < 0 || next >= rows.length) return;
    const ids = rows.map((row) => row.id);
    const moved = ids[index] as string;
    ids[index] = ids[next] as string;
    ids[next] = moved;
    reorder.mutate(ids);
  };

  return (
    <AdminShell
      title="التصنيفات"
      subtitle={
        storefront === 'MARKET'
          ? 'أقسام الماركت التي يتصفّح بها العميل، بترتيب ظهورها في التطبيق'
          : storefront === 'COSMETICS'
            ? 'أقسام التجميل التي يتصفّح بها العميل، بترتيب ظهورها في التطبيق'
            : 'الأصناف التي يتصفّح بها العميل، بترتيب ظهورها في التطبيق'
      }
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
      actions={
        <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
          {storefront === 'RESTAURANT' ? 'تصنيف جديد' : 'قسم جديد'}
        </button>
      }
    >
      <Card>
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <StorefrontTabs value={storefront} onChange={setStorefront} />
        </div>
        {categories.isError ? (
          <ErrorState
            message={
              categories.error instanceof ApiError
                ? categories.error.messageAr
                : 'تعذّر تحميل التصنيفات'
            }
            onRetry={() => void categories.refetch()}
          />
        ) : categories.isLoading ? (
          <Skeleton height={400} />
        ) : (
          <ul className="cats">
            {rows.map((category, index) => (
              <li
                key={category.id}
                className={`cat${category.is_active ? '' : ' cat--off'}`}
              >
                <div className="cat__order">
                  <button
                    type="button"
                    className="cat__move"
                    disabled={index === 0 || reorder.isPending}
                    onClick={() => move(index, -1)}
                    aria-label={`تحريك ${category.name_ar} للأعلى`}
                  >
                    <Icon name="chevron" className="cat__move-icon cat__move-icon--up" aria-hidden />
                  </button>
                  <span className="cat__position">{index + 1}</span>
                  <button
                    type="button"
                    className="cat__move"
                    disabled={index === rows.length - 1 || reorder.isPending}
                    onClick={() => move(index, 1)}
                    aria-label={`تحريك ${category.name_ar} للأسفل`}
                  >
                    <Icon name="chevron" className="cat__move-icon" aria-hidden />
                  </button>
                </div>

                <div className="cat__face" aria-hidden>
                  {category.image_asset_id ? (
                    <img src={adminApi.assetUrl(category.image_asset_id)} alt="" />
                  ) : (
                    <span className="cat__emoji">{category.emoji ?? copy.defaultEmoji}</span>
                  )}
                </div>

                <div className="cat__body">
                  <strong>{category.name_ar}</strong>
                  <span className="cat__key ltr-inline">{category.key}</span>
                </div>

                <div className="cat__count">
                  {category.restaurant_count > 0 ? (
                    <span>
                      <strong>{category.restaurant_count}</strong> {copy.countedAr}
                    </span>
                  ) : (
                    <span className="cat__empty">{copy.noneYetAr}</span>
                  )}
                </div>

                <div className="cat__state">
                  {category.is_active ? (
                    <Badge tone="success">ظاهر</Badge>
                  ) : (
                    <Badge tone="neutral">مخفي</Badge>
                  )}
                </div>

                <div className="cat__actions">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setEditing(category)}
                  >
                    تعديل
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={setActive.isPending}
                    onClick={() =>
                      setActive.mutate({ id: category.id, isActive: !category.is_active })
                    }
                  >
                    {category.is_active ? 'إخفاء' : 'إظهار'}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={category.restaurant_count > 0}
                    title={
                      category.restaurant_count > 0
                        ? `لا يمكن حذف تصنيف فيه ${copy.countedAr}ات — أخفِه بدلاً من ذلك`
                        : undefined
                    }
                    onClick={() => setDeleting(category)}
                  >
                    حذف
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="cats__note">
          الترتيب هنا هو ترتيب ظهور التصنيفات في تطبيق العميل. التصنيف المخفي يبقى على المطاعم
          المرتبطة به ولا يظهر للعملاء.
        </p>
      </Card>

      {creating ? (
        <CategoryDialog
          token={token}
          storefront={storefront}
          onDone={() => {
            setCreating(false);
            invalidate();
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      {editing ? (
        <CategoryDialog
          token={token}
          category={editing}
          onDone={() => {
            setEditing(null);
            invalidate();
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={`حذف ${deleting.name_ar}`}
          confirmLabel="حذف التصنيف"
          isSubmitting={remove.isPending}
          error={remove.error instanceof ApiError ? remove.error.messageAr : null}
          body={
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
              يُحذف التصنيف نهائياً ويختفي من التطبيق ومن قائمة اختيار التصنيف عند إنشاء مطعم.
              لا مطاعم مرتبطة به، فلن يتأثر أي مطعم.
            </p>
          }
          onConfirm={() => remove.mutate(deleting.id)}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </AdminShell>
  );
}

function CategoryDialog({
  token,
  category,
  storefront = 'RESTAURANT',
  onDone,
  onCancel,
}: {
  token: string;
  category?: AppCategory;
  /**
   * Which storefront a new category belongs to.
   *
   * Only read when creating: moving an existing category between storefronts
   * would strand every merchant already tagged with it in a half of the app
   * where the tag means nothing.
   */
  storefront?: MerchantType;
  onDone: () => void;
  onCancel: () => void;
}) {
  const isNew = category === undefined;
  const [nameAr, setNameAr] = useState(category?.name_ar ?? '');
  const [key, setKey] = useState(category?.key ?? '');
  const [emoji, setEmoji] = useState(category?.emoji ?? '');
  const [assetId, setAssetId] = useState<string | null>(category?.image_asset_id ?? null);
  const [preview, setPreview] = useState<string | null>(
    category?.image_asset_id ? adminApi.assetUrl(category.image_asset_id) : null,
  );

  const save = useMutation({
    // Returns void: create answers with an id and update with a flag, and the
    // dialog closes either way. Typing it as their union would make the caller
    // narrow a result nobody reads.
    mutationFn: async (): Promise<void> => {
      if (isNew) {
        await admin.createCategory(token, {
          key: key.trim(),
          name_ar: nameAr.trim(),
          merchant_type: storefront,
          ...(emoji.trim() ? { emoji: emoji.trim() } : {}),
          ...(assetId ? { image_asset_id: assetId } : {}),
        });
        return;
      }

      await admin.updateCategory(token, category.id, {
        name_ar: nameAr.trim(),
        emoji: emoji.trim() || null,
        image_asset_id: assetId,
      });
    },
    onSuccess: onDone,
  });

  const keyValid = /^[a-z][a-z0-9_]{1,39}$/.test(key.trim());
  const canSave = nameAr.trim().length > 0 && (!isNew || keyValid) && !save.isPending;

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="cat-title">
      <div className="dialog">
        <h2 id="cat-title">{isNew ? 'تصنيف جديد' : `تعديل ${category.name_ar}`}</h2>

        <LogoUpload
          value={preview}
          label="صورة التصنيف"
          hint="تظهر في شريط التصنيفات داخل التطبيق. PNG أو JPG أو WebP حتى ٥ ميغابايت."
          upload={(dataUrl) =>
            adminApi.uploadImage(token, { data: dataUrl, purpose: 'RESTAURANT_LOGO' })
          }
          onChange={(uploadedId, previewUrl) => {
            setAssetId(uploadedId);
            setPreview(previewUrl);
          }}
        />

        <div className="field">
          <label htmlFor="cat-name">الاسم بالعربية</label>
          <input
            id="cat-name"
            value={nameAr}
            onChange={(event) => setNameAr(event.target.value)}
            placeholder="مأكولات عراقية"
            maxLength={60}
          />
          <span className="field__hint">هذا ما يراه العميل.</span>
        </div>

        <div className="field">
          <label htmlFor="cat-emoji">الرمز التعبيري (اختياري)</label>
          <input
            id="cat-emoji"
            value={emoji}
            onChange={(event) => setEmoji(event.target.value)}
            placeholder="🍛"
            maxLength={8}
          />
          <span className="field__hint">يُستخدم حين لا توجد صورة، وفي القوائم الضيّقة.</span>
        </div>

        {isNew ? (
          <div className="field">
            <label htmlFor="cat-key">المعرّف</label>
            <input
              id="cat-key"
              dir="ltr"
              value={key}
              onChange={(event) => setKey(event.target.value.toLowerCase().trim())}
              placeholder="iraqi"
              aria-invalid={key !== '' && !keyValid}
            />
            <span className="field__hint">
              أحرف إنجليزية صغيرة وأرقام وشرطة سفلية. يُخزَّن على المطاعم ولا يمكن تغييره بعد
              الإنشاء.
            </span>
            {key !== '' && !keyValid ? (
              <span className="field__error">صيغة غير صالحة — يبدأ بحرف، من حرفين إلى ٤٠</span>
            ) : null}
          </div>
        ) : (
          <div className="inherited">
            <div className="inherited__value ltr-inline" style={{ fontSize: 'var(--text-base)' }}>
              {category.key}
            </div>
            <div className="inherited__body">
              <strong>المعرّف</strong>
              <span>
                مخزَّن على {category.restaurant_count} مطعم ولا يمكن تغييره — تغييره يترك تلك
                المطاعم مرتبطة بتصنيف غير موجود.
              </span>
            </div>
          </div>
        )}

        {save.error ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {save.error instanceof ApiError ? save.error.messageAr : 'تعذّر الحفظ'}
          </p>
        ) : null}

        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canSave}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'جاري الحفظ…' : isNew ? 'إنشاء' : 'حفظ'}
          </button>
          <button type="button" className="btn btn--outline" onClick={onCancel}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
