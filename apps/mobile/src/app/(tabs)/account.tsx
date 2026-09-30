import { Children, Fragment, useCallback, useMemo, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import { configString } from '@/lib/app-config';
import { useFocusEffect, useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import MaterialCommunityIcons from '@/ui/icon';
import { api, ApiError } from '@/lib/api';
import { useArea } from '@/lib/area';
import { useIsGuest, useSession } from '@/lib/session';
import { confirmAsync, notify } from '@/lib/dialog';
import { ALIGN_START, ROW, accent, color, radius, shadow, space } from '@/theme';
import { Button, Ltr, Row, Screen, Text } from '@/ui';
import { AreaPicker } from '@/ui/area-picker';
import { AddressSheet } from '@/ui/address-sheet';
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
  const { state, signOut, refresh, parkedAccount, switchToParked } = useSession();
  const isGuest = useIsGuest();

  /*
   * The courier application, read fresh whenever this screen is opened.
   *
   * The session's `modes` are resolved at sign-in, so an application accepted
   * in Admin afterwards did not show here until the app was restarted — the
   * new courier kept seeing «الانضمام كمندوب» for an account that already
   * could deliver. This one small read is what notices the approval.
   */
  const application = useQuery({
    queryKey: ['driver-application'],
    queryFn: () => api.driverApplication(),
    enabled: !isGuest && (state.status === 'ready' || state.status === 'needs-profile'),
  });
  const refetchApplication = application.refetch;
  useFocusEffect(
    useCallback(() => {
      if (!isGuest) void refetchApplication();
    }, [isGuest, refetchApplication]),
  );

  /** Whether this account can switch into the courier mode. */
  const isDriver =
    ((state.status === 'ready' || state.status === 'needs-profile') &&
      state.me.modes.includes('DRIVER')) ||
    application.data?.status === 'ACTIVE';
  /** Applied and waiting, or declined — anything but «not applied yet». */
  const applicationStatus = application.data?.status ?? null;

  /*
   * Into driver mode. When the approval arrived after sign-in, the session
   * does not carry the mode yet, so it is refreshed first — once, on a tap,
   * rather than on every visit to this screen.
   */
  const openDriverMode = async () => {
    const sessionHasMode =
      (state.status === 'ready' || state.status === 'needs-profile') &&
      state.me.modes.includes('DRIVER');
    if (!sessionHasMode) await refresh();
    router.push('/(driver)/delivery');
  };
  /**
   * Whether this account holds a role in any shop.
   *
   * Read off the `me` the session already has — `/auth/me` has always returned
   * `restaurant_roles` — so the row appears without a second request, and a
   * customer who owns nothing never sees it at all.
   */
  const ownsShop =
    (state.status === 'ready' || state.status === 'needs-profile') &&
    Object.keys(state.me.restaurant_roles ?? {}).length > 0;
  /** The shop this person signed into earlier, kept while they shop as themselves. */
  const parkedShop = !ownsShop && parkedAccount === 'shop';

  /*
   * A shop application waiting on Jibli, if there is one — so the row says
   * where it stands, as the courier row does. Keyed like «متجري»'s own read,
   * so the two screens share one answer.
   */
  const partnerApplication = useQuery({
    queryKey: [
      'partner-application',
      state.status === 'ready' || state.status === 'needs-profile' ? state.me.user_id : null,
    ],
    queryFn: () => api.partnerApplication(),
    enabled:
      !isGuest && !ownsShop && (state.status === 'ready' || state.status === 'needs-profile'),
    staleTime: 60_000,
  });
  const partnerStatus = partnerApplication.data?.status ?? null;
  const { area } = useArea();

  const [pickingArea, setPickingArea] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /*
   * The address this screen is about.
   *
   * A guest has none and cannot have one — there is no account to hang it on —
   * so for them the row stays what it was: a city, for deciding which
   * restaurants to show.
   */
  const addresses = useQuery({
    queryKey: ['addresses'],
    queryFn: () => api.addresses(),
    enabled: !isGuest,
    staleTime: 5 * 60_000,
  });

  const home = useMemo(
    () => (addresses.data ?? []).find((entry) => entry.is_default) ?? addresses.data?.[0] ?? null,
    [addresses.data],
  );

  /**
   * The address in one line, most specific part first.
   *
   * «بغداد» told a customer nothing they did not know. What they need to see is
   * whether what the courier will be handed is enough to find them.
   */
  const homeLine = useMemo(() => {
    if (!home) return null;
    return [home.district_text, home.street, home.landmark].filter(Boolean).join(' — ');
  }, [home]);

  const me = state.status === 'ready' || state.status === 'needs-profile' ? state.me : null;
  const extra = {
    supportPhone: configString('supportPhone'),
    privacyPolicyUrl: configString('privacyPolicyUrl'),
    termsUrl: configString('termsUrl'),
  };

  const open = (url: string) => {
    void Linking.openURL(url).catch(() =>
      notify('تعذّر الفتح', 'لم نتمكن من فتح الرابط على هذا الجهاز.'),
    );
  };

  return (
    <Screen scroll edges={['top']} padded={false}>
      {/* The same top inset as the other tabs, so the four titles sit on one line. */}
      <View
        style={{
          paddingHorizontal: space[4],
          paddingTop: space[2],
          paddingBottom: space[4],
          gap: space[4],
        }}
      >
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
                {/*
                 * Governorate, then city — unless they are the same word.
                 * Baghdad is a city in the governorate of the same name, and
                 * «بغداد — بغداد» read as a bug on the one card that carries
                 * the customer's own name.
                 */}
                {area
                  ? area.governorateNameAr === area.cityNameAr
                    ? area.cityNameAr
                    : `${area.governorateNameAr} — ${area.cityNameAr}`
                  : 'لم تُحدَّد المنطقة'}
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
        {isGuest ? (
          <ListRow
            label="منطقة التوصيل"
            sublabel={area?.cityNameAr ?? 'اختر منطقتك'}
            icon={
              <MaterialCommunityIcons name="map-marker-outline" size={20} color={color.brand} />
            }
            onPress={() => setPickingArea(true)}
          />
        ) : (
          /*
           * One row for the whole address, not a row for the city.
           *
           * The pin is called out in the sublabel because it is the difference
           * between a courier who arrives and a courier who phones from the end
           * of the street, and nothing on this screen used to say whether the
           * address had one.
           */
          <ListRow
            label="عناويني"
            sublabel={
              home
                ? `${home.city.name_ar}${homeLine ? ` — ${homeLine}` : ''}${
                    home.latitude != null && home.longitude != null ? '' : ' • بلا دبوس'
                  }`
                : 'أضف عنوانك وثبّت منزلك على الخريطة'
            }
            icon={
              <MaterialCommunityIcons
                name={
                  home?.latitude != null && home.longitude != null
                    ? 'map-marker-check'
                    : 'map-marker-plus-outline'
                }
                size={20}
                color={color.brand}
              />
            }
            onPress={() => setEditingAddress(true)}
          />
        )}
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
        {/*
         * One account, two modes. A courier signs in with their phone number
         * like everybody else — no username, no password — and once their
         * application is accepted this row becomes the switch into Driver
         * Mode. Until then it is the way to apply, or to see where the
         * application stands.
         */}
        {isDriver ? (
          <ListRow
            label="التبديل إلى وضع المندوب"
            sublabel="طلبات التوصيل المعيّنة لك والخريطة"
            icon={<MaterialCommunityIcons name="moped" size={20} color={color.brand} />}
            onPress={() => void openDriverMode()}
          />
        ) : (
          <ListRow
            label={applicationStatus ? 'طلب الانضمام كمندوب' : 'الانضمام كمندوب توصيل'}
            sublabel={
              applicationStatus === 'PENDING_ACTIVATION'
                ? 'قيد المراجعة — سنتواصل معك'
                : applicationStatus
                  ? 'اضغط لمعرفة حالة طلبك'
                  : 'وصّل الطلبات واكسب معنا'
            }
            icon={<MaterialCommunityIcons name="motorbike" size={20} color={color.brand} />}
            /*
             * Shown to a guest too. Somebody who wants to deliver arrives as a
             * browsing customer; the screen itself asks for the account, which
             * is the right place to explain why.
             */
            onPress={() => router.push('/(driver)/apply')}
          />
        )}

        {/*
         * The shop owner's door, shown to everyone.
         *
         * It has to be. A grocer who installs the app to sell arrives as a guest
         * like anybody else — hiding this row until the session already proves
         * a shop role would mean the only way in is to be in already.
         *
         * It used to go straight to «دخول أصحاب المتاجر», a username and
         * password that only Jibli staff issue — so anyone without one came
         * back empty-handed. It now opens «متجري», which offers registering a
         * shop as this account first and that login second, and shows the
         * application once there is one.
         */}
        <ListRow
          label={ownsShop ? 'متجري' : parkedShop ? 'العودة إلى متجري' : 'سجّل متجرك في جيبلي'}
          sublabel={
            ownsShop
              ? 'أضف المنتجات وعدّل الأسعار واستلم الطلبات'
              : parkedShop
                ? 'حساب متجرك محفوظ — يفتح بلا كلمة مرور'
                : partnerStatus === 'UNDER_REVIEW' ||
                    partnerStatus === 'INFO_REQUESTED' ||
                    partnerStatus === 'DRAFT'
                  ? 'طلبك قيد المراجعة — سنتواصل معك'
                  : partnerStatus === 'REJECTED'
                    ? 'لم يُقبل الطلب — اضغط للتفاصيل'
                    : 'لأصحاب الماركت ومتاجر التجميل'
          }
          icon={<MaterialCommunityIcons name="storefront-outline" size={20} color={color.brand} />}
          onPress={() => {
            if (parkedShop) {
              void switchToParked().then(() => router.push('/(owner)'));
              return;
            }
            router.push('/(owner)');
          }}
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
                message: parkedAccount
                  ? 'سيُسجَّل خروج هذا الحساب والحساب المحفوظ معه. ستحتاج إلى تسجيل الدخول من جديد لكليهما.'
                  : 'ستحتاج إلى رمز تحقق جديد لتسجيل الدخول مرة أخرى.',
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

      <AddressSheet
        visible={editingAddress}
        start="list"
        onClose={() => setEditingAddress(false)}
      />
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
  // Conditional rows leave `null` and `false` behind; only the rendered ones
  // get a rule between them.
  const rows = Children.toArray(children);

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
        {rows.map((row, index) => (
          <Fragment key={index}>
            {/*
             * A hairline between rows, inset to the text edge.
             *
             * Rows with a sublabel are taller than rows without one, and
             * with nothing between them the group read as a stack of
             * uneven blocks. The rule starts where the words start — past
             * the tile and its gap, on the right — so the tiles stay a clean
             * column. Physical sides, because `ROW` pins the tile to the
             * right in both layout modes.
             */}
            {index > 0 ? (
              <View
                style={{
                  height: StyleSheet.hairlineWidth,
                  backgroundColor: color.borderSubtle,
                  marginLeft: space[3],
                  marginRight: space[3] + 40 + space[3],
                }}
              />
            ) : null}
            {row}
          </Fragment>
        ))}
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
  /**
   * The failure, said in the sheet.
   *
   * `notify` draws a `Modal` and iOS will not present one over this sheet — so
   * a failed deletion used to show nothing at all and wedge the dialog queue,
   * on the screen App Review opens first. The success path is safe because the
   * sheet is already gone by then.
   */
  const [problem, setProblem] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: () => api.deleteAccount(),
    onSuccess: async () => {
      onClose();
      // Clears the keystore and drops the app back to the welcome screen.
      await signOut();
      notify('تم حذف الحساب', 'نأسف لرحيلك. يمكنك إنشاء حساب جديد في أي وقت.');
    },
    onError: (error) =>
      setProblem(error instanceof ApiError ? error.messageAr : 'تعذّر حذف الحساب، حاول لاحقاً.'),
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
      {problem ? (
        <View
          style={{
            borderRadius: radius.md,
            backgroundColor: color.dangerSoft,
            paddingVertical: space[2],
            paddingHorizontal: space[3],
          }}
        >
          <Text variant="caption" tone="danger">
            {problem}
          </Text>
        </View>
      ) : null}

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
