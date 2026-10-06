import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { categoriesFor, type MerchantType } from '@jibli/contracts';
import MaterialCommunityIcons from '@/ui/icon';
import { api, ApiError, NetworkError, type PartnerApplication } from '@/lib/api';
import { clearAfterSignIn, continueAfterSignIn } from '@/lib/after-sign-in';
import { sectionOf } from '@/lib/sections';
import { useMe, useSession } from '@/lib/session';
import { BRAND, ROW, TAP_TARGET, color, palette, radius, shadow, space } from '@/theme';
import { Button, EmptyState, Field, Input, Row, Screen, Skeleton, Text } from '@/ui';

/**
 * Registering a shop — from the app, as yourself.
 *
 * Until now the app had no way in. «متجري» offered one button, «الدخول بحساب
 * متجر», which wants a username and password that only Jibli staff can issue —
 * so somebody who signed in with their phone and wanted to sell on Jibli
 * pressed it, had nothing to type, and came back to the same screen. Every
 * time. That loop is what this screen ends.
 *
 * The application is filed by the signed-in account. When Jibli approves it the
 * shop is created with this account as its owner, and «متجري» opens it with
 * the same sign-in: no second account, no password to hand over.
 *
 * Market and cosmetics only, on purpose — the same line Owner Mode draws. A
 * restaurant's menu carries modifier groups and per-option prices, which is a
 * job for the web portal, and it applies there.
 */

const KINDS: readonly MerchantType[] = ['MARKET', 'COSMETICS'];

/** The applicant's words for each state, with how the card should look. */
const STATUS_COPY: Record<
  PartnerApplication['status'],
  { title: string; body: string; icon: 'clock-outline' | 'check-circle' | 'close-circle-outline' }
> = {
  DRAFT: {
    title: 'طلبك قيد المراجعة',
    body: 'سيتصل بك فريق جيبلي على رقم هاتفك لتأكيد التفاصيل. لا حاجة لإعادة التقديم.',
    icon: 'clock-outline',
  },
  UNDER_REVIEW: {
    title: 'طلبك قيد المراجعة',
    body: 'سيتصل بك فريق جيبلي على رقم هاتفك لتأكيد التفاصيل. لا حاجة لإعادة التقديم.',
    icon: 'clock-outline',
  },
  INFO_REQUESTED: {
    title: 'نحتاج معلومة إضافية',
    body: 'سيتواصل معك فريق جيبلي على رقم هاتفك لإكمال الطلب.',
    icon: 'clock-outline',
  },
  APPROVED: {
    title: 'تمت الموافقة على متجرك',
    body: 'أهلاً بك شريكاً في جيبلي! أضف منتجاتك وأسعارك الآن من «متجري».',
    icon: 'check-circle',
  },
  REJECTED: {
    title: 'لم يُقبل الطلب',
    body: 'راجعنا طلبك ولم نتمكن من قبوله الآن. يمكنك تعديل البيانات وتقديم طلب جديد.',
    icon: 'close-circle-outline',
  },
};

