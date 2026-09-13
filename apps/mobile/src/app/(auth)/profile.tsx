import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { fullNameSchema } from '@jibli/validation';
import { api, ApiError, NetworkError, type GeographyOption } from '@/lib/api';
import { TAP_TARGET, color, palette, radius, space, text } from '@/theme';

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

  const [fullName, setFullName] = useState('');
  const [governorate, setGovernorate] = useState<GeographyOption | null>(null);
  const [city, setCity] = useState<GeographyOption | null>(null);

  const [governorates, setGovernorates] = useState<GeographyOption[]>([]);
  const [cities, setCities] = useState<GeographyOption[]>([]);
  const [loadingGovernorates, setLoadingGovernorates] = useState(true);
  const [loadingCities, setLoadingCities] = useState(false);

  const [picker, setPicker] = useState<'governorate' | 'city' | null>(null);
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
      router.replace('/(tabs)');
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
          router.replace('/(tabs)');
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>أكمل معلوماتك</Text>
        <Text style={styles.subtitle}>نحتاج هذه المعلومات لعرض المطاعم القريبة منك</Text>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>الاسم الكامل</Text>
        <TextInput
          style={styles.input}
          value={fullName}
          onChangeText={setFullName}
          placeholder="محمد علي"
          placeholderTextColor={palette.ink[400]}
          accessibilityLabel="الاسم الكامل"
          editable={!isSubmitting}
        />
        {fullName.length > 0 && !nameResult.success ? (
          <Text style={styles.fieldError}>
            {nameResult.error.issues[0]?.message ?? 'الاسم غير صالح'}
          </Text>
        ) : null}
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>المحافظة</Text>
        <Pressable
          style={styles.select}
          onPress={() => setPicker('governorate')}
          disabled={loadingGovernorates || isSubmitting}
          accessibilityRole="button"
          accessibilityLabel={`المحافظة: ${governorate?.name_ar ?? 'لم يتم الاختيار'}`}
        >
          {loadingGovernorates ? (
            <ActivityIndicator color={color.brand} />
          ) : (
            <Text style={governorate ? styles.selectValue : styles.selectPlaceholder}>
              {governorate?.name_ar ?? 'اختر المحافظة'}
            </Text>
          )}
        </Pressable>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>المدينة</Text>
        <Pressable
          style={[styles.select, !governorate && styles.selectDisabled]}
          onPress={() => setPicker('city')}
          // A city cannot be chosen before its parent: that is what keeps the
          // pair consistent before it ever reaches the server.
          disabled={!governorate || loadingCities || isSubmitting}
          accessibilityRole="button"
          accessibilityLabel={`المدينة: ${city?.name_ar ?? 'لم يتم الاختيار'}`}
          accessibilityHint={!governorate ? 'اختر المحافظة أولاً' : undefined}
        >
          {loadingCities ? (
            <ActivityIndicator color={color.brand} />
          ) : (
            <Text style={city ? styles.selectValue : styles.selectPlaceholder}>
              {city?.name_ar ?? (governorate ? 'اختر المدينة' : 'اختر المحافظة أولاً')}
            </Text>
          )}
        </Pressable>
        {governorate && !loadingCities && cities.length === 0 ? (
          <Text style={styles.fieldError}>
            لا توجد مدن متاحة للتسجيل في هذه المحافظة حالياً
          </Text>
        ) : null}
      </View>

      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <Pressable
        style={[styles.button, !canSubmit && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={!canSubmit}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit, busy: isSubmitting }}
      >
        {isSubmitting ? (
          <ActivityIndicator color={palette.white} />
        ) : (
          <Text style={styles.buttonText}>متابعة</Text>
        )}
      </Pressable>

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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surfaceCard, padding: space[6], gap: space[4] },
  header: { gap: space[1], marginTop: space[8] },
  title: { ...text.h1, color: color.textPrimary },
  subtitle: { ...text.body, color: color.textMuted },

  field: { gap: space[2] },
  label: { ...text.bodyBold, color: color.textPrimary },
  input: {
    ...text.body,
    color: color.textPrimary,
    borderWidth: 1,
    borderColor: color.borderSubtle,
    borderRadius: radius.md,
    backgroundColor: palette.ink[50],
    paddingHorizontal: space[4],
    minHeight: TAP_TARGET,
    textAlign: 'right',
  },
  fieldError: { ...text.small, color: color.danger },

  select: {
    borderWidth: 1,
    borderColor: color.borderSubtle,
    borderRadius: radius.md,
    backgroundColor: palette.ink[50],
    paddingHorizontal: space[4],
    minHeight: TAP_TARGET,
    justifyContent: 'center',
  },
  selectDisabled: { opacity: 0.5 },
  selectValue: { ...text.body, color: color.textPrimary },
  selectPlaceholder: { ...text.body, color: palette.ink[400] },

  error: {
    ...text.small,
    color: color.danger,
    backgroundColor: color.dangerSoft,
    padding: space[3],
    borderRadius: radius.sm,
  },

  button: {
    backgroundColor: color.brand,
    minHeight: TAP_TARGET + 8,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 'auto',
    marginBottom: space[6],
  },
  buttonDisabled: { backgroundColor: palette.ink[300] },
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
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { ...text.h2, color: color.textPrimary },
  modalClose: { ...text.bodyBold, color: color.brandStrong },

  option: {
    minHeight: TAP_TARGET,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: palette.ink[100],
  },
  optionText: { ...text.body, color: color.textPrimary },
  emptyText: { ...text.body, color: color.textMuted, textAlign: 'center', padding: space[6] },
});
