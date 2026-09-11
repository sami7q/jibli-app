'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { money } from '@jibli/ui-web';
import { PortalPage, type PortalAuth } from '@/components/portal-page';
import { Card, ConfirmDialog, ErrorState, Skeleton } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { portal, type MenuCategory, type MenuItem } from '@/lib/portal-endpoints';

/**
 * Menu management (plan §19, §20, §116).
 *
 * The action staff take most often is marking something sold out, so it is a
 * single tap on the row rather than a form behind an edit screen.
 *
 * Cost prices appear only when the role permits it (plan §38, §86) — a Cashier
 * manages availability without ever seeing margin. The server decides that and
 * omits the field; this page follows the response rather than its own guess.
 */
export default function MenuPage() {
  return (
    <PortalPage permission="menu.read" permissionLabelAr="قراءة المنيو">
      {({ auth, can }) => <MenuScreen auth={auth} canWrite={can('menu.write')} />}
    </PortalPage>
  );
}

function MenuScreen({ auth, canWrite }: { auth: PortalAuth; canWrite: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ item: MenuItem; categoryId: string } | null>(null);
  const [addingItem, setAddingItem] = useState<string | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const [deleting, setDeleting] = useState<MenuItem | null>(null);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['menu'] });

  const menu = useQuery({
    queryKey: ['menu', auth.restaurantId],
    queryFn: () => portal.menu(auth),
  });

  const toggleAvailability = useMutation({
    mutationFn: ({ id, isAvailable }: { id: string; isAvailable: boolean }) =>
      portal.setItemAvailability(auth, id, isAvailable),
    onSuccess: invalidate,
  });

  const deleteItem = useMutation({
    mutationFn: (id: string) => portal.deleteItem(auth, id),
    onSuccess: () => {
      setDeleting(null);
      invalidate();
    },
  });

  if (menu.isError) {
    return (
      <ErrorState
        message={menu.error instanceof ApiError ? menu.error.messageAr : 'تعذّر تحميل المنيو'}
        code={menu.error instanceof ApiError ? menu.error.code : undefined}
        onRetry={() => void menu.refetch()}
      />
    );
  }

  if (menu.isLoading) return <Skeleton height={420} />;

  const data = menu.data;
  const categories = data?.categories ?? [];
  const canSeeCost = data?.can_see_cost ?? false;
  const allItems = categories.flatMap((category) => category.items);
  const soldOut = allItems.filter((item) => !item.is_available).length;

  return (
    <>
      <Card
        title="المنيو"
        icon="menu"
        subtitle={`${allItems.length} صنف في ${categories.length} تصنيف`}
        actions={
          canWrite ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => setAddingCategory(true)}
            >
              إضافة تصنيف
            </button>
          ) : null
        }
      >
        <div className="split">
          <div className="figure">
            <span className="figure__label">أصناف متاحة الآن</span>
            <span className="figure__value">{allItems.length - soldOut}</span>
          </div>
          <div className="figure">
            <span className="figure__label">أصناف غير متاحة</span>
            <span
              className="figure__value"
              style={{ color: soldOut > 0 ? 'var(--jibli-danger-700)' : undefined }}
            >
              {soldOut}
            </span>
          </div>
          <div className="figure">
            <span className="figure__label">نسخة المنيو</span>
            <span className="figure__value">{data?.menu_version ?? 1}</span>
          </div>
        </div>

        {/*
          The version number is not decoration: a customer's cart is validated
          against it at checkout, so a price change invalidates stale carts
          instead of charging an old price (plan §20).
        */}
        <p
          style={{
            marginBlockStart: 'var(--space-3)',
            marginBlockEnd: 0,
            fontSize: 'var(--text-sm)',
            color: 'var(--text-muted)',
          }}
        >
          كل تعديل على المنيو يرفع رقم النسخة، فتُراجَع سلّات العملاء القديمة عند الدفع بدل أن تمرّ
          بسعر قديم.
        </p>

        {categories.length === 0 ? (
          <div className="empty">
            <p style={{ margin: 0, fontWeight: 600 }}>لم تُضف تصنيفات بعد</p>
            <p style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
              ابدأ بتصنيف مثل «الأطباق الرئيسية» ثم أضف أصنافه.
            </p>
          </div>
        ) : null}
      </Card>

      {toggleAvailability.error ? (
        <ErrorState
          message={
            toggleAvailability.error instanceof ApiError
              ? toggleAvailability.error.messageAr
              : 'تعذّر تغيير حالة التوفر'
          }
        />
      ) : null}

      {categories.map((category) => (
        <CategoryCard
          key={category.id}
          category={category}
          canSeeCost={canSeeCost}
          canWrite={canWrite}
          onToggle={(item) =>
            toggleAvailability.mutate({ id: item.id, isAvailable: !item.is_available })
          }
          onEdit={(item) => setEditing({ item, categoryId: category.id })}
          onDelete={setDeleting}
          onAddItem={() => setAddingItem(category.id)}
          isBusy={toggleAvailability.isPending}
        />
      ))}

      {addingCategory ? (
        <CategoryDialog
          auth={auth}
          onDone={() => {
            setAddingCategory(false);
            invalidate();
          }}
          onCancel={() => setAddingCategory(false)}
        />
      ) : null}

      {addingItem ? (
        <ItemDialog
          auth={auth}
          categoryId={addingItem}
          canSeeCost={canSeeCost}
          onDone={() => {
            setAddingItem(null);
            invalidate();
          }}
          onCancel={() => setAddingItem(null)}
        />
      ) : null}

      {editing ? (
        <ItemDialog
          auth={auth}
          categoryId={editing.categoryId}
          item={editing.item}
          canSeeCost={canSeeCost}
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
          confirmLabel="حذف الصنف"
          isSubmitting={deleteItem.isPending}
          error={deleteItem.error instanceof ApiError ? deleteItem.error.messageAr : null}
          body={
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
              يُخفى الصنف من المنيو ولا يعود متاحاً للطلب. الطلبات السابقة تحتفظ باسمه وسعره كما
              كانا وقت الطلب، فلا يتغيّر أي سجل قديم.
            </p>
          }
          onConfirm={() => deleteItem.mutate(deleting.id)}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </>
  );
}