export default function PartnerApplyScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { state, refresh } = useSession();
  const me = useMe();
  const signedIn = state.status === 'ready' || state.status === 'offline-ready';

  // This screen is where a sign-in started from «سجّل متجرك» was heading.
  useEffect(() => clearAfterSignIn(), []);

  const application = useQuery({
    queryKey: ['partner-application', me?.user_id ?? null],
    queryFn: () => api.partnerApplication(),
    enabled: signedIn,
    // The decision is made in Admin while this screen waits.
    refetchInterval: (query) =>
      query.state.data && isWaiting(query.state.data.status) ? 60_000 : false,
  });

  const refetchApplication = application.refetch;
  useFocusEffect(
    useCallback(() => {
      if (signedIn) void refetchApplication();
    }, [signedIn, refetchApplication]),
  );

  // A rejected applicant may try again; the form replaces the verdict.
  const [reapplying, setReapplying] = useState(false);

  const openShop = async () => {
    // The session learns the new membership, so the live order engine starts.
    await refresh();
    queryClient.removeQueries({ queryKey: ['owner-shops'] });
    router.replace('/(owner)');
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/account'));

  return (
    <Screen edges={['top']} padded={false}>
      <Row justify="space-between" style={{ paddingHorizontal: space[4], minHeight: TAP_TARGET }}>
        <Pressable
          onPress={back}
          accessibilityRole="button"
          accessibilityLabel="رجوع"
          style={{ width: TAP_TARGET, height: TAP_TARGET, justifyContent: 'center' }}
        >
          <MaterialCommunityIcons name="chevron-right" size={26} color={color.textPrimary} />
        </Pressable>
        <Text variant="h3">سجّل متجرك</Text>
        <View style={{ width: TAP_TARGET }} />
      </Row>

      <ScrollView
        contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: space[10] }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!signedIn ? (
          <>
            <Pitch />
            <EmptyState
              title="سجّل الدخول برقم هاتفك أولاً"
              body="يُسجَّل المتجر باسم حسابك، وعلى رقمك يتواصل معك فريق جيبلي. بعد الموافقة تديره من هذا التطبيق بنفس الحساب."
              action={{
                label: 'تسجيل الدخول والمتابعة',
                onPress: () => {
                  continueAfterSignIn('/(owner)/apply');
                  router.push('/(auth)/phone');
                },
              }}
            />
          </>
        ) : application.isLoading ? (
          <View style={{ gap: space[3] }}>
            <Skeleton height={120} style={{ borderRadius: radius.lg }} />
            <Skeleton height={220} style={{ borderRadius: radius.lg }} />
          </View>
        ) : application.isError ? (
          <EmptyState
            title="تعذّر التحقق من طلبك"
            body="تحقق من الاتصال وحاول مرة أخرى."
            action={{ label: 'إعادة المحاولة', onPress: () => void application.refetch() }}
          />
        ) : application.data && !(application.data.status === 'REJECTED' && reapplying) ? (
          <ApplicationStatus
            application={application.data}
            onOpenShop={openShop}
            onReapply={() => setReapplying(true)}
            onSignInAsShop={() => router.push('/(auth)/owner-login')}
          />
        ) : (
          <ApplyForm
            defaultName={me?.full_name ?? ''}
            defaultCityId={me?.city_id ?? null}
            onApplied={(saved) => {
              setReapplying(false);
              queryClient.setQueryData(['partner-application', me?.user_id ?? null], saved);
            }}
          />
        )}
      </ScrollView>
    </Screen>
  );
}

/** «الكرادة · بغداد», but plain «بغداد» where the city and its governorate share a name. */
function placeName(city: string, governorate: string): string {
  return city === governorate ? city : `${city} · ${governorate}`;
}

function isWaiting(status: PartnerApplication['status']): boolean {
  return status === 'DRAFT' || status === 'UNDER_REVIEW' || status === 'INFO_REQUESTED';
}

/** What a shop gets, said before anything is asked of it. */
function Pitch() {
  return (
    <View
      style={{
        padding: space[4],
        borderRadius: radius.xl,
        backgroundColor: BRAND[50],
        borderWidth: 1,
        borderColor: BRAND[200],
        gap: space[2],
      }}
    >
      <Text variant="h3" tone="brand">
        بِع على جيبلي
      </Text>
      <Text variant="small" tone="secondary">
        سجّل ماركتك أو متجر التجميل. بعد موافقة فريق جيبلي تديره من هذا التطبيق: تضيف المنتجات
        بالصور، تحدد الأسعار، وتستلم الطلبات وتجهّزها — بحساب واحد.
      </Text>
    </View>
  );
}

// ── The form ────────────────────────────────────────────────────────────────

