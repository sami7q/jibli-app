/**
 * Arabic labels for support threads.
 *
 * Here rather than beside the screen that uses them most, because a `page.tsx`
 * in the App Router may only export the page itself — Next refuses the build
 * over any other named export, and a constant shared between the list and the
 * detail view has to live somewhere that is not a route.
 */

export const TOPIC_LABELS: Record<string, string> = {
  ORDERS: 'الطلبات',
  MENU: 'المنيو',
  FINANCE: 'المالية',
  ACCOUNT: 'الحساب',
  TECHNICAL: 'مشكلة تقنية',
  OTHER: 'أخرى',
};

/**
 * Written from Jibli's side: "waiting for our reply" is the state that decides
 * whether an operator has work to do.
 */
export const THREAD_STATUS_LABELS: Record<string, string> = {
  OPEN: 'بانتظار ردّنا',
  ANSWERED: 'بانتظار المطعم',
  RESOLVED: 'منتهية',
};