function CategoryCard({
  category,
  canSeeCost,
  canWrite,
  onToggle,
  onEdit,
  onDelete,
  onAddItem,
  isBusy,
}: {
  category: MenuCategory;
  canSeeCost: boolean;
  canWrite: boolean;
  onToggle: (item: MenuItem) => void;
  onEdit: (item: MenuItem) => void;
  onDelete: (item: MenuItem) => void;
  onAddItem: () => void;
  isBusy: boolean;
}) {
  return (
    <Card
      title={category.name_ar}
      subtitle={category.description_ar ?? undefined}
      actions={
        canWrite ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={onAddItem}>
            إضافة صنف
          </button>
        ) : null
      }
    >
      {category.items.length === 0 ? (
        <p className="empty">لا توجد أصناف في هذا التصنيف</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">الصنف</th>
                <th scope="col" className="numeric">
                  السعر
                </th>
                {canSeeCost ? (
                  <th scope="col" className="numeric">
                    التكلفة
                  </th>
                ) : null}
                {canSeeCost ? (
                  <th scope="col" className="numeric">
                    هامش الربح
                  </th>
                ) : null}
                <th scope="col">التوفر</th>
                {canWrite ? <th scope="col">إجراءات</th> : null}
              </tr>
            </thead>
            <tbody>
              {category.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.name_ar}</strong>
                    {item.is_popular ? (
                      <span style={{ marginInlineStart: 6 }} title="الأكثر طلباً">
                        🔥
                      </span>
                    ) : null}
                    {item.description_ar ? (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                        {item.description_ar}
                      </div>
                    ) : null}
                  </td>
                  <td className="numeric">{money(item.base_price_iqd)}</td>
                  {canSeeCost ? (
                    <td className="numeric">
                      {item.cost_price_iqd ? money(item.cost_price_iqd) : '—'}
                    </td>
                  ) : null}
                  {canSeeCost ? (
                    <td className="numeric">
                      {item.margin_iqd === undefined ? (
                        '—'
                      ) : (
                        <span
                          style={{
                            color:
                              item.margin_iqd > 0
                                ? 'var(--jibli-success-700)'
                                : 'var(--jibli-danger-700)',
                          }}
                        >
                          {money(item.margin_iqd)}
                        </span>
                      )}
                    </td>
                  ) : null}
                  <td>
                    <AvailabilityToggle
                      item={item}
                      canWrite={canWrite}
                      isBusy={isBusy}
                      onToggle={() => onToggle(item)}
                    />
                  </td>
                  {canWrite ? (
                    <td>
                      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => onEdit(item)}
                        >
                          تعديل
                        </button>
                        <button
                          type="button"
                          className="btn btn--danger btn--sm"
                          onClick={() => onDelete(item)}
                        >
                          حذف
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function AvailabilityToggle({
  item,
  canWrite,
  isBusy,
  onToggle,
}: {
  item: MenuItem;
  canWrite: boolean;
  isBusy: boolean;
  onToggle: () => void;
}) {
  const label = item.is_available ? 'متوفر' : 'غير متوفر';

  /*
   * Stock-driven unavailability is not the same as a staff decision: one clears
   * itself when the ingredient is received, the other does not. Showing which it
   * is stops staff flipping a switch that inventory will flip straight back
   * (plan §37).
   */
  const stockDriven = item.unavailable_by_inventory;

  return (
    <>
      {canWrite && !stockDriven ? (
        <button
          type="button"
          className={`badge badge--${item.is_available ? 'ready' : 'failed'}`}
          style={{ border: 'none', cursor: 'pointer' }}
          disabled={isBusy}
          onClick={onToggle}
          aria-label={`${item.name_ar}: ${label}. اضغط للتغيير`}
        >
          {label}
        </button>
      ) : (
        <span className={`badge badge--${item.is_available ? 'ready' : 'failed'}`}>{label}</span>
      )}

      {stockDriven ? (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          نفد المخزون — يعود تلقائياً عند التوريد
        </div>
      ) : null}
    </>
  );
}

function CategoryDialog({
  auth,
  onDone,
  onCancel,
}: {
  auth: PortalAuth;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [nameAr, setNameAr] = useState('');
  const [descriptionAr, setDescriptionAr] = useState('');

  const create = useMutation({
    mutationFn: () =>
      portal.createCategory(auth, {
        name_ar: nameAr.trim(),
        description_ar: descriptionAr.trim() || undefined,
      }),
    onSuccess: onDone,
  });

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="cat-title">
      <div className="dialog">
        <h2 id="cat-title">إضافة تصنيف</h2>

        <div className="field">
          <label htmlFor="cat-name">اسم التصنيف</label>
          <input
            id="cat-name"
            value={nameAr}
            onChange={(event) => setNameAr(event.target.value)}
            placeholder="الأطباق الرئيسية"
          />
        </div>

        <div className="field">
          <label htmlFor="cat-desc">وصف (اختياري)</label>
          <input
            id="cat-desc"
            value={descriptionAr}
            onChange={(event) => setDescriptionAr(event.target.value)}
          />
        </div>

        {create.error ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {create.error instanceof ApiError ? create.error.messageAr : 'تعذّرت الإضافة'}
          </p>
        ) : null}

        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={nameAr.trim().length < 2 || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'جاري الحفظ…' : 'إضافة'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}

function ItemDialog({
  auth,
  categoryId,
  item,
  canSeeCost,
  onDone,
  onCancel,
}: {
  auth: PortalAuth;
  categoryId: string;
  item?: MenuItem;
  canSeeCost: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [nameAr, setNameAr] = useState(item?.name_ar ?? '');
  const [descriptionAr, setDescriptionAr] = useState(item?.description_ar ?? '');
  const [price, setPrice] = useState(item?.base_price_iqd ?? 0);
  const [cost, setCost] = useState(item?.cost_price_iqd ?? 0);
  const [isPopular, setIsPopular] = useState(item?.is_popular ?? false);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        category_id: categoryId,
        name_ar: nameAr.trim(),
        description_ar: descriptionAr.trim() || undefined,
        base_price_iqd: price,
        ...(canSeeCost && cost > 0 ? { cost_price_iqd: cost } : {}),
        is_popular: isPopular,
      };
      // Both calls return different shapes; the dialog only cares that it
      // resolved, so collapse them to one type rather than widening callers.
      return item
        ? portal.updateItem(auth, item.id, body).then(() => undefined)
        : portal.createItem(auth, body).then(() => undefined);
    },
    onSuccess: onDone,
  });

  // IQD has no minor unit, so a price is always a whole number (plan §22).
  const priceInvalid = !Number.isInteger(price) || price <= 0;
  const margin = price - cost;

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="item-title">
      <div className="dialog">
        <h2 id="item-title">{item ? `تعديل ${item.name_ar}` : 'إضافة صنف'}</h2>

        <div className="field">
          <label htmlFor="item-name">اسم الصنف</label>
          <input
            id="item-name"
            value={nameAr}
            onChange={(event) => setNameAr(event.target.value)}
            placeholder="كباب عراقي"
          />
        </div>

        <div className="field">
          <label htmlFor="item-desc">الوصف (اختياري)</label>
          <textarea
            id="item-desc"
            rows={2}
            value={descriptionAr}
            onChange={(event) => setDescriptionAr(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="item-price">سعر البيع (دينار)</label>
          <input
            id="item-price"
            type="number"
            min={0}
            step={250}
            value={price}
            onChange={(event) => setPrice(Math.trunc(Number(event.target.value)))}
            aria-invalid={priceInvalid}
          />
          {priceInvalid ? (
            <span className="field__error">السعر يجب أن يكون رقماً صحيحاً أكبر من صفر</span>
          ) : null}
        </div>

        {canSeeCost ? (
          <>
            <div className="field">
              <label htmlFor="item-cost">سعر التكلفة (اختياري)</label>
              <input
                id="item-cost"
                type="number"
                min={0}
                step={250}
                value={cost}
                onChange={(event) => setCost(Math.trunc(Number(event.target.value)))}
              />
              <span className="field__hint">
                يُستخدم لحساب هامش الربح في تقرير الأرباح فقط، ولا يظهر للعملاء أبداً.
              </span>
            </div>

            {cost > 0 ? (
              <p
                className={`alert-bar alert-bar--${margin > 0 ? 'success' : 'danger'}`}
                style={{ fontSize: 'var(--text-sm)' }}
              >
                هامش الربح لكل وحدة: {money(margin)}
                {margin <= 0 ? ' — سعر البيع لا يغطّي التكلفة' : ''}
              </p>
            ) : null}
          </>
        ) : null}

        <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={isPopular}
            onChange={(event) => setIsPopular(event.target.checked)}
          />
          عرضه ضمن «الأكثر طلباً»
        </label>

        {save.error ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {save.error instanceof ApiError ? save.error.messageAr : 'تعذّر الحفظ'}
          </p>
        ) : null}

        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={nameAr.trim().length < 2 || priceInvalid || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'جاري الحفظ…' : 'حفظ'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