function ApplyForm({
  defaultName,
  defaultCityId,
  onApplied,
}: {
  defaultName: string;
  defaultCityId: string | null;
  onApplied: (application: PartnerApplication) => void;
}) {
  const [kind, setKind] = useState<MerchantType | null>(null);
  const [shopName, setShopName] = useState('');
  const [ownerName, setOwnerName] = useState(defaultName);
  const [cityId, setCityId] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const coverage = useQuery({
    queryKey: ['onboarding-coverage'],
    queryFn: () => api.onboardingCoverage(),
    staleTime: 10 * 60_000,
  });

  const cities = useMemo(
    () =>
      (coverage.data ?? []).flatMap((governorate) =>
        governorate.cities.map((city) => ({
          id: city.id,
          name: city.name_ar,
          governorateId: governorate.id,
          governorateName: governorate.name_ar,
        })),
      ),
    [coverage.data],
  );

  // Start from the applicant's own city when Jibli is taking shops there.
  useEffect(() => {
    if (cityId || cities.length === 0) return;
    const own = cities.find((city) => city.id === defaultCityId);
    if (own) setCityId(own.id);
    else if (cities.length === 1) setCityId(cities[0]!.id);
  }, [cities, cityId, defaultCityId]);

  const city = cities.find((entry) => entry.id === cityId) ?? null;

  const apply = useMutation({
    mutationFn: () =>
      api.applyAsPartner({
        display_name: shopName.trim(),
        merchant_type: kind!,
        ...(ownerName.trim().length >= 3 ? { applicant_name: ownerName.trim() } : {}),
        governorate_id: city!.governorateId,
        city_id: city!.id,
        address_text: address.trim(),
        cuisine_tags: tags,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: (result) => onApplied(result.application),
    onError: (caught) =>
      setProblem(
        caught instanceof ApiError
          ? caught.messageAr
          : caught instanceof NetworkError
            ? 'تعذّر الاتصال. تحقق من الإنترنت وحاول مرة أخرى.'
            : 'تعذّر إرسال الطلب، حاول مرة أخرى.',
      ),
  });

  const missing = !kind
    ? 'اختر نوع متجرك'
    : shopName.trim().length < 2
      ? 'اكتب اسم المتجر'
      : !city
        ? 'اختر المدينة'
        : address.trim().length < 5
          ? 'اكتب عنوان المتجر'
          : null;

  return (
    <View style={{ gap: space[4] }}>
      <Pitch />

      <View style={{ gap: space[2] }}>
        <Text variant="smallBold" tone="secondary">
          نوع المتجر
        </Text>
        <Row gap={space[3]} align="stretch">
          {KINDS.map((entry) => (
            <KindCard
              key={entry}
              kind={entry}
              selected={kind === entry}
              onPress={() => {
                setKind(entry);
                // Each kind is tagged from its own list; the other's tags go.
                if (entry !== kind) setTags([]);
              }}
            />
          ))}
        </Row>
      </View>

      <Field label="اسم المتجر">
        <Input
          value={shopName}
          onChangeText={setShopName}
          placeholder={kind === 'COSMETICS' ? 'مثال: كوزمتك الورد' : 'مثال: ماركت الخير'}
          maxLength={120}
          accessibilityLabel="اسم المتجر"
        />
      </Field>

      <Field label="اسم صاحب المتجر" hint="كما سيناديك فريق جيبلي حين يتصل بك.">
        <Input
          value={ownerName}
          onChangeText={setOwnerName}
          placeholder="الاسم الثلاثي"
          maxLength={80}
          accessibilityLabel="اسم صاحب المتجر"
        />
      </Field>

      <View style={{ gap: space[2] }}>
        <Text variant="smallBold" tone="secondary">
          المدينة
        </Text>
        {coverage.isLoading ? (
          <Skeleton height={44} style={{ borderRadius: radius.full }} />
        ) : cities.length === 0 ? (
          <Text variant="small" tone="muted">
            {coverage.isError
              ? 'تعذّر تحميل المدن. تحقق من الاتصال.'
              : 'لا نستقبل طلبات متاجر جديدة حالياً. تابعنا — نفتح مدناً جديدة باستمرار.'}
          </Text>
        ) : (
          <View style={{ flexDirection: ROW, flexWrap: 'wrap', gap: space[2] }}>
            {cities.map((entry) => (
              <Chip
                key={entry.id}
                label={placeName(entry.name, entry.governorateName)}
                selected={entry.id === cityId}
                onPress={() => setCityId(entry.id)}
              />
            ))}
          </View>
        )}
      </View>

      <Field label="عنوان المتجر" hint="المنطقة، الشارع، وأقرب نقطة دالة.">
        <Input
          value={address}
          onChangeText={setAddress}
          placeholder="مثال: المنصور، شارع ١٤ رمضان، قرب جامع الرحمن"
          maxLength={300}
          multiline
          style={{
            minHeight: TAP_TARGET * 1.6,
            paddingVertical: space[2],
            textAlignVertical: 'top',
          }}
          accessibilityLabel="عنوان المتجر"
        />
      </Field>

      {kind ? (
        <View style={{ gap: space[2] }}>
          <Text variant="smallBold" tone="secondary">
            ماذا تبيع؟ (اختياري، حتى ٤)
          </Text>
          <View style={{ flexDirection: ROW, flexWrap: 'wrap', gap: space[2] }}>
            {categoriesFor(kind).map((entry) => {
              const on = tags.includes(entry.key);
              return (
                <Chip
                  key={entry.key}
                  label={`${entry.emoji} ${entry.labelAr}`}
                  selected={on}
                  tint={sectionOf(kind).ramp}
                  onPress={() =>
                    setTags((current) =>
                      on
                        ? current.filter((tag) => tag !== entry.key)
                        : current.length < 4
                          ? [...current, entry.key]
                          : current,
                    )
                  }
                />
              );
            })}
          </View>
        </View>
      ) : null}

      <Field label="ملاحظة (اختياري)">
        <Input
          value={note}
          onChangeText={setNote}
          placeholder="أوقات العمل، عدد الفروع، أو أي شيء تريدنا أن نعرفه"
          maxLength={500}
          multiline
          style={{
            minHeight: TAP_TARGET * 1.4,
            paddingVertical: space[2],
            textAlignVertical: 'top',
          }}
          accessibilityLabel="ملاحظة"
        />
      </Field>

      {problem ? (
        <Row
          gap={space[2]}
          style={{ padding: space[3], borderRadius: radius.md, backgroundColor: color.dangerSoft }}
        >
          <MaterialCommunityIcons name="alert-circle-outline" size={18} color={color.danger} />
          <Text variant="small" tone="danger" style={{ flex: 1 }}>
            {problem}
          </Text>
        </Row>
      ) : null}

      <Button
        label={missing ?? 'إرسال الطلب'}
        block
        size="lg"
        disabled={missing !== null || apply.isPending}
        loading={apply.isPending}
        onPress={() => {
          setProblem(null);
          apply.mutate();
        }}
      />

      <Text variant="caption" tone="muted" align="center">
        يراجع فريق جيبلي الطلب ويتصل بك على رقم حسابك. بإرسال الطلب توافق على شروط الشراكة مع جيبلي.
      </Text>
    </View>
  );
}

/** One of the two kinds of shop, in its section's own colours. */
function KindCard({
  kind,
  selected,
  onPress,
}: {
  kind: MerchantType;
  selected: boolean;
  onPress: () => void;
}) {
  const section = sectionOf(kind);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={section.shortName}
      style={({ pressed }) => ({
        flex: 1,
        padding: space[4],
        gap: space[2],
        borderRadius: radius.lg,
        borderWidth: 2,
        borderColor: selected ? section.ramp[500] : section.ramp[100],
        backgroundColor: selected ? section.ramp[500] : section.ramp[50],
        opacity: pressed ? 0.9 : 1,
        ...(selected ? shadow.md : {}),
      })}
    >
      <Row justify="space-between" align="flex-start">
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: selected ? 'rgba(255,255,255,0.22)' : section.ramp[100],
          }}
        >
          <MaterialCommunityIcons
            name={section.shopIcon}
            size={24}
            color={selected ? palette.white : section.ramp[600]}
          />
        </View>
        {selected ? (
          <MaterialCommunityIcons name="check-circle" size={22} color={palette.white} />
        ) : null}
      </Row>
      <Text variant="h3" style={{ color: selected ? palette.white : section.ramp[700] }}>
        {section.shortName}
      </Text>
      <Text
        variant="caption"
        numberOfLines={2}
        style={{ color: selected ? 'rgba(255,255,255,0.9)' : section.ramp[700] }}
      >
        {section.tags}
      </Text>
    </Pressable>
  );
}

