import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextStyle,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { fullNameSchema } from '@jibli/validation';
import { useSession } from '@/lib/session';
import { ensureLocationPermissionAsked } from '@/lib/location';
import { AddressSheet } from '@/ui/address-sheet';
import type { DeliveryArea } from '@/lib/area';
import { api, ApiError, NetworkError, type GeographyOption } from '@/lib/api';
import { signedInDestination } from '@/lib/after-sign-in';
import {
  BRAND,
  ROW,
  lazySheet,
  TAP_TARGET,
  color,
  palette,
  radius,
  shadow,
  space,
  text,
} from '@/theme';

/**
 * Mandatory profile completion (plan §11).
 *
 *   أكمل معلوماتك → الاسم الكامل → المحافظة → المدينة → متابعة
 *
 * The two selectors are dependent: cities load only after a governorate is
 * chosen, and both lists come from the server filtered by effective
 * customer-signup capability — the app never ships a hard-coded city list
 * (plan §4.2).
 *
 * Critically, this screen handles the race the plan calls out: an Admin can
 * disable the chosen city between the list fetch and the submit. The server
 * answers CITY_NOT_AVAILABLE, and the correct response is to refresh the
 * options and let the customer choose again — not to show a generic error.
 */
export default function ProfileScreen() {
  const router = useRouter();
  const { refresh } = useSession();

  const [fullName, setFullName] = useState('');
  const [governorate, setGovernorate] = useState<GeographyOption | null>(null);
  const [city, setCity] = useState<GeographyOption | null>(null);

  const [governorates, setGovernorates] = useState<GeographyOption[]>([]);
  const [cities, setCities] = useState<GeographyOption[]>([]);
  const [loadingGovernorates, setLoadingGovernorates] = useState(true);
  const [loadingCities, setLoadingCities] = useState(false);

  const [picker, setPicker] = useState<'governorate' | 'city' | null>(null);
  /**
   * The third step, which is not numbered.
   *
   * Asking for the address here — while the customer is already answering
   * questions about themselves and nothing is at stake — is the whole reason
   * addresses have pins on them. The alternative is checkout, where somebody
   * hungry and mid-payment is asked to drag a map, and where almost nobody did.
   *
   * It opens *before* `refresh()`, and that ordering is load-bearing: the Gate
   * sends a completed profile straight to `/(tabs)`, so re-resolving the
   * session first would unmount this screen and the sheet with it.
   */
  const [askingAddress, setAskingAddress] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  const loadGovernorates = async () => {
    setLoadingGovernorates(true);
    try {
      setGovernorates(await api.governorates('customer_signup'));
    } catch {
      setError('تعذّر تحميل قائمة المحافظات');
    } finally {
      setLoadingGovernorates(false);
    }
  };

  useEffect(() => {
    void loadGovernorates();
  }, []);

  const selectGovernorate = async (option: GeographyOption) => {
    setGovernorate(option);
    // Changing governorate invalidates the city: keeping a stale one would let
    // a mismatched pair reach the server.
    setCity(null);
    setPicker(null);
    setLoadingCities(true);
    try {
      setCities(await api.cities(option.id, 'customer_signup'));
    } catch {
      setError('تعذّر تحميل قائمة المدن');
    } finally {
      setLoadingCities(false);
    }
  };

  const nameResult = fullNameSchema.safeParse(fullName);
  const canSubmit = nameResult.success && governorate !== null && city !== null && !isSubmitting;

  const handleSubmit = async () => {
    if (!nameResult.success || !governorate || !city) return;
    setSubmitting(true);
    setError(null);

    try {
      await api.completeProfile({
        full_name: nameResult.data,
        governorate_id: governorate.id,
        city_id: city.id,
      });

      /*
       * The address, before the session is re-resolved.
       *
       * Permission first, and deliberately: this is the one moment in the app
       * where a location prompt explains itself, because the customer is
       * visibly filling in where they live. `ensureLocationPermissionAsked`
       * only ever raises one dialog in the lifetime of an install, so the
       * address form and the home screen cannot both ask.
       *
       * A denial is fine — the sheet simply opens without a fix and offers the
       * button. So is skipping the sheet entirely; the home screen offers it
       * again, once.
       */
      await ensureLocationPermissionAsked();
      setAskingAddress(true);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.messageAr);

        // The geography changed under us. Reload the options and clear the now
        // invalid selection so the customer can pick again (plan §11).
        if (
          caught.code === 'CITY_NOT_AVAILABLE' ||
          caught.code === 'GOVERNORATE_NOT_AVAILABLE' ||
          caught.code === 'CITY_GOVERNORATE_MISMATCH'
        ) {
          setCity(null);
          if (caught.code === 'GOVERNORATE_NOT_AVAILABLE') {
            setGovernorate(null);
            setCities([]);
          } else if (governorate) {
            setCities(await api.cities(governorate.id, 'customer_signup').catch(() => []));
          }
          await loadGovernorates();
        }

        // Already completed elsewhere — just continue.
        if (caught.code === 'PROFILE_ALREADY_COMPLETED_CONFLICT') {
          // Completed on another device: the status here is stale for the same
          // reason, and needs the same re-resolve before leaving.
          await refresh();
          router.replace(signedInDestination() as never);
        }
      } else if (caught instanceof NetworkError) {
        setError('تعذّر الاتصال بالإنترنت. تحقق من الاتصال وحاول مرة أخرى.');
      } else {
        setError('حدث خطأ غير متوقع، الرجاء المحاولة مرة أخرى');
      }
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Leave for the app, whether or not an address was saved.
   *
   * `refresh()` is what makes the session `ready`; without it the Gate reads a
   * stale `needs-profile` and sends this screen straight back to itself.
   */
  const finish = async () => {
    setAskingAddress(false);
    await refresh();
    // A sign-in started from «سجّل متجرك» continues to the application form.
    router.replace(signedInDestination() as never);
  };

  const nameInvalid = fullName.length > 0 && !nameResult.success;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          {/* The second and last step — worth saying on the one screen a new
              customer cannot skip. */}
          <Text style={styles.step}>الخطوة ٢ من ٢</Text>
          <Text style={styles.title}>عرّفنا بنفسك</Text>
          <Text style={styles.subtitle}>
            الاسم لنخاطبك به، والمنطقة لنعرض المطاعم التي توصّل إليك
          </Text>
        </View>

        {/*
         * One card, three rows, hairlines between them.
         *
         * The fields used to sit loose on the page with a gap between each,
         * so nothing said they belonged together or where the form ended. A
         * card with dividers is the same three inputs reading as a single
         * thing to fill in.
         */}
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>الاسم</Text>
            <TextInput
              style={[styles.input, nameInvalid ? styles.inputInvalid : null]}
              value={fullName}
              onChangeText={setFullName}
              placeholder="سامي"
              placeholderTextColor={palette.ink[400]}
              accessibilityLabel="الاسم"
              editable={!isSubmitting}
              returnKeyType="done"
            />
            {nameInvalid ? (
              <Text style={styles.fieldError}>
                {nameResult.error.issues[0]?.message ?? 'الاسم غير صالح'}
              </Text>
            ) : (
              <Text style={styles.hint}>اسم واحد يكفي</Text>
            )}
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>المحافظة</Text>
            <Pressable
              style={({ pressed }) => [styles.select, pressed ? styles.selectPressed : null]}
              onPress={() => setPicker('governorate')}
              disabled={loadingGovernorates || isSubmitting}
              accessibilityRole="button"
              accessibilityLabel={`المحافظة: ${governorate?.name_ar ?? 'لم يتم الاختيار'}`}
            >
              {loadingGovernorates ? (
                <ActivityIndicator color={BRAND[500]} />
              ) : (
                <>
                  <Text style={governorate ? styles.selectValue : styles.selectPlaceholder}>
                    {governorate?.name_ar ?? 'اختر المحافظة'}
                  </Text>
                  <Text style={styles.chevron}>‹</Text>
                </>
              )}
            </Pressable>
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>المدينة</Text>
            <Pressable
              style={({ pressed }) => [
                styles.select,
                !governorate ? styles.selectDisabled : null,
                pressed && governorate ? styles.selectPressed : null,
              ]}
              // A city cannot be chosen before its parent: that is what keeps
              // the pair consistent before it ever reaches the server.
              disabled={!governorate || loadingCities || isSubmitting}
              onPress={() => setPicker('city')}
              accessibilityRole="button"
              accessibilityLabel={`المدينة: ${city?.name_ar ?? 'لم يتم الاختيار'}`}
              accessibilityHint={!governorate ? 'اختر المحافظة أولاً' : undefined}
            >
              {loadingCities ? (
                <ActivityIndicator color={BRAND[500]} />
              ) : (
                <>
                  <Text style={city ? styles.selectValue : styles.selectPlaceholder}>
                    {city?.name_ar ?? (governorate ? 'اختر المدينة' : 'اختر المحافظة أولاً')}
                  </Text>
                  <Text style={styles.chevron}>‹</Text>
                </>
              )}
            </Pressable>
            {governorate && !loadingCities && cities.length === 0 ? (
              <Text style={styles.fieldError}>
                لا توجد مدن متاحة للتسجيل في هذه المحافظة حالياً
              </Text>
            ) : null}
          </View>
        </View>

        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
      </ScrollView>

      {/*
       * The action sits on a bar rather than at the end of the list, so it
       * stays reachable with one thumb while the keyboard is open and the
       * form is scrolled.
       */}
      <View style={styles.actionBar}>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            !canSubmit ? styles.buttonDisabled : null,
            pressed && canSubmit ? styles.buttonPressed : null,
          ]}
          onPress={handleSubmit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit, busy: isSubmitting }}
        >
          {isSubmitting ? (
            <ActivityIndicator color={palette.white} />
          ) : (
            <Text style={styles.buttonText}>ابدأ الطلب</Text>
          )}
        </Pressable>
      </View>

      <AddressSheet
        visible={askingAddress}
        title="أين نوصّل طلبك؟"
        /*
         * The city chosen a moment ago, handed over directly.
         *
         * `useArea` reads the profile, and the profile this screen just wrote
         * has not been re-resolved yet — on purpose. Without this the sheet
         * would open asking for a city that is already on screen above it.
         */
        initialArea={
          governorate && city
            ? ({
                governorateId: governorate.id,
                governorateNameAr: governorate.name_ar,
                cityId: city.id,
                cityNameAr: city.name_ar,
              } satisfies DeliveryArea)
            : null
        }
        onClose={() => void finish()}
        onSaved={() => void finish()}
      />

      <OptionPicker
        visible={picker !== null}
        title={picker === 'governorate' ? 'اختر المحافظة' : 'اختر المدينة'}
        options={picker === 'governorate' ? governorates : cities}
        onSelect={(option) => {
          if (picker === 'governorate') void selectGovernorate(option);
          else {
            setCity(option);
            setPicker(null);
          }
        }}
        onClose={() => setPicker(null)}
      />
    </View>
  );
}

