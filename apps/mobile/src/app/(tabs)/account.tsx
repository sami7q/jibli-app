import { useState } from 'react';
import { Linking, View } from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { api, ApiError } from '@/lib/api';
import { useArea } from '@/lib/area';
import { useIsGuest, useSession } from '@/lib/session';
import { confirmAsync, notify } from '@/lib/dialog';
import { ALIGN_START, ROW, accent, color, radius, shadow, space } from '@/theme';
import { Button, Ltr, Row, Screen, Text } from '@/ui';
import { AreaPicker } from '@/ui/area-picker';
import { ListRow, RTL_TEXT, Sheet } from '@/ui/catalog';

/**
 * Account (`9.html`).
 *
 * The comp lists eight rows; this ships the ones that do something. «طرق
 * الدفع» is not here because there is one method and it is cash — a row that
 * opens a screen saying "cash" is a row that wastes a tap.
 *
 * Three rows are here because App Review will look for them: the privacy
 * policy (5.1.1), a way to reach a human (1.5), and account deletion — 5.1.1(v),
 * the most common rejection for a delivery app, and one that has to work from
 * inside the app rather than by emailing support.
 */
export default function AccountScreen() {
  const router = useRouter();
  const { state, signOut } = useSession();
  const isGuest = useIsGuest();
  /** Whether this account already carries the courier mode. */
  const isDriver =
    (state.status === 'ready' || state.status === 'needs-profile') &&
    state.me.modes.includes('DRIVER');
  const { area } = useArea();

  const [pickingArea, setPickingArea] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const me = state.status === 'ready' || state.status === 'needs-profile' ? state.me : null;
  const extra = Constants.expoConfig?.extra as
    { supportPhone?: string; privacyPolicyUrl?: string; termsUrl?: string } | undefined;

  const open = (url: string) => {
    void Linking.openURL(url).catch(() =>
      notify('تعذّر الفتح', 'لم نتمكن من فتح الرابط على هذا الجهاز.'),
    );
  };

  return (
    <Screen scroll edges={['top']} padded={false}>
      <View style={{ padding: space[4], gap: space[4] }}>
        {/*
         * `RTL_TEXT` is physical alignment, so it holds whichever way the
         * native layout flag happens to be set. It used to be this screen's
         * private exception — for one release the account page was the only
         * right-to-left screen in the app — and it stays now for the narrower
         * reason it was always good for: it states the edge rather than
         * leaving it to the bidi algorithm.
         */}
        <Text variant="h2" style={RTL_TEXT}>
          حسابي
        </Text>

        {isGuest ? (
          <View
            style={{
              padding: space[4],
              borderRadius: radius.lg,
              backgroundColor: color.brandSoft,
              borderWidth: 1,
              borderColor: accent[200],
              gap: space[2],
              alignItems: ALIGN_START,
            }}
          >
            <Text variant="bodyBold" tone="brand" style={RTL_TEXT}>
              تتصفّح كضيف
            </Text>
            <Text variant="small" tone="secondary" style={RTL_TEXT}>
              سجّل دخولك لحفظ عناوينك، متابعة طلباتك، وحفظ مطاعمك المفضّلة.
            </Text>
            <Button label="تسجيل الدخول" onPress={() => router.push('/(auth)/phone')} />
          </View>
        ) : (
          /*
           * Who you are, on the brand.
           *
           * It was an initial tile beside two grey lines, indistinguishable
           * from the settings rows beneath it — the person's own name was the
           * least prominent thing on their own account screen. A filled card
           * gives the top of the page something to be, and the rows below it
           * something to sit under.
           */
          <View
            style={{
              flexDirection: ROW,
              alignItems: 'center',
              gap: space[4],
              padding: space[4],
              borderRadius: radius.xl,
              backgroundColor: color.brand,
              ...shadow.md,
            }}
          >
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: radius.full,
                backgroundColor: 'rgba(255,255,255,0.22)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text variant="h1" tone="inverse">
                {(me?.full_name ?? 'ج').slice(0, 1)}
              </Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="h3" tone="inverse" numberOfLines={1} style={RTL_TEXT}>
                {me?.full_name ?? 'مستخدم جيبلي'}
              </Text>
              <Text variant="caption" tone="inverse" style={[RTL_TEXT, { opacity: 0.9 }]}>
                {area ? `${area.governorateNameAr} — ${area.cityNameAr}` : 'لم تُحدَّد المنطقة'}
              </Text>
              {state.status === 'offline-ready' ? (
                <Text variant="caption" tone="inverse" style={[RTL_TEXT, { opacity: 0.9 }]}>
                  أنت غير متصل — بعض البيانات قد تكون قديمة.
                </Text>
              ) : null}
            </View>
          </View>
        )}
      </View>

      <Group title="حسابي">
        <ListRow
          label="منطقة التوصيل"
          sublabel={area?.cityNameAr ?? 'اختر منطقتك'}
          icon={<MaterialCommunityIcons name="map-marker-outline" size={20} color={color.brand} />}
          onPress={() => setPickingArea(true)}
        />
        <ListRow
          label="المفضلة"
          icon={<MaterialCommunityIcons name="heart-outline" size={20} color={color.brand} />}
          onPress={() => router.push('/(tabs)/favorites')}
        />
        <ListRow
          label="طلباتي"
          icon={
            <MaterialCommunityIcons name="clipboard-list-outline" size={20} color={color.brand} />
          }
          onPress={() => router.push('/(tabs)/orders')}
        />
      </Group>

      {/*
       * The other door into the platform.
       *
       * A driver account could only be created from inside a restaurant's
       * portal, so anyone who wanted to deliver had to already know an owner.
       * It sits on the customer's account screen because that is the only
       * screen a prospective driver has — they arrive as a customer.
       */}
      <Group title="العمل مع جيبلي">
        <ListRow
          label="الانضمام كمندوب توصيل"
          sublabel="وصّل الطلبات واكسب معنا"
          icon={<MaterialCommunityIcons name="motorbike" size={20} color={color.brand} />}
          /*
           * Shown to a guest too. Somebody who wants to deliver arrives as a
           * browsing customer, and hiding the row until they sign in means they
           * never find out the door exists. The screen itself asks for the
           * account, which is the right place: it can explain why.
           */
          onPress={() => router.push('/(driver)/apply')}
        />

        {/*
         * The way in for somebody who already delivers.
         *
         * A driver whose restaurant created their account and handed them a
         * username has nothing to apply for — and «الانضمام كمندوب» is the
         * wrong row for them. It shows the delivery screen when this account
         * already carries the mode, and the sign-in when it does not, because
         * a courier borrowing a customer's phone is the ordinary case.
         */}
        <ListRow
          label={isDriver ? 'وضع المندوب' : 'دخول المندوبين'}
          sublabel={
            isDriver ? 'طلبات التوصيل المعيّنة لك' : 'لديك اسم مستخدم من المطعم؟ ادخل من هنا'
          }
          icon={<MaterialCommunityIcons name="moped" size={20} color={color.brand} />}
          onPress={() => router.push(isDriver ? '/(driver)/delivery' : '/(auth)/driver-login')}
        />
      </Group>

      <Group title="المساعدة">
        <ListRow
          label="المساعدة والدعم"
          sublabel="تواصل معنا مباشرة"
          icon={<MaterialCommunityIcons name="headset" size={20} color={color.brand} />}
          onPress={() => open(`tel:${extra?.supportPhone ?? ''}`)}
        />
        <ListRow
          label="سياسة الخصوصية"
          icon={
            <MaterialCommunityIcons name="shield-check-outline" size={20} color={color.brand} />
          }
          onPress={() => open(extra?.privacyPolicyUrl ?? 'https://jibli.iq/privacy')}
        />
        <ListRow
          label="الشروط والأحكام"
          icon={
            <MaterialCommunityIcons name="file-document-outline" size={20} color={color.brand} />
          }
          onPress={() => open(extra?.termsUrl ?? 'https://jibli.iq/terms')}
        />
      </Group>

      {!isGuest ? (
        <Group title="الحساب">
          <ListRow
            label="تسجيل الخروج"
            icon={<MaterialCommunityIcons name="logout" size={20} color={color.textSecondary} />}
            onPress={() =>
              void confirmAsync({
                title: 'تسجيل الخروج؟',
                message: 'ستحتاج إلى رمز تحقق جديد لتسجيل الدخول مرة أخرى.',
                confirmLabel: 'خروج',
                destructive: true,
              }).then((yes) => {
                if (yes) void signOut();
              })
            }
          />
          <ListRow
            label="حذف حسابي"
            sublabel="حذف نهائي لبياناتك الشخصية"
            destructive
            icon={
              <MaterialCommunityIcons
                name="trash-can-outline"
                size={20}
                color={color.dangerStrong}
              />
            }
            onPress={() => setDeleting(true)}
          />
        </Group>
      ) : null}

      <View style={{ padding: space[4], alignItems: 'center', gap: space[1] }}>
        <Row gap={space[2]}>
          <Text variant="caption" tone="muted">
            إصدار التطبيق
          </Text>
          {/* Latin inside Arabic: isolated so "1.0.0" is not reordered. */}
          <Ltr variant="caption" tone="muted">
            {Constants.expoConfig?.version ?? '1.0.0'}
          </Ltr>
        </Row>
      </View>

      <AreaPicker visible={pickingArea} onClose={() => setPickingArea(false)} />
      <DeleteAccountSheet visible={deleting} onClose={() => setDeleting(false)} />
    </Screen>
  );
}

