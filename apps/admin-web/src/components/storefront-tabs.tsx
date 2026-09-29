'use client';

import { MERCHANT_TYPES, MERCHANT_TYPE_LABELS, type MerchantType } from '@jibli/contracts';

/**
 * Which storefront a merchandising screen is working on.
 *
 * Categories and banners belong to one half of the app each. The column that
 * says which shipped with the market vertical, the customer app filters on it,
 * and these two screens never offered the choice — so every category and every
 * banner an operator could create landed in the restaurant half, and the
 * market half could only ever hold what a migration had put there. The tab is
 * small; the thing it fixes is that one of the two storefronts was
 * unmerchandisable.
 *
 * Buttons rather than a select: there are three, they all fit on a line,
 * and a closed dropdown hides the fact that a choice exists at all — which is
 * the failure this is here to end.
 */
export function StorefrontTabs({
  value,
  onChange,
}: {
  value: MerchantType;
  onChange: (next: MerchantType) => void;
}) {
  return (
    <div
      className="storefront-tabs"
      role="tablist"
      aria-label="اختر واجهة المتجر"
      style={{ display: 'flex', gap: 'var(--space-2)' }}
    >
      {MERCHANT_TYPES.map((type) => {
        const active = value === type;
        return (
          <button
            key={type}
            type="button"
            role="tab"
            aria-selected={active}
            className={`btn btn--sm ${active ? 'btn--primary' : 'btn--outline'}`}
            onClick={() => onChange(type)}
          >
            {STOREFRONT_LABELS[type]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Plural, and about the storefront rather than the merchant.
 *
 * `MERCHANT_TYPE_LABELS` says «مطعم» — the right word for one partner and the
 * wrong one for the half of the app it appears in, which is what this control
 * switches between.
 */
const STOREFRONT_LABELS: Record<MerchantType, string> = {
  RESTAURANT: 'المطاعم',
  MARKET: 'الماركتات',
  COSMETICS: 'التجميل',
};

/** The words a merchandising screen changes with the storefront it is showing. */
export const STOREFRONT_COPY: Record<
  MerchantType,
  {
    /** «٣ مطاعم» / «٣ ماركتات» — what the count on a category row counts. */
    readonly countedAr: string;
    readonly noneYetAr: string;
    readonly defaultEmoji: string;
    readonly nameAr: string;
  }
> = {
  RESTAURANT: {
    countedAr: 'مطعم',
    noneYetAr: 'لا مطاعم بعد',
    defaultEmoji: '🍽️',
    nameAr: MERCHANT_TYPE_LABELS.RESTAURANT.nameAr,
  },
  MARKET: {
    countedAr: 'ماركت',
    noneYetAr: 'لا ماركتات بعد',
    defaultEmoji: '🛒',
    nameAr: MERCHANT_TYPE_LABELS.MARKET.nameAr,
  },
  COSMETICS: {
    countedAr: 'متجر تجميل',
    noneYetAr: 'لا متاجر تجميل بعد',
    defaultEmoji: '💄',
    nameAr: MERCHANT_TYPE_LABELS.COSMETICS.nameAr,
  },
};
