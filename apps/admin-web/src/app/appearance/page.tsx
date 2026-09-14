'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dateAr, LogoUpload } from '@jibli/ui-web';
import { AdminShell } from '@/components/shell';
import { Badge, Card, ConfirmDialog, ErrorState, Skeleton } from '@/components/ui';
import { Dropdown } from '@/components/dropdown';
import { Icon } from '@/components/icon';
import { ApiError, adminApi } from '@/lib/api';
import { admin, type AppBanner, type AppCategory } from '@/lib/admin-endpoints';
import { SessionGate } from '@/components/session-gate';
import { useAdminSession } from '@/hooks/use-session';

/**
 * What the customer opens the app to.
 *
 * Banners across the top, categories under them, and how fast the banners
 * rotate. All three used to be decisions frozen into a release; they are
 * merchandising, and merchandising that needs a deploy does not happen.
 *
 * The preview is the point of this screen. A banner list is a table of rows
 * that says nothing about whether the picture works at phone width with Arabic
 * over it — so the phone is here, rotating at the real interval, showing the
 * real order.
 */
export default function AppearancePage() {
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AppBanner | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<AppBanner | null>(null);

  const token = session.status === 'authenticated' ? session.accessToken : '';

  const banners = useQuery({
    queryKey: ['admin-banners'],
    queryFn: () => admin.banners(token),
    enabled: session.status === 'authenticated',
  });

  const categories = useQuery({
    queryKey: ['admin-categories'],
    queryFn: () => admin.categories(token),
    enabled: session.status === 'authenticated',
  });

  const config = useQuery({
    queryKey: ['admin-config'],
    queryFn: () => admin.config(token),
    enabled: session.status === 'authenticated',
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-banners'] });
  };

  const reorder = useMutation({
    mutationFn: (ids: string[]) => admin.reorderBanners(token, ids),
    onSuccess: invalidate,
  });

  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      admin.updateBanner(token, id, { is_active: isActive }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => admin.deleteBanner(token, id),
    onSuccess: () => {
      setDeleting(null);
      invalidate();
    },
  });

  const rotation = useMutation({
    mutationFn: (seconds: number) =>
      admin.updateConfig(token, 'banner_rotation_seconds', seconds),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-config'] });
    },
  });

  if (session.status !== 'authenticated') {
    return <SessionGate session={session} />;
  }

  const rows = banners.data ?? [];
  const seconds = Number(
    config.data?.find((entry) => entry.key === 'banner_rotation_seconds')?.value ?? 5,
  );

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
      title="شكل التطبيق"
      subtitle="البنرات وترتيب التصنيفات كما يراها العميل"
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
      actions={
        <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
          بنر جديد
        </button>
      }
    >
      <div className="appearance">
        <div className="appearance__main">
          <Card
            title="البنرات"
            icon="coupons"
            subtitle="تظهر أعلى الشاشة الرئيسية بالترتيب أدناه"
          >
            {banners.isError ? (
              <ErrorState
                message={
                  banners.error instanceof ApiError ? banners.error.messageAr : 'تعذّر تحميل البنرات'
                }
                onRetry={() => void banners.refetch()}
              />
            ) : banners.isLoading ? (
              <Skeleton height={220} />
            ) : rows.length === 0 ? (
              <div className="empty">
                <p style={{ margin: 0, fontWeight: 600 }}>لا توجد بنرات</p>
                <p style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
                  البنر مساحة إعلانية أعلى التطبيق — عرض، مطعم جديد، أو تصنيف تريد إبرازه.
                </p>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => setCreating(true)}
                  style={{ marginBlockStart: 'var(--space-3)' }}
                >
                  أضف أول بنر
                </button>
              </div>
            ) : (
              <ul className="cats">
                {rows.map((banner, index) => (
                  <li key={banner.id} className={`cat${banner.is_active ? '' : ' cat--off'}`}>
                    <div className="cat__order">
                      <button
                        type="button"
                        className="cat__move"
                        disabled={index === 0 || reorder.isPending}
                        onClick={() => move(index, -1)}
                        aria-label={`تحريك ${banner.title_ar} للأعلى`}
                      >
                        <Icon
                          name="chevron"
                          className="cat__move-icon cat__move-icon--up"
                          aria-hidden
                        />
                      </button>
                      <span className="cat__position">{index + 1}</span>
                      <button
                        type="button"
                        className="cat__move"
                        disabled={index === rows.length - 1 || reorder.isPending}
                        onClick={() => move(index, 1)}
                        aria-label={`تحريك ${banner.title_ar} للأسفل`}
                      >
                        <Icon name="chevron" className="cat__move-icon" aria-hidden />
                      </button>
                    </div>

                    <div className="banner__thumb" aria-hidden>
                      {banner.image_asset_id ? (
                        <img src={adminApi.assetUrl(banner.image_asset_id)} alt="" />
                      ) : (
                        <Icon name="coupons" className="nav__icon" aria-hidden />
                      )}
                    </div>

                    <div className="cat__body">
                      <strong>{banner.title_ar}</strong>
                      {banner.subtitle_ar ? (
                        <span className="cat__key">{banner.subtitle_ar}</span>
                      ) : null}
                      <span className="cat__key">{describeLink(banner)}</span>
                    </div>

                    <div className="cat__state">
                      {/*
                        Live and active are different: a scheduled banner is
                        active and invisible, and the operator needs to see
                        which of the two it is.
                      */}
                      {!banner.is_active ? (
                        <Badge tone="neutral">موقوف</Badge>
                      ) : banner.is_live ? (
                        <Badge tone="success">ظاهر الآن</Badge>
                      ) : (
                        <Badge tone="warning">خارج الفترة</Badge>
                      )}
                      {banner.starts_at || banner.ends_at ? (
                        <div className="banner__window">
                          {banner.starts_at ? dateAr(banner.starts_at) : '…'} —{' '}
                          {banner.ends_at ? dateAr(banner.ends_at) : '…'}
                        </div>
                      ) : null}
                    </div>

                    <div className="cat__actions">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => setEditing(banner)}
                      >
                        تعديل
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={setActive.isPending}
                        onClick={() =>
                          setActive.mutate({ id: banner.id, isActive: !banner.is_active })
                        }
                      >
                        {banner.is_active ? 'إيقاف' : 'تشغيل'}
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => setDeleting(banner)}
                      >
                        حذف
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="حركة البنرات" icon="settings">
            <div className="field" style={{ maxInlineSize: '22rem' }}>
              <label htmlFor="rotation">مدة عرض كل بنر</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <input
                  id="rotation"
                  type="range"
                  min={2}
                  max={20}
                  step={1}
                  value={seconds}
                  onChange={(event) => rotation.mutate(Number(event.target.value))}
                  style={{ flex: 1 }}
                />
                <strong style={{ minInlineSize: '4.5rem' }}>{seconds} ثانية</strong>
              </div>
              <span className="field__hint">
                ينتقل التطبيق تلقائياً للبنر التالي بعد هذه المدة. المعاينة على اليسار تتحرك
                بالسرعة نفسها.
              </span>
            </div>
          </Card>

          <Card
            title="ترتيب التصنيفات"
            icon="categories"
            subtitle="الشريط الذي يظهر تحت البنرات"
            actions={
              <Link className="btn btn--outline btn--sm" href="/categories">
                تعديل التصنيفات
              </Link>
            }
          >
            {categories.isLoading ? (
              <Skeleton height={80} />
            ) : (
              <>
                <div className="cat-strip">
                  {(categories.data ?? [])
                    .filter((category) => category.is_active)
                    .map((category) => (
                      <span key={category.id} className="cat-chip">
                        <span className="cat-chip__face">
                          {category.image_asset_id ? (
                            <img src={adminApi.assetUrl(category.image_asset_id)} alt="" />
                          ) : (
                            <span aria-hidden>{category.emoji ?? '🍽️'}</span>
                          )}
                        </span>
                        {category.name_ar}
                      </span>
                    ))}
                </div>
                <p className="cats__note">
                  هذا هو الترتيب الحالي في التطبيق. لتغييره أو لإضافة تصنيف، افتح{' '}
                  <Link href="/categories">صفحة التصنيفات</Link>.
                </p>
              </>
            )}
          </Card>
        </div>

        <div className="appearance__side">
          <PhonePreview
            banners={rows.filter((banner) => banner.is_live)}
            categories={(categories.data ?? []).filter((category) => category.is_active)}
            seconds={seconds}
          />
        </div>
      </div>

      {creating ? (
        <BannerDialog
          token={token}
          categories={categories.data ?? []}
          onDone={() => {
            setCreating(false);
            invalidate();
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      {editing ? (
        <BannerDialog
          token={token}
          banner={editing}
          categories={categories.data ?? []}
          onDone={() => {
            setEditing(null);
            invalidate();
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={`حذف ${deleting.title_ar}`}
          confirmLabel="حذف البنر"
          isSubmitting={remove.isPending}
          error={remove.error instanceof ApiError ? remove.error.messageAr : null}
          body={
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
              يختفي البنر من التطبيق فوراً ولا يمكن استرجاعه. إن كنت تريد إخفاءه مؤقتاً فقط،
              استخدم «إيقاف» بدلاً من الحذف.
            </p>
          }
          onConfirm={() => remove.mutate(deleting.id)}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </AdminShell>
  );
}

function describeLink(banner: AppBanner): string {
  switch (banner.link_type) {
    case 'CATEGORY':
      return `يفتح تصنيف: ${banner.link_value}`;
    case 'RESTAURANT':
      return 'يفتح صفحة مطعم';
    case 'URL':
      return `رابط: ${banner.link_value}`;
    default:
      return 'بدون وجهة';
  }
}

/**
 * The app, roughly, at phone width.
 *
 * Rotating at the configured interval rather than a fixed one, because the
 * whole reason the interval is a setting is that five seconds and eight feel
 * different and nobody can tell which they want from a number.
 */
function PhonePreview({
  banners,
  categories,
  seconds,
}: {
  banners: AppBanner[];
  categories: AppCategory[];
  seconds: number;
}) {
  const [index, setIndex] = useState(0);

  /*
   * One effect, restarted whenever the set or the interval changes. The
   * dependency is the id list rather than the array, because a refetch hands
   * back a new array of the same banners and restarting the rotation on every
   * background refetch would make the preview stutter.
   */
  const ids = banners.map((banner) => banner.id).join(',');

  useEffect(() => {
    setIndex(0);
    if (banners.length < 2) return;

    const timer = window.setInterval(
      () => setIndex((current) => (current + 1) % banners.length),
      Math.max(2, seconds) * 1000,
    );
    return () => window.clearInterval(timer);
  }, [ids, seconds, banners.length]);

  const current = banners[index];

  return (
    <Card title="المعاينة" icon="live" subtitle="كما تظهر في التطبيق">
      <div className="phone">
        {/* The rail buttons. Pure decoration, and the cheapest signal that this
            is a device and not a browser panel. */}
        <span className="phone__key phone__key--silent" aria-hidden />
        <span className="phone__key phone__key--up" aria-hidden />
        <span className="phone__key phone__key--down" aria-hidden />
        <span className="phone__key phone__key--power" aria-hidden />

        <div className="phone__screen">
          {/*
            The status bar belongs to the operating system, not to Jibli — but
            leaving it out is what made this read as a web panel with rounded
            corners. 9:41 is the convention every device mockup uses.
          */}
          <div className="phone__status" aria-hidden>
            <span className="phone__clock">9:41</span>
            <span className="phone__island" />
            <svg className="phone__signal" viewBox="0 0 44 12" fill="currentColor">
              <rect x="0" y="7" width="3" height="5" rx="1" />
              <rect x="5" y="5" width="3" height="7" rx="1" />
              <rect x="10" y="3" width="3" height="9" rx="1" />
              <rect x="15" y="1" width="3" height="11" rx="1" />
              <path d="M23 4.4a7 7 0 0 1 8 0l-1.2 1.5a5 5 0 0 0-5.6 0Zm2 2.6a3.4 3.4 0 0 1 4 0L27 10Z" />
              <rect x="34" y="2" width="8" height="8" rx="2" opacity="0.45" />
              <rect x="34" y="2" width="6" height="8" rx="2" />
            </svg>
          </div>

          <div className="phone__app">
            {/*
              Header and search, because the banner does not sit at the top of
              the screen in the app — it sits under them, and a preview that
              puts it first is showing a layout nobody will see.
            */}
            <div className="phone__header" aria-hidden>
              <span className="phone__area">
                بغداد
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="phone__logo">جيبلي</span>
            </div>

            <div className="phone__search" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" strokeLinecap="round" />
              </svg>
              ابحث عن مطعم أو وجبة…
            </div>

            {/* Edge to edge and square-cornered, exactly as `PromoBanner
                fullBleed` draws it on the device. */}
            <div className="phone__banner">
              {current ? (
                current.image_asset_id ? (
                  /*
                   * Artwork only, exactly as the app draws it.
                   *
                   * The title and subtitle are still stored and still edited
                   * above — they name the banner in this list and are what a
                   * screen reader announces — but an uploaded banner already
                   * carries its own headline in its own typography, and
                   * printing the stored one over it gives the customer two.
                   * A preview that shows text the device will not draw is a
                   * preview lying about the one thing it is for.
                   */
                  <img src={adminApi.assetUrl(current.image_asset_id)} alt="" />
                ) : (
                  <>
                    <div className="phone__banner-fallback" aria-hidden />
                    <div className="phone__banner-text">
                      <strong>{current.title_ar}</strong>
                      {current.subtitle_ar ? <span>{current.subtitle_ar}</span> : null}
                    </div>
                  </>
                )
              ) : (
                <div className="phone__banner-empty">لا بنرات ظاهرة الآن</div>
              )}
            </div>

            {banners.length > 1 ? (
              <div className="phone__dots" aria-hidden>
                {banners.map((banner, dot) => (
                  <span key={banner.id} className={dot === index ? 'is-on' : undefined} />
                ))}
              </div>
            ) : null}

            <div className="phone__cats">
              {categories.slice(0, 8).map((category) => (
                <span key={category.id} className="phone__cat">
                  <span className="phone__cat-face">
                    {category.image_asset_id ? (
                      <img src={adminApi.assetUrl(category.image_asset_id)} alt="" />
                    ) : (
                      <span aria-hidden>{category.emoji ?? '🍽️'}</span>
                    )}
                  </span>
                  <span className="phone__cat-name">{category.name_ar}</span>
                </span>
              ))}
            </div>

            {/* Stand-ins for the restaurant cards. They exist so the banner is
                judged against content below it, the way it will be. */}
            <div className="phone__skeleton" aria-hidden>
              <span />
              <span />
              <span />
            </div>
          </div>

          <div className="phone__tabs" aria-hidden>
            {['الرئيسية', 'المفضلة', 'طلباتي', 'حسابي'].map((tab, position) => (
              <span key={tab} className={position === 0 ? 'is-on' : undefined}>
                {tab}
              </span>
            ))}
          </div>

          <span className="phone__home" aria-hidden />
        </div>
      </div>
    </Card>
  );
}

function BannerDialog({
  token,
  banner,
  categories,
  onDone,
  onCancel,
}: {
  token: string;
  banner?: AppBanner;
  categories: AppCategory[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const isNew = banner === undefined;
  const [title, setTitle] = useState(banner?.title_ar ?? '');
  const [subtitle, setSubtitle] = useState(banner?.subtitle_ar ?? '');
  const [linkType, setLinkType] = useState<AppBanner['link_type']>(banner?.link_type ?? 'NONE');
  const [linkValue, setLinkValue] = useState(banner?.link_value ?? '');
  const [assetId, setAssetId] = useState<string | null>(banner?.image_asset_id ?? null);
  const [preview, setPreview] = useState<string | null>(
    banner?.image_asset_id ? adminApi.assetUrl(banner.image_asset_id) : null,
  );
  const [startsAt, setStartsAt] = useState(banner?.starts_at?.slice(0, 10) ?? '');
  const [endsAt, setEndsAt] = useState(banner?.ends_at?.slice(0, 10) ?? '');

  const save = useMutation({
    mutationFn: async (): Promise<void> => {
      const body = {
        title_ar: title.trim(),
        subtitle_ar: subtitle.trim() || null,
        image_asset_id: assetId,
        link_type: linkType,
        link_value: linkType === 'NONE' ? null : linkValue.trim() || null,
        starts_at: startsAt ? new Date(`${startsAt}T00:00:00Z`).toISOString() : null,
        ends_at: endsAt ? new Date(`${endsAt}T23:59:59Z`).toISOString() : null,
      };

      if (isNew) {
        await admin.createBanner(token, body);
        return;
      }
      await admin.updateBanner(token, banner.id, body);
    },
    onSuccess: onDone,
  });

  const linkNeeded = linkType !== 'NONE';
  const canSave =
    title.trim().length > 0 && (!linkNeeded || linkValue.trim().length > 0) && !save.isPending;

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="banner-title">
      <div className="dialog">
        <h2 id="banner-title">{isNew ? 'بنر جديد' : `تعديل ${banner.title_ar}`}</h2>

        <LogoUpload
          value={preview}
          label="صورة البنر"
          hint="الأفضل صورة عريضة (مثلاً ١٢٠٠×٦٠٠). PNG أو JPG أو WebP حتى ٥ ميغابايت."
          upload={(dataUrl) =>
            adminApi.uploadImage(token, { data: dataUrl, purpose: 'RESTAURANT_COVER' })
          }
          onChange={(uploadedId, previewUrl) => {
            setAssetId(uploadedId);
            setPreview(previewUrl);
          }}
        />

        <div className="field">
          <label htmlFor="banner-title-input">اسم البنر</label>
          <input
            id="banner-title-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="خصم ٢٠٪ على المشاوي"
            maxLength={80}
          />
          {/*
            Renamed from «العنوان», which promised something the app no longer
            does. With artwork uploaded the customer sees the image and nothing
            else — the picture already carries its own headline — so this text
            names the row here, and is what a screen reader announces. It is
            drawn to the customer only for a banner with no image at all.
          */}
          <span className="field__hint">
            للتعريف داخل اللوحة. لا يظهر فوق الصورة للعميل — الصورة وحدها ما يراه.
          </span>
        </div>

        <div className="field">
          <label htmlFor="banner-subtitle">سطر ثانٍ (اختياري)</label>
          <input
            id="banner-subtitle"
            value={subtitle}
            onChange={(event) => setSubtitle(event.target.value)}
            placeholder="حتى نهاية الأسبوع"
            maxLength={140}
          />
          <span className="field__hint">
            يظهر للعميل فقط إذا كان البنر بلا صورة.
          </span>
        </div>

        <Dropdown
          value={linkType}
          onChange={(value) => {
            setLinkType((value || 'NONE') as AppBanner['link_type']);
            setLinkValue('');
          }}
          label="عند الضغط على البنر"
          options={[
            { value: 'NONE', label: 'لا شيء — صورة فقط' },
            { value: 'CATEGORY', label: 'يفتح تصنيفاً' },
            { value: 'RESTAURANT', label: 'يفتح مطعماً' },
            { value: 'URL', label: 'يفتح رابطاً' },
          ]}
        />

        {linkType === 'CATEGORY' ? (
          <Dropdown
            value={linkValue}
            onChange={(value) => setLinkValue(value)}
            label="التصنيف"
            placeholder="اختر تصنيفاً"
            options={categories.map((category) => ({
              value: category.key,
              label: category.name_ar,
              note: `${category.restaurant_count} مطعم`,
            }))}
          />
        ) : linkType !== 'NONE' ? (
          <div className="field">
            <label htmlFor="banner-link">{linkType === 'URL' ? 'الرابط' : 'معرّف المطعم'}</label>
            <input
              id="banner-link"
              dir="ltr"
              value={linkValue}
              onChange={(event) => setLinkValue(event.target.value)}
              placeholder={linkType === 'URL' ? 'https://…' : '01a09802-…'}
            />
          </div>
        ) : null}

        <div className="form-grid form-grid--pair">
          <div className="field">
            <label htmlFor="banner-from">يبدأ (اختياري)</label>
            <input
              id="banner-from"
              type="date"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="banner-to">ينتهي (اختياري)</label>
            <input
              id="banner-to"
              type="date"
              value={endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
            />
          </div>
        </div>

        <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          اتركهما فارغين ليظهر البنر دائماً. البنر المجدول يختفي من التطبيق تلقائياً خارج فترته
          دون أن تحتاج لإيقافه يدوياً.
        </p>

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