/**
 * A titled group of rows.
 *
 * The heading was the same muted caption as the sublabels inside the rows, so
 * it read as another row rather than the thing naming them. Small caps weight
 * and a little air above separate the two jobs.
 *
 * The box outline is gone with it. A hairline border *and* a white fill on a
 * tinted page is two ways of saying the same thing, and on a screen of four
 * stacked groups it turned into a ladder of lines.
 */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ paddingHorizontal: space[4], paddingBottom: space[4] }}>
      <Text
        variant="captionBold"
        tone="secondary"
        style={[RTL_TEXT, { paddingBottom: space[2], paddingHorizontal: space[1] }]}
      >
        {title}
      </Text>
      <View
        style={{
          backgroundColor: color.surfaceCard,
          borderRadius: radius.xl,
          overflow: 'hidden',
          ...shadow.sm,
        }}
      >
        {children}
      </View>
    </View>
  );
}

/**
 * Deleting the account — App Store guideline 5.1.1(v).
 *
 * It says what actually happens before it happens, because the honest answer
 * is not "everything disappears": a delivered order is a record the restaurant
 * and the platform keep too. What goes is the personal data, and saying so
 * plainly is both the decent thing and what keeps the screen truthful.
 */
function DeleteAccountSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { signOut } = useSession();

  const remove = useMutation({
    mutationFn: () => api.deleteAccount(),
    onSuccess: async () => {
      onClose();
      // Clears the keystore and drops the app back to the welcome screen.
      await signOut();
      notify('تم حذف الحساب', 'نأسف لرحيلك. يمكنك إنشاء حساب جديد في أي وقت.');
    },
    onError: (error) =>
      notify(
        'تعذّر حذف الحساب',
        error instanceof ApiError ? error.messageAr : 'حاول مرة أخرى لاحقاً.',
      ),
  });

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="حذف الحساب"
      footer={
        <Row gap={space[2]}>
          <Button
            label="تراجع"
            variant="ghost"
            onPress={onClose}
            style={{ flex: 1, alignSelf: 'center' }}
          />
          <Button
            label="حذف نهائي"
            variant="danger"
            loading={remove.isPending}
            disabled={remove.isPending}
            onPress={() => remove.mutate()}
            style={{ flex: 1, alignSelf: 'center' }}
          />
        </Row>
      }
    >
      <Text tone="secondary">هذا الإجراء لا يمكن التراجع عنه. عند الحذف:</Text>

      <Bullet icon="check" text="يُحذف اسمك ورقم هاتفك وعناوينك المحفوظة." />
      <Bullet icon="check" text="تُحذف مطاعمك المفضّلة وإشعاراتك." />
      <Bullet icon="check" text="يتم تسجيل خروجك من كل الأجهزة." />
      <Bullet
        icon="information"
        text="تبقى سجلات الطلبات السابقة لدى المطاعم كسجلات مالية، دون ربطها بك."
      />
      <Bullet icon="alert" text="لا يمكن الحذف أثناء وجود طلب قيد التنفيذ." />
    </Sheet>
  );
}

function Bullet({ icon, text }: { icon: 'check' | 'information' | 'alert'; text: string }) {
  const tint =
    icon === 'check' ? color.textSecondary : icon === 'alert' ? color.dangerStrong : color.info;

  return (
    <Row gap={space[2]} align="flex-start">
      <MaterialCommunityIcons
        name={icon === 'check' ? 'circle-small' : `${icon}-outline`}
        size={20}
        color={tint}
        style={{ marginTop: 1 }}
      />
      <Text variant="small" tone="secondary" style={{ flex: 1 }}>
        {text}
      </Text>
    </Row>
  );
}
