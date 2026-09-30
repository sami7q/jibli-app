import type { OwnerShop } from './api';
import { isShopSupported } from './owner-vertical';

/**
 * What a shop's sign-in means for Owner Mode — decided before the phone's
 * session moves to the new account.
 *
 * The sign-in screen used to store the tokens first and find out second: it
 * switched the session, cleared the shop cache, and only then did «متجري» ask
 * which shops the account held — a request racing the live-orders engine the
 * new session had just started. When the answer was "a restaurant", the owner
 * had already lost the account they were signed in as, and was standing on
 * the screen that offers the login they had just used.
 *
 * Now the list is asked for with the new account's own token while the old
 * session still stands, and this decides: open the shop, or say why not and
 * leave the session alone. Pure, so the sentences can be pinned by a test.
 */
export type ShopSignInVerdict =
  | { readonly kind: 'open'; readonly shop: OwnerShop }
  | { readonly kind: 'refused'; readonly message: string };

export function judgeShopSignIn(shops: readonly OwnerShop[]): ShopSignInVerdict {
  const usable = shops.filter(isShopSupported);
  if (usable[0]) return { kind: 'open', shop: usable[0] };

  if (shops.length === 0) {
    return {
      kind: 'refused',
      message: 'هذا الحساب لا يتبع أي متجر. تواصل مع دعم جيبلي إن كان يفترض أن يملك واحداً.',
    };
  }

  /*
   * Every shop on the account is a restaurant, and the app does not serve
   * those on purpose (see `owner-vertical.ts`). Named, because the commonest
   * way to get here is a market that was filed as a restaurant by mistake —
   * and the fix for that is one field in Admin, not a new account.
   */
  const names = shops.map((shop) => `«${shop.display_name}»`).join(' و');
  const filed = shops.length === 1 ? 'مسجّل في جيبلي كمطعم' : 'مسجّلة في جيبلي كمطاعم';
  return {
    kind: 'refused',
    message:
      `${names} ${filed}، وقوائم المطاعم تُدار من لوحة التحكم على المتصفّح. ` +
      'إن كان ماركت أو متجر تجميل فنوعه مسجّل خطأً: يصحّحه فريق جيبلي من لوحة الإدارة ' +
      '(صفحة المتجر ← نوع الشريك)، ثم يفتح هنا بنفس اسم المستخدم وكلمة المرور.',
  };
}