/** Searchable option list — Arabic search is required by plan §134. */
function OptionPicker({
  visible,
  title,
  options,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: GeographyOption[];
  onSelect: (option: GeographyOption) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');

  const filtered = query.trim()
    ? options.filter((option) => option.name_ar.includes(query.trim()))
    : options;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="إغلاق">
              <Text style={styles.modalClose}>إغلاق</Text>
            </Pressable>
          </View>

          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="ابحث…"
            placeholderTextColor={palette.ink[400]}
            accessibilityLabel="البحث في القائمة"
          />

          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={<Text style={styles.emptyText}>لا توجد نتائج</Text>}
            renderItem={({ item }) => (
              <Pressable
                style={styles.option}
                onPress={() => {
                  setQuery('');
                  onSelect(item);
                }}
                accessibilityRole="button"
              >
                <Text style={styles.optionText}>{item.name_ar}</Text>
              </Pressable>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

/*
 * The browser draws a black rectangle over a rounded input on focus, which is
 * what made the fields look unfinished in the web preview. `outlineStyle` is
 * react-native-web's own property and is absent from React Native's style
 * types, so it is applied only where it exists.
 */
const SUPPRESS_WEB_OUTLINE = (Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) as TextStyle;

/**
 * A layered page, not a flat sheet.
 *
 * Three white inputs on a white background with the brand appearing only on
 * the submit button: nothing established depth, so every element floated at
 * the same level. A tinted page behind a white card fixes it without a new
 * colour — both values are already in the token set.
 */
const styles = lazySheet(() =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: color.surfacePage },
    scroll: { padding: space[4], paddingTop: space[8], gap: space[4] },

    header: { gap: space[2], paddingHorizontal: space[1] },
    step: { ...text.captionBold, color: BRAND[600], letterSpacing: 0.5 },
    title: { ...text.display, color: color.textPrimary },
    subtitle: { ...text.body, color: color.textMuted },

    card: {
      backgroundColor: color.surfaceCard,
      borderRadius: radius.xl,
      paddingHorizontal: space[5],
      ...shadow.sm,
    },
    row: { paddingVertical: space[4], gap: space[2] },
    divider: { height: 1, backgroundColor: color.borderSubtle },

    label: { ...text.smallBold, color: color.textSecondary },
    hint: { ...text.caption, color: color.textMuted },

    input: {
      ...text.body,
      color: color.textPrimary,
      backgroundColor: color.surfacePage,
      borderWidth: 1,
      borderColor: color.borderSubtle,
      borderRadius: radius.md,
      paddingHorizontal: space[4],
      minHeight: TAP_TARGET,
      ...SUPPRESS_WEB_OUTLINE,
    },
    inputInvalid: { borderColor: color.danger, backgroundColor: color.dangerSoft },

    select: {
      flexDirection: ROW,
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: color.surfacePage,
      borderWidth: 1,
      borderColor: color.borderSubtle,
      borderRadius: radius.md,
      paddingHorizontal: space[4],
      minHeight: TAP_TARGET,
    },
    selectPressed: { backgroundColor: color.surfaceSunken, borderColor: color.borderStrong },
    selectDisabled: { opacity: 0.55 },
    selectValue: { ...text.bodyBold, color: color.textPrimary },
    selectPlaceholder: { ...text.body, color: palette.ink[400] },
    /*
     * A chevron from the bundled face rather than an icon set.
     *
     * This screen loads no icon font, and `‹` is already in Cairo. Under forced
     * RTL the row is reversed, so it sits on the left and points outward.
     */
    chevron: { ...text.h3, color: palette.ink[400], marginTop: -2 },

    fieldError: { ...text.caption, color: color.dangerStrong },

    error: {
      ...text.smallBold,
      color: color.dangerStrong,
      backgroundColor: color.dangerSoft,
      paddingVertical: space[3],
      paddingHorizontal: space[4],
      borderRadius: radius.md,
      textAlign: 'center',
    },

    actionBar: {
      backgroundColor: color.surfaceCard,
      paddingHorizontal: space[5],
      paddingTop: space[4],
      paddingBottom: space[6],
      borderTopWidth: 1,
      borderTopColor: color.borderSubtle,
    },
    button: {
      backgroundColor: BRAND[500],
      minHeight: TAP_TARGET + 8,
      borderRadius: radius.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonPressed: { backgroundColor: BRAND[600] },
    buttonDisabled: { backgroundColor: palette.ink[200] },
    buttonText: { ...text.bodyBold, color: palette.white },

    modalBackdrop: { flex: 1, backgroundColor: 'rgba(22,24,29,0.5)', justifyContent: 'flex-end' },
    modalSheet: {
      backgroundColor: color.surfaceCard,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      padding: space[6],
      maxHeight: '80%',
      gap: space[3],
    },
    modalHeader: { flexDirection: ROW, alignItems: 'center', justifyContent: 'space-between' },
    modalTitle: { ...text.h2, color: color.textPrimary },
    modalClose: { ...text.bodyBold, color: BRAND[600] },

    option: {
      minHeight: TAP_TARGET,
      justifyContent: 'center',
      borderBottomWidth: 1,
      borderBottomColor: palette.ink[100],
    },
    optionText: { ...text.body, color: color.textPrimary },
    emptyText: { ...text.body, color: color.textMuted, textAlign: 'center', padding: space[6] },
  }),
);
