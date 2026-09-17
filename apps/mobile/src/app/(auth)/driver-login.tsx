import { useRouter } from 'expo-router';
import { api, ApiError, NetworkError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { PortalSignIn } from '@/ui/portal-sign-in';

/**
 * Sign-in for couriers, in the app.
 *
 * The portal has the same form, and this is not a duplicate of it for the
 * usual reason a second one gets written: a courier works from a phone. They
 * are outside, one-handed, and the thing they need on arrival is the map
 * button and the buttons for «استلمت» and «سلّمت» — which are in the app,
 * beside the phone's own maps and its own keypad.
 *
 * A username and a password rather than an OTP, because the account is created
 * by the restaurant that hired them and the handset a delivery runs on is
 * often shared: a code sent to that number reaches whoever is holding it.
 *
 * The form itself is `PortalSignIn`, shared with the owner's door.
 */
export default function DriverLoginScreen() {
  const router = useRouter();
  const { signIn } = useSession();

  return (
    <PortalSignIn
      title="دخول المندوبين"
      subtitle="اسم المستخدم وكلمة المرور من المطعم الذي تعمل معه."
      footnote="نسيت بياناتك؟ اطلب من المطعم إصدارها من جديد."
      onSubmit={async (username, password) => {
        try {
          const result = await api.passwordSignIn(username, password);

          /*
           * A shop or platform account signing in here would get a session the
           * courier screens cannot use. It is not a failure, though — it is
           * the wrong door, and the right one is named.
           */
          if (result.portal !== 'DRIVER') {
            return result.portal === 'RESTAURANT'
              ? 'هذا حساب متجر وليس حساب مندوب. ادخل من «دخول أصحاب المتاجر».'
              : 'هذا الحساب ليس حساب مندوب. استخدم لوحة التحكم على المتصفّح.';
          }

          await signIn({
            accessToken: result.access_token,
            refreshToken: result.refresh_token,
            userId: result.user.id,
          });

          router.replace('/(driver)/delivery');
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
