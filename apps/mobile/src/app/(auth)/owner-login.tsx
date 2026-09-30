import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, NetworkError } from '@/lib/api';
import { judgeShopSignIn } from '@/lib/owner-sign-in';
import { useSession } from '@/lib/session';
import { PortalSignIn } from '@/ui/portal-sign-in';

/**
 * Sign-in for shop owners, in the app.
 *
 * **The same username and password the shop already uses on the portal.** There
 * is no second credential, no separate owner account and nothing to issue: this
 * is `POST /api/v1/auth/login`, the endpoint the browser posts to, called from
 * the phone with `client: 'mobile'`. A grocer who can sign into the portal can
 * sign in here, today, with what they already know.
 *
 * Why it exists at all, when the portal is a website a phone can open: a grocer
 * adding stock is standing in the shop with a box in one hand. The thing they
 * need is the camera, and the camera is in the app. That is the whole argument
 * — everything else about this screen is the same form the portal shows.
 *
 * **Decide first, switch second.** The screen used to store the new tokens,
 * clear the shop cache and send the owner to «متجري», which then asked which
 * shops the account held — a request racing the live-orders engine the new
 * session had just started, and which the cache clearing could cancel from
 * under it. When the answer was "no shop the phone serves", the owner had
 * already lost the account they were signed in as and was looking at the
 * screen that offers the login they had just used.
 *
 * Now the account's shop list is fetched with the token it was just issued,
 * while the old session still stands. Only an account with a shop the phone
 * can open becomes the session, and it arrives with that list already in the
 * cache, so «متجري» opens on the shop rather than on a skeleton.
 */
export default function OwnerLoginScreen() {
  const router = useRouter();
  const { signIn } = useSession();
  const queryClient = useQueryClient();

  return (
    <PortalSignIn
      title="دخول أصحاب المتاجر"
      subtitle="نفس اسم المستخدم وكلمة المرور اللذين تدخل بهما إلى لوحة التحكم."
      usernameExample="market.karrada"
      footnote="نسيت بياناتك؟ تواصل مع دعم جيبلي لإصدارها من جديد."
      onSubmit={async (username, password) => {
        try {
          const result = await api.passwordSignIn(username, password);

          /*
           * `RESTAURANT` is the portal every merchant account belongs to —
           * grocer and kitchen alike. Which of the two this is gets decided a
           * step later from `merchant_type`, not here: this screen only
           * establishes that the account belongs to a shop at all.
           */
          if (result.portal !== 'RESTAURANT') {
            return result.portal === 'DRIVER'
              ? 'هذا حساب مندوب وليس حساب متجر. ادخل من «دخول المندوبين».'
              : 'هذا الحساب لا يتبع متجراً. استخدم لوحة الإدارة على المتصفّح.';
          }

          /*
           * What the account owns, asked with its own token before this phone
           * becomes it. A refusal leaves whoever was signed in signed in, and
           * says — by name — why the shop cannot open here.
           */
          const shops = await api.ownerShops({ accessToken: result.access_token });
          const verdict = judgeShopSignIn(shops.restaurants);
          if (verdict.kind === 'refused') return verdict.message;

          /*
           * The previous account's Owner Mode, forgotten before the new
           * session exists — so nothing of it can be read for a frame, and so
           * nothing of the new account's is in flight yet to be cancelled.
           * The keys carry the user id, but a shared phone should not keep
           * the last owner's catalog in memory either way.
           */
          queryClient.removeQueries({ queryKey: ['owner-shops'] });
          queryClient.removeQueries({ queryKey: ['owner-catalog'] });
          queryClient.removeQueries({ queryKey: ['owner-orders'] });
          queryClient.removeQueries({ queryKey: ['owner-selected-shop'] });

          /*
           * The list, already known, under the key the new session will read
           * it by. «متجري» and the live-orders engine then start from the shop
           * instead of from a request — and cannot disagree about it.
           */
          queryClient.setQueryData(['owner-shops', result.user.id], shops);

          await signIn({
            accessToken: result.access_token,
            refreshToken: result.refresh_token,
            userId: result.user.id,
          });

          router.replace('/(owner)');
          return null;
        } catch (caught) {
          if (caught instanceof ApiError) return caught.messageAr;
          if (caught instanceof NetworkError) return 'تعذّر الاتصال. تحقّق من الإنترنت.';
          return 'تعذّر تسجيل الدخول، حاول مرة أخرى';
        }
      }}
    />
  );
}
