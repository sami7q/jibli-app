import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, NetworkError } from '@/lib/api';
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
 * The app refused these accounts until now, with a sentence sending them to a
 * browser. That sentence was the feature request.
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

          await signIn({
            accessToken: result.access_token,
            refreshToken: result.refresh_token,
            userId: result.user.id,
          });

          /*
           * The shop list is keyed per session, and a previous owner's list
           * must not survive into this one on a shared phone.
           */
          // Every account's list, not only this one's: the previous
          // account's must be gone before «متجري» renders again.
          queryClient.removeQueries({ queryKey: ['owner-shops'] });
          queryClient.removeQueries({ queryKey: ['owner-catalog'] });
          queryClient.removeQueries({ queryKey: ['owner-orders'] });

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