function Chip({
  label,
  selected,
  onPress,
  tint,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  tint?: { 50: string; 200: string; 500: string; 700: string };
}) {
  const accent = tint ?? { 50: BRAND[50], 200: BRAND[200], 500: BRAND[500], 700: BRAND[700] };
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        minHeight: TAP_TARGET - 4,
        paddingHorizontal: space[3],
        justifyContent: 'center',
        borderRadius: radius.full,
        borderWidth: 1,
        borderColor: selected ? accent[500] : color.borderSubtle,
        backgroundColor: selected ? accent[50] : color.surfaceCard,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text
        variant={selected ? 'smallBold' : 'small'}
        style={{ color: selected ? accent[700] : color.textPrimary }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ── After applying ──────────────────────────────────────────────────────────

function ApplicationStatus({
  application,
  onOpenShop,
  onReapply,
  onSignInAsShop,
}: {
  application: PartnerApplication;
  onOpenShop: () => void;
  onReapply: () => void;
  onSignInAsShop: () => void;
}) {
  const copy = STATUS_COPY[application.status] ?? STATUS_COPY.UNDER_REVIEW;
  const section = sectionOf(application.merchant_type);
  const approved = application.status === 'APPROVED';
  const rejected = application.status === 'REJECTED';

  const tone = approved ? 'success' : rejected ? 'danger' : 'brand';
  const tint = approved ? color.successSoft : rejected ? color.dangerSoft : BRAND[50];
  const iconColor = approved ? color.successStrong : rejected ? color.dangerStrong : BRAND[500];

  return (
    <View style={{ gap: space[4] }}>
      <View
        style={{
          padding: space[5],
          borderRadius: radius.xl,
          backgroundColor: tint,
          alignItems: 'center',
          gap: space[2],
        }}
      >
        <MaterialCommunityIcons name={copy.icon} size={48} color={iconColor} />
        {/*
         * Full width, centred by alignment rather than by the column: a line
         * sized to its own measured width lost its last word on Android — the
         * measurement rounds a fraction short in Cairo and «متجرك» wrapped out
         * of sight, leaving «تمت الموافقة على».
         */}
        <Text variant="h3" align="center" tone={tone} style={{ alignSelf: 'stretch' }}>
          {copy.title}
        </Text>
        <Text variant="small" tone="secondary" align="center" style={{ alignSelf: 'stretch' }}>
          {copy.body}
        </Text>
        {rejected && application.rejection_reason ? (
          <Text
            variant="smallBold"
            tone="secondary"
            align="center"
            style={{ alignSelf: 'stretch' }}
          >
            {`السبب: ${application.rejection_reason}`}
          </Text>
        ) : null}
      </View>

      <View
        style={{
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: color.borderSubtle,
          backgroundColor: color.surfaceCard,
          overflow: 'hidden',
        }}
      >
        <Detail label="المتجر" value={application.display_name} />
        <Detail label="النوع" value={section.shortName} accent={section.ramp[600]} />
        <Detail
          label="المدينة"
          value={placeName(application.city_name_ar, application.governorate_name_ar)}
        />
        <Detail label="العنوان" value={application.address_text} />
        <Detail
          label="تاريخ التقديم"
          value={new Date(application.applied_at).toLocaleDateString('ar-IQ', {
            day: 'numeric',
            month: 'long',
          })}
          last
        />
      </View>

      {approved && application.owned ? (
        <Button label="افتح متجري" block size="lg" onPress={onOpenShop} />
      ) : null}

      {/* Approved onto another account (a portal login the team issued). */}
      {approved && !application.owned ? (
        <Button label="الدخول بحساب المتجر" block variant="secondary" onPress={onSignInAsShop} />
      ) : null}

      {rejected ? <Button label="تقديم طلب جديد" block onPress={onReapply} /> : null}
    </View>
  );
}

function Detail({
  label,
  value,
  accent,
  last = false,
}: {
  label: string;
  value: string;
  accent?: string;
  last?: boolean;
}) {
  return (
    <Row
      justify="space-between"
      align="flex-start"
      gap={space[3]}
      style={{
        paddingHorizontal: space[4],
        paddingVertical: space[3],
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: color.borderSubtle,
      }}
    >
      <Text variant="small" tone="muted">
        {label}
      </Text>
      {/* Shrinks rather than stretches, so the row's own spacing puts the value
          at the far edge — no side named, which a mirrored layout would flip. */}
      <Text variant="smallBold" style={{ flexShrink: 1, ...(accent ? { color: accent } : {}) }}>
        {value}
      </Text>
    </Row>
  );
}
