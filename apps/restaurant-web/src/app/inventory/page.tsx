'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { INVENTORY_UNITS, type InventoryUnit } from '@jibli/contracts';
import { money } from '@jibli/ui-web';
import { PortalPage, type PortalAuth } from '@/components/portal-page';
import { Card, ErrorState, Skeleton } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { portal, type InventoryItem, type InventoryMovement } from '@/lib/portal-endpoints';

/**
 * Inventory (plan §34–§37).
 *
 * The plan is explicit that stock is changed by *named commands*, never by an
 * open "set quantity to N" field, so this screen offers exactly the four the
 * API exposes — receive, adjust, waste, return — and each one records who did
 * it and why. A manual adjustment or a write-off demands a written reason
 * before the button enables.
 */

type Command = 'receive' | 'adjust' | 'waste' | 'return';

const COMMAND_LABELS: Record<Command, string> = {
  receive: 'توريد',
  adjust: 'تسوية جرد',
  waste: 'إتلاف',
  return: 'إرجاع للمورّد',
};

const COMMAND_HINTS: Record<Command, string> = {
  receive: 'بضاعة وصلت من المورّد. تزيد الرصيد وتحدّث سعر التكلفة إن أدخلته.',
  adjust: 'فرق ظهر عند الجرد. اكتب كمية موجبة إذا كان الموجود أكثر من المسجّل، وسالبة إذا كان أقل.',
  waste: 'تالف أو منتهي الصلاحية. تُنقص الرصيد ولا تعود.',
  return: 'بضاعة رُدّت إلى المورّد. تُنقص الرصيد.',
};

/** Keyed by InventoryUnit so a unit added to the contract fails to compile here
 *  rather than silently rendering its raw code. */
const UNIT_LABELS: Record<InventoryUnit, string> = {
  PIECE: 'قطعة',
  GRAM: 'غم',
  KILOGRAM: 'كغم',
  MILLILITER: 'مل',
  LITER: 'لتر',
};

const MOVEMENT_LABELS: Record<string, string> = {
  OPENING_BALANCE: 'رصيد افتتاحي',
  PURCHASE: 'توريد',
  ADJUSTMENT: 'تسوية جرد',
  WASTE: 'إتلاف',
  RETURN: 'إرجاع للمورّد',
  SALE_CONSUMPTION: 'استهلاك بيع',
  RESERVATION: 'حجز لطلب',
  RESERVATION_RELEASE: 'تحرير حجز',
};

/** The wire type is a plain string; fall back to the code if it is ever new. */
function unitLabel(unit: string): string {
  return UNIT_LABELS[unit as InventoryUnit] ?? unit;
}

export default function InventoryPage() {
  return (
    <PortalPage permission="inventory.read" permissionLabelAr="قراءة المخزون">
      {({ auth, can }) => (
        <InventoryScreen
          auth={auth}
          canAdjust={can('inventory.adjust')}
          canWaste={can('inventory.waste')}
        />
      )}
    </PortalPage>
  );
}

