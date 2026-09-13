/**
 * Arabic labels for support threads, from the restaurant's side.
 *
 * Here rather than beside the screen that uses them most, because a `page.tsx`
 * in the App Router may only export the page itself — Next refuses the build
 * over any other named export, and a constant shared between the list and the
 * detail view has to live somewhere that is not a route.
 */

export const TOPICS = [
  { key: 'ORDERS', labelAr: 'الطلبات', hint: 'طلب متأخر، إلغاء، مشكلة مع عميل' },
  { key: 'MENU', labelAr: 'المنيو', hint: 'أصناف، أسعار، صور' },
  { key: 'FINANCE', labelAr: 'المالية', hint: 'عمولة، كشف، تسوية' },
  { key: 'ACCOUNT', labelAr: 'الحساب', hint: 'دخول، صلاحيات، موظفون' },
  { key: 'TECHNICAL', labelAr: 'مشكلة تقنية', hint: 'شيء لا يعمل كما يجب' },
  { key: 'OTHER', labelAr: 'أخرى', hint: '' },
] as const;

/**
 * The same three states the Admin portal shows, worded from the other side:
 * what the restaurant needs to know is whether a reply has arrived.
 */
export const THREAD_STATUS_LABELS: Record<string, string> = {
  OPEN: 'بانتظار ردّ جيبلي',
  ANSWERED: 'وصلك ردّ',
  RESOLVED: 'منتهية',
};