function InventoryScreen({
  auth,
  canAdjust,
  canWaste,
}: {
  auth: PortalAuth;
  canAdjust: boolean;
  canWaste: boolean;
}) {
  const queryClient = useQueryClient();
  const [command, setCommand] = useState<{ item: InventoryItem; command: Command } | null>(null);
  const [historyFor, setHistoryFor] = useState<InventoryItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [onlyLow, setOnlyLow] = useState(false);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['inventory'] });

  const inventory = useQuery({
    queryKey: ['inventory', auth.restaurantId],
    queryFn: () => portal.inventory(auth),
  });

  if (inventory.isError) {
    return (
      <ErrorState
        message={
          inventory.error instanceof ApiError ? inventory.error.messageAr : 'تعذّر تحميل المخزون'
        }
        code={inventory.error instanceof ApiError ? inventory.error.code : undefined}
        onRetry={() => void inventory.refetch()}
      />
    );
  }

  if (inventory.isLoading) return <Skeleton height={420} />;

  const items = inventory.data ?? [];
  const lowItems = items.filter((item) => item.is_low_stock);
  const visible = onlyLow ? lowItems : items;
  const tracked = items.filter((item) => item.is_tracked).length;
  // Present only when the role may see cost (plan §38); summing undefined
  // values would quietly report zero, so check before totalling.
  const canSeeValue = items.some((item) => item.stock_value_iqd !== undefined);
  const totalValue = items.reduce((sum, item) => sum + (item.stock_value_iqd ?? 0), 0);

  return (
    <>
      <Card
        title="المخزون"
        icon="inventory"
        subtitle={`${items.length} مادة، منها ${tracked} مرتبطة بأصناف المنيو`}
        actions={
          canAdjust ? (
            <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
              إضافة مادة
            </button>
          ) : null
        }
      >
        <div className="split">
          <div className="figure">
            <span className="figure__label">مواد تحت حد التنبيه</span>
            <span
              className="figure__value"
              style={{ color: lowItems.length > 0 ? 'var(--jibli-danger-700)' : undefined }}
            >
              {lowItems.length}
            </span>
          </div>
          {canSeeValue ? (
            <div className="figure">
              <span className="figure__label">قيمة المخزون التقديرية</span>
              <span className="figure__value">{money(totalValue)}</span>
            </div>
          ) : null}
          <div className="figure">
            <span className="figure__label">مواد مرتبطة بوصفات</span>
            <span className="figure__value">{tracked}</span>
          </div>
        </div>

        {lowItems.length > 0 ? (
          <p
            className="alert-bar alert-bar--warning"
            style={{ marginBlockStart: 'var(--space-4)' }}
          >
            <span style={{ flex: 1 }}>
              {lowItems.length === 1
                ? 'مادة واحدة قاربت على النفاد'
                : `${lowItems.length} مواد قاربت على النفاد`}{' '}
              — الأصناف المرتبطة بها تُخفى تلقائياً من المنيو عند الوصول إلى صفر.
            </span>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setOnlyLow((value) => !value)}
            >
              {onlyLow ? 'عرض الكل' : 'عرض الناقص فقط'}
            </button>
          </p>
        ) : null}
      </Card>

      <Card title={onlyLow ? 'المواد الناقصة' : 'جميع المواد'}>
        {visible.length === 0 ? (
          <div className="empty">
            <p style={{ margin: 0, fontWeight: 600 }}>
              {onlyLow ? 'لا توجد مواد تحت حد التنبيه' : 'لم تُضف مواد بعد'}
            </p>
            {!onlyLow ? (
              <p style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
                أضف المواد التي تتابعها، ثم اربطها بأصناف المنيو حتى يُخصم المخزون تلقائياً مع كل
                طلب.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">المادة</th>
                  <th scope="col" className="numeric">
                    الموجود
                  </th>
                  <th scope="col" className="numeric">
                    محجوز لطلبات
                  </th>
                  <th scope="col" className="numeric">
                    المتاح للبيع
                  </th>
                  <th scope="col" className="numeric">
                    حد التنبيه
                  </th>
                  <th scope="col">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.name_ar}</strong>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                        {unitLabel(item.unit)}
                        {item.sku ? ` · ${item.sku}` : ''}
                        {item.allow_negative_stock ? ' · يسمح بالسالب' : ''}
                      </div>
                    </td>
                    <td className="numeric">{item.on_hand}</td>
                    <td className="numeric">{item.reserved}</td>
                    <td className="numeric">
                      <span className={`badge badge--${item.is_low_stock ? 'failed' : 'ready'}`}>
                        {item.available}
                      </span>
                    </td>
                    <td className="numeric">{item.low_stock_threshold ?? '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                        {canAdjust ? (
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            onClick={() => setCommand({ item, command: 'receive' })}
                          >
                            توريد
                          </button>
                        ) : null}
                        {canAdjust ? (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => setCommand({ item, command: 'adjust' })}
                          >
                            تسوية
                          </button>
                        ) : null}
                        {canWaste ? (
                          <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            onClick={() => setCommand({ item, command: 'waste' })}
                          >
                            إتلاف
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => setHistoryFor(item)}
                        >
                          الحركات
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {command ? (
        <CommandDialog
          auth={auth}
          item={command.item}
          command={command.command}
          onDone={() => {
            setCommand(null);
            invalidate();
          }}
          onCancel={() => setCommand(null)}
        />
      ) : null}

      {historyFor ? (
        <MovementsDialog auth={auth} item={historyFor} onClose={() => setHistoryFor(null)} />
      ) : null}

      {adding ? (
        <NewItemDialog
          auth={auth}
          onDone={() => {
            setAdding(false);
            invalidate();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}
    </>
  );
}

function CommandDialog({
  auth,
  item,
  command,
  onDone,
  onCancel,
}: {
  auth: PortalAuth;
  item: InventoryItem;
  command: Command;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [reason, setReason] = useState('');

  const requiresReason = command !== 'receive';
  const allowsSign = command === 'adjust';

  const run = useMutation({
    mutationFn: () =>
      portal.stockCommand(auth, item.id, command, {
        quantity,
        ...(command === 'receive' && unitCost ? { unit_cost_iqd: Number(unitCost) } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: onDone,
  });

  // Mirrors the server's schema so a bad value is caught before the round trip
  // rather than only in the error envelope.
  const quantityPattern = allowsSign ? /^-?\d+(\.\d{1,3})?$/ : /^\d+(\.\d{1,3})?$/;
  const quantityValid = quantityPattern.test(quantity) && Number(quantity) !== 0;
  const reasonValid = !requiresReason || reason.trim().length >= 5;

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="cmd-title">
      <div className="dialog">
        <h2 id="cmd-title">
          {COMMAND_LABELS[command]} — {item.name_ar}
        </h2>

        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          {COMMAND_HINTS[command]}
        </p>

        <div className="split">
          <div className="figure">
            <span className="figure__label">الموجود حالياً</span>
            <span className="figure__value">
              {item.on_hand} {unitLabel(item.unit)}
            </span>
          </div>
          <div className="figure">
            <span className="figure__label">المحجوز لطلبات جارية</span>
            <span className="figure__value">{item.reserved}</span>
          </div>
        </div>

        <div className="field">
          <label htmlFor="cmd-qty">الكمية ({unitLabel(item.unit)})</label>
          <input
            id="cmd-qty"
            inputMode="decimal"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            placeholder={allowsSign ? 'مثال: 2.5 أو 1.5-' : 'مثال: 2.5'}
            aria-invalid={quantity !== '' && !quantityValid}
          />
          <span className="field__hint">
            حتى ثلاث منازل عشرية. تُخزَّن الكميات كأعداد صحيحة بوحدات الألف حتى لا يتراكم خطأ الكسور
            العشرية.
          </span>
          {quantity !== '' && !quantityValid ? (
            <span className="field__error">
              {allowsSign
                ? 'أدخل رقماً غير صفري، ويمكن أن يبدأ بإشارة سالب'
                : 'أدخل رقماً موجباً غير صفري'}
            </span>
          ) : null}
        </div>

        {command === 'receive' ? (
          <div className="field">
            <label htmlFor="cmd-cost">سعر تكلفة الوحدة (اختياري)</label>
            <input
              id="cmd-cost"
              type="number"
              min={0}
              step={250}
              value={unitCost}
              onChange={(event) => setUnitCost(event.target.value)}
            />
            <span className="field__hint">
              إدخاله يحدّث أساس التكلفة المستخدم في تقرير الأرباح وقيمة المخزون.
            </span>
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="cmd-reason">السبب {requiresReason ? '(مطلوب)' : '(اختياري)'}</label>
          <textarea
            id="cmd-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={
              command === 'waste'
                ? 'انتهت الصلاحية'
                : command === 'adjust'
                  ? 'فرق جرد نهاية اليوم'
                  : ''
            }
            aria-invalid={requiresReason && reason.length > 0 && !reasonValid}
          />
          {requiresReason ? (
            <span className="field__hint">
              يُحفظ السبب مع الحركة باسمك ووقتها، ويظهر في سجل الحركات لاحقاً.
            </span>
          ) : null}
        </div>

        {run.error ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {run.error instanceof ApiError ? run.error.messageAr : 'تعذّر تنفيذ العملية'}
          </p>
        ) : null}

        <div className="dialog__actions">
          <button
            type="button"
            className={`btn btn--${command === 'waste' ? 'danger' : 'primary'}`}
            disabled={!quantityValid || !reasonValid || run.isPending}
            onClick={() => run.mutate()}
          >
            {run.isPending ? 'جاري التنفيذ…' : COMMAND_LABELS[command]}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}

function MovementsDialog({
  auth,
  item,
  onClose,
}: {
  auth: PortalAuth;
  item: InventoryItem;
  onClose: () => void;
}) {
  const movements = useQuery({
    queryKey: ['inventory-movements', item.id],
    queryFn: () => portal.movements(auth, item.id),
  });

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="mv-title">
      <div className="dialog" style={{ maxWidth: 720 }}>
        <h2 id="mv-title">حركات {item.name_ar}</h2>

        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          كل وحدة في الرصيد لها حركة تفسّرها — لا تتغيّر الكمية بلا سجل.
        </p>

        {movements.isLoading ? <Skeleton height={220} /> : null}

        {movements.isError ? (
          <ErrorState
            message={
              movements.error instanceof ApiError
                ? movements.error.messageAr
                : 'تعذّر تحميل الحركات'
            }
            onRetry={() => void movements.refetch()}
          />
        ) : null}

        {movements.data ? <MovementsTable rows={movements.data} /> : null}

        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}

function MovementsTable({ rows }: { rows: InventoryMovement[] }) {
  if (rows.length === 0) return <p className="empty">لا توجد حركات مسجّلة</p>;

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">النوع</th>
            <th scope="col" className="numeric">
              التغيير
            </th>
            <th scope="col" className="numeric">
              الرصيد بعدها
            </th>
            <th scope="col">السبب</th>
            <th scope="col">بواسطة</th>
            <th scope="col">التاريخ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((movement) => {
            const isNegative = movement.quantity_delta.trim().startsWith('-');
            return (
              <tr key={movement.id}>
                <td>{MOVEMENT_LABELS[movement.type] ?? movement.type}</td>
                <td
                  className="numeric"
                  style={{
                    color: isNegative ? 'var(--jibli-danger-700)' : 'var(--jibli-success-700)',
                  }}
                >
                  {isNegative ? movement.quantity_delta : `+${movement.quantity_delta}`}
                </td>
                <td className="numeric">{movement.resulting_on_hand}</td>
                <td>{movement.reason ?? '—'}</td>
                <td>{movement.actor_name}</td>
                <td>
                  <span className="ltr-inline">
                    {new Date(movement.created_at).toLocaleString('ar-IQ', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NewItemDialog({
  auth,
  onDone,
  onCancel,
}: {
  auth: PortalAuth;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [nameAr, setNameAr] = useState('');
  const [sku, setSku] = useState('');
  const [unit, setUnit] = useState<InventoryUnit>('PIECE');
  const [opening, setOpening] = useState('0');
  const [threshold, setThreshold] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [allowNegative, setAllowNegative] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      portal.createInventoryItem(auth, {
        name_ar: nameAr.trim(),
        sku: sku.trim() || undefined,
        unit,
        opening_quantity: opening || '0',
        low_stock_threshold: threshold || undefined,
        unit_cost_iqd: unitCost ? Number(unitCost) : undefined,
        allow_negative_stock: allowNegative,
      }),
    onSuccess: onDone,
  });

  const quantityPattern = /^\d+(\.\d{1,3})?$/;
  const openingValid = quantityPattern.test(opening);
  const thresholdValid = threshold === '' || quantityPattern.test(threshold);

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="new-title">
      <div className="dialog">
        <h2 id="new-title">إضافة مادة للمخزون</h2>

        <div className="field">
          <label htmlFor="inv-name">اسم المادة</label>
          <input
            id="inv-name"
            value={nameAr}
            onChange={(event) => setNameAr(event.target.value)}
            placeholder="لحم مفروم"
          />
        </div>

        <div className="field">
          <label htmlFor="inv-unit">وحدة القياس</label>
          <select
            id="inv-unit"
            value={unit}
            onChange={(event) => setUnit(event.target.value as InventoryUnit)}
          >
            {INVENTORY_UNITS.map((value) => (
              <option key={value} value={value}>
                {UNIT_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="inv-sku">رمز المادة (اختياري)</label>
          <input id="inv-sku" value={sku} onChange={(event) => setSku(event.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="inv-opening">الرصيد الافتتاحي</label>
          <input
            id="inv-opening"
            inputMode="decimal"
            value={opening}
            onChange={(event) => setOpening(event.target.value)}
            aria-invalid={!openingValid}
          />
          <span className="field__hint">
            يُسجَّل كحركة «رصيد افتتاحي» حتى يبقى مصدر كل كمية معروفاً.
          </span>
        </div>

        <div className="field">
          <label htmlFor="inv-threshold">حد التنبيه (اختياري)</label>
          <input
            id="inv-threshold"
            inputMode="decimal"
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
            aria-invalid={!thresholdValid}
          />
          <span className="field__hint">
            يُقارَن بالمتاح للبيع لا بالموجود، لأن المحجوز لطلبات جارية لا يمكن بيعه مرة أخرى.
          </span>
        </div>

        <div className="field">
          <label htmlFor="inv-cost">سعر تكلفة الوحدة (اختياري)</label>
          <input
            id="inv-cost"
            type="number"
            min={0}
            step={250}
            value={unitCost}
            onChange={(event) => setUnitCost(event.target.value)}
          />
        </div>

        <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
          <input
            type="checkbox"
            checked={allowNegative}
            onChange={(event) => setAllowNegative(event.target.checked)}
          />
          <span>
            السماح برصيد سالب
            <span className="field__hint" style={{ display: 'block' }}>
              فعّلها فقط للمواد التي لا تُجرَد بدقة. الأصل أن يمنع النظام البيع بما لا يوجد.
            </span>
          </span>
        </label>

        {create.error ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {create.error instanceof ApiError ? create.error.messageAr : 'تعذّرت الإضافة'}
          </p>
        ) : null}

        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={
              nameAr.trim().length < 2 || !openingValid || !thresholdValid || create.isPending
            }
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
