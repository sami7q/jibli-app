import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { api, ApiError, type Address, type GeographyOption } from '@/lib/api';
import { useArea, type DeliveryArea } from '@/lib/area';
import {
  captureCurrentLocation,
  describePlace,
  hasLocationPermission,
  LOCATION_MESSAGES_AR,
  type Coordinates,
} from '@/lib/location';
import { notify } from '@/lib/dialog';
import { color, radius, space, TAP_TARGET, TEXT_START, text } from '@/theme';
import { Button, Row, Text } from '@/ui';
import { MapPicker } from '@/ui/map-picker';
import { AreaChoice, areaStepTitle } from '@/ui/area-choice';
import { Sheet } from '@/ui/catalog';

/**
 * The whole address, in one sheet.
 *
 * It used to be two half-answers in two places. «منطقة التوصيل» in حسابي asked
 * for a governorate and a city and stopped there — but a city is not an
 * address, and a courier handed one has been told the country. The details and
 * the map lived in checkout, which meant the only moment a customer could
 * describe where they live was the moment they were trying to pay for food.
 * Almost nobody did, so almost no address had anything on it.
 *
 * So one sheet asks all of it, in the order somebody can actually answer: which
 * city, where the phone says they are standing, and then the things only they
 * know — the alley, the landmark, which floor, the bell that does not work.
 *
 * **The map opens where the customer is.** Before, it opened on Tahrir Square
 * at a zoom where a house is one building among four hundred. Now, when the
 * permission has already been granted, the sheet takes a fix before it draws,
 * opens on it at building zoom, and offers the phone's own guess at the
 * district into the empty fields.
 *
 * Every one of those is a starting point, not an answer. A phone indoors is
 * routinely fifty metres out, a reverse geocode in Baghdad names a street the
 * customer would not, and neither can know «قرب صيدلية النور». The map is
 * draggable, the fields are editable, and nothing typed is ever overwritten.
 */

/**
 * Below which two coordinates are the same place: 1e-5 degrees, about 1.1 m.
 *
 * Small enough that a real correction is never mistaken for an echo — nobody
 * adjusts a pin by a metre — and large enough to absorb the rounding Leaflet
 * does when it converts its centre pixel back to a latitude.
 */
const SAME_POINT_DEGREES = 1e-5;

export function AddressSheet({
  visible,
  onClose,
  onSaved,
  title = 'عنوان جديد',
  address,
  initialArea,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onSaved: (addressId: string) => void;
  readonly title?: string;
  /**
   * The address being replaced, if this is an edit.
   *
   * There is no update endpoint: saving writes a new default and retires this
   * row. Historical orders keep pointing at it, which is why the delete is soft
   * and why editing is safe.
   */
  readonly address?: Address | null;
  /**
   * The area to start from when there is no saved one to read — the city a new
   * customer chose thirty seconds ago on the profile screen, before the session
   * has caught up with it.
   */
  readonly initialArea?: DeliveryArea | null;
}) {
  const { area: currentArea, setArea } = useArea();

  const [step, setStep] = useState<'form' | 'area'>('form');
  const [governorate, setGovernorate] = useState<GeographyOption | null>(null);

  const [area, setLocalArea] = useState<DeliveryArea | null>(null);
  const [label, setLabel] = useState('المنزل');
  const [district, setDistrict] = useState('');
  const [street, setStreet] = useState('');
  const [building, setBuilding] = useState('');
  const [floor, setFloor] = useState('');
  const [landmark, setLandmark] = useState('');
  const [notes, setNotes] = useState('');

  /**
   * The point on the address.
   *
   * `null` means nobody has chosen one — and the map is careful to leave it
   * null rather than reporting wherever it happened to open. Everything still
   * works without it: in a city addressed by landmarks, «قرب صيدلية النور» is
   * what gets the driver there, and the courier's link falls back to searching
   * the text. What must never happen is a confident wrong point.
   */
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [locating, setLocating] = useState(false);

  /**
   * Whether the sheet has already tried to open on the customer's position.
   *
   * Once per opening, not once per render — and reset on close so the next
   * address starts from wherever the customer is *then*, which for a second
   * address is usually somewhere else entirely.
   */
  const autoLocated = useRef(false);

  /*
   * Everything resets to the address being edited each time the sheet opens.
   *
   * On open rather than on close: emptying the form as it slides away looks
   * like the answer was thrown out.
   */
  useEffect(() => {
    if (!visible) {
      autoLocated.current = false;
      return;
    }

    setStep('form');
    setGovernorate(null);
    setLocalArea(
      address
        ? {
            governorateId: address.governorate.id,
            governorateNameAr: address.governorate.name_ar,
            cityId: address.city.id,
            cityNameAr: address.city.name_ar,
          }
        : /*
           * The explicit choice wins over the remembered one. `initialArea` is
           * passed only by the signup screen, where the customer picked a city
           * thirty seconds ago — and a guest who had browsed somewhere else
           * first would otherwise have that stale area override it.
           */
          (initialArea ?? currentArea ?? null),
    );
    setLabel(address?.label ?? 'المنزل');
    setDistrict(address?.district_text ?? '');
    setStreet(address?.street ?? '');
    setBuilding(address?.building ?? '');
    setFloor(address?.floor ?? '');
    setLandmark(address?.landmark ?? '');
    setNotes(address?.delivery_notes ?? '');
    setCoordinates(
      address?.latitude != null && address.longitude != null
        ? { latitude: address.latitude, longitude: address.longitude, accuracy: null }
        : null,
    );
    // Deliberately keyed on the opening alone. `currentArea` and `initialArea`
    // are read here and not followed: reacting to them afterwards would
    // overwrite the city the customer picked inside the sheet.
  }, [visible, address]);

  /**
   * Take a fix, and offer what the phone thinks is there.
   *
   * `announce` separates the two callers. The button means somebody asked, so a
   * failure gets a message; the automatic attempt on open did not, and a toast
   * nobody provoked is noise.
   */
  const locate = useCallback(async (announce: boolean) => {
    setLocating(true);
    const outcome = await captureCurrentLocation();

    if (outcome.status !== 'ok') {
      setLocating(false);
      if (announce) notify('تحديد الموقع', LOCATION_MESSAGES_AR[outcome.status]);
      return;
    }

    setCoordinates(outcome.coordinates);

    /*
     * Into what is empty, and nothing else.
     *
     * The geocoder's «شارع ٥٢» is a guess, and a guess must never land on top
     * of the sentence somebody typed about their own street. Checked against
     * the value at the moment the answer arrives, because a second or two has
     * passed and they may well have started typing in it.
     */
    const place = await describePlace(outcome.coordinates);
    if (place?.district) {
      const suggested = place.district;
      setDistrict((value) => (value.trim() ? value : suggested));
    }
    if (place?.street) {
      const suggested = place.street;
      setStreet((value) => (value.trim() ? value : suggested));
    }

    setLocating(false);
  }, []);

  useEffect(() => {
    if (!visible || step !== 'form') return;
    if (autoLocated.current || coordinates) return;
    autoLocated.current = true;

    void (async () => {
      /*
       * Only when the answer is already yes.
       *
       * `captureCurrentLocation` raises the system dialog, and a permission
       * prompt that appears because a sheet opened — rather than because
       * somebody pressed something — is the one every customer denies. The home
       * screen and the signup flow ask once, deliberately; this reads that
       * answer.
       */
      if (!(await hasLocationPermission())) return;
      await locate(false);
    })();
  }, [visible, step, coordinates, locate]);

  /*
   * The map moved, so the pin moved.
   *
   * A point chosen by hand has no accuracy figure and should not borrow one
   * from a GPS fix that is no longer what is being saved — `null` says «this is
   * where somebody pointed», which is the honest thing for the driver's screen
   * to receive.
   *
   * Unless the map is only echoing back the point it was handed. It reports its
   * opening position so that somebody already in the right place can just save,
   * and when that position came from the GPS a moment earlier, taking the echo
   * at face value would throw the accuracy away.
   */
  const pickOnMap = useCallback((next: { latitude: number; longitude: number }) => {
    setCoordinates((current) =>
      current &&
      Math.abs(current.latitude - next.latitude) < SAME_POINT_DEGREES &&
      Math.abs(current.longitude - next.longitude) < SAME_POINT_DEGREES
        ? current
        : { latitude: next.latitude, longitude: next.longitude, accuracy: null },
    );
  }, []);

  const areaMoved = useMemo(
    () => Boolean(area) && area?.cityId !== currentArea?.cityId,
    [area, currentArea],
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!area) throw new Error('no area');

      const created = await api.createAddress({
        label,
        governorate_id: area.governorateId,
        city_id: area.cityId,
        ...(district.trim() ? { district_text: district.trim() } : {}),
        ...(street.trim() ? { street: street.trim() } : {}),
        ...(building.trim() ? { building: building.trim() } : {}),
        ...(floor.trim() ? { floor: floor.trim() } : {}),
        ...(landmark.trim() ? { landmark: landmark.trim() } : {}),
        ...(notes.trim() ? { delivery_notes: notes.trim() } : {}),
        ...(coordinates
          ? { coordinates: { latitude: coordinates.latitude, longitude: coordinates.longitude } }
          : {}),
        is_default: true,
      });

      /*
       * Retire the row this one replaces, after the replacement exists.
       *
       * In that order because `POST` clears the previous default inside its own
       * transaction: the customer is never left without one, and a delete that
       * fails costs a stale row in a list rather than an address.
       */
      if (address) await api.deleteAddress(address.id).catch(() => undefined);

      // Where they are having it delivered is where they are ordering from.
      if (areaMoved) await setArea(area);

      return created;
    },
    onSuccess: (created) => onSaved(created.id),
    onError: (error) => {
      notify('تعذّر حفظ العنوان', error instanceof ApiError ? error.messageAr : 'حاول مرة أخرى.');
    },
  });

  const canSave = Boolean(area) && district.trim().length > 0 && !save.isPending;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={step === 'area' ? areaStepTitle(governorate) : title}
      footer={
        step === 'form' ? (
          <Button
            label={address ? 'حفظ التعديل' : 'حفظ العنوان'}
            block
            disabled={!canSave}
            loading={save.isPending}
            onPress={() => save.mutate()}
          />
        ) : undefined
      }
    >
      {step === 'area' ? (
        <AreaChoice
          governorate={governorate}
          onGovernorate={setGovernorate}
          selected={area ? { governorateId: area.governorateId, cityId: area.cityId } : null}
          onChoose={(chosen, city) => {
            setLocalArea({
              governorateId: chosen.id,
              governorateNameAr: chosen.name_ar,
              cityId: city.id,
              cityNameAr: city.name_ar,
            });
            setStep('form');
          }}
        />
      ) : (
        <>
          {/*
           * The city, as a row that can be changed rather than a line of text.
           *
           * It was read-only here and editable only from another screen, so a
           * customer whose city was wrong had to abandon the address they were
           * in the middle of writing in order to fix it.
           */}
          <Pressable
            onPress={() => {
              setGovernorate(null);
              setStep('area');
            }}
            accessibilityRole="button"
            accessibilityLabel={`المنطقة: ${area ? `${area.governorateNameAr} — ${area.cityNameAr}` : 'لم تُحدَّد'}`}
            style={({ pressed }) => [
              {
                minHeight: TAP_TARGET + 6,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: area ? color.borderSubtle : color.danger,
                backgroundColor: color.surfaceCard,
                paddingHorizontal: space[3],
                justifyContent: 'center',
              },
              pressed ? { opacity: 0.7 } : null,
            ]}
          >
            <Row justify="space-between">
              <Row gap={space[2]}>
                <MaterialCommunityIcons name="city-variant-outline" size={20} color={color.brand} />
                <View style={{ gap: 2 }}>
                  <Text variant="caption" tone="muted">
                    المحافظة والمدينة
                  </Text>
                  <Text variant="smallBold" tone={area ? 'primary' : 'danger'}>
                    {area ? `${area.governorateNameAr} — ${area.cityNameAr}` : 'اختر منطقتك'}
                  </Text>
                </View>
              </Row>
              <MaterialCommunityIcons name="chevron-left" size={20} color={color.textMuted} />
            </Row>
          </Pressable>

          {/*
           * The map, before the fields.
           *
           * «قرب صيدلية النور» is only unambiguous to somebody who already knows
           * the street. A point is what turns it into an address a courier can
           * reach without phoning, and this is where it gets set: the map opens
           * on the customer, the pin stays in the middle, and what is under it
           * is saved with the order and handed to the driver as a navigation
           * link.
           */}
          <MapPicker
            latitude={coordinates?.latitude ?? null}
            longitude={coordinates?.longitude ?? null}
            onPick={pickOnMap}
          />

          <Pressable
            onPress={() => void locate(true)}
            disabled={locating}
            accessibilityRole="button"
            accessibilityLabel="تحديد موقعي الحالي"
            style={({ pressed }) => [
              {
                minHeight: TAP_TARGET + 6,
                borderRadius: radius.md,
                borderWidth: 1,
                borderStyle: coordinates ? 'solid' : 'dashed',
                borderColor: coordinates ? color.success : color.borderStrong,
                backgroundColor: coordinates ? color.successSoft : color.surfaceCard,
                paddingHorizontal: space[3],
                justifyContent: 'center',
              },
              pressed ? { opacity: 0.7 } : null,
            ]}
          >
            <Row gap={space[2]}>
              <MaterialCommunityIcons
                name={coordinates ? 'map-marker-check' : 'crosshairs-gps'}
                size={20}
                color={coordinates ? color.successStrong : color.brand}
              />
              <View style={{ flex: 1 }}>
                <Text variant="smallBold" tone={coordinates ? 'success' : 'brand'}>
                  {locating
                    ? 'جارٍ تحديد الموقع…'
                    : coordinates
                      ? 'تم تثبيت المنزل على الخريطة'
                      : 'استخدم موقعي الحالي'}
                </Text>
                <Text variant="caption" tone="muted">
                  {coordinates
                    ? coordinates.accuracy
                      ? `دقة تقريبية ${Math.round(coordinates.accuracy)} متر — اسحب الخريطة للتصحيح`
                      : 'اسحب الخريطة لضبط الدبوس بدقة'
                    : 'فعّل الموقع ليفتح الدبوس على مكانك مباشرة'}
                </Text>
              </View>
            </Row>
          </Pressable>

          <LabelledInput
            label="اسم العنوان"
            value={label}
            onChangeText={setLabel}
            placeholder="المنزل، العمل…"
          />
          <LabelledInput
            label="المنطقة / الحي"
            value={district}
            onChangeText={setDistrict}
            placeholder="المنصور، حي الجامعة…"
          />
          <LabelledInput
            label="الشارع أو الزقاق"
            value={street}
            onChangeText={setStreet}
            placeholder="شارع ١٤ رمضان، زقاق ٣٢"
          />

          {/*
           * Two short answers on one line.
           *
           * A house number and a floor are three characters each; giving them a
           * full row apiece is what turns a form into a page nobody finishes.
           */}
          <Row gap={space[3]} align="flex-start">
            <View style={{ flex: 1 }}>
              <LabelledInput
                label="رقم الدار"
                value={building}
                onChangeText={setBuilding}
                placeholder="١٢/٤"
              />
            </View>
            <View style={{ flex: 1 }}>
              <LabelledInput
                label="الطابق"
                value={floor}
                onChangeText={setFloor}
                placeholder="الثاني"
              />
            </View>
          </Row>

          <LabelledInput
            label="أقرب نقطة دالة"
            value={landmark}
            onChangeText={setLandmark}
            placeholder="قرب صيدلية النور"
          />
          <LabelledInput
            label="ملاحظات للمندوب"
            value={notes}
            onChangeText={setNotes}
            placeholder="الجرس لا يعمل، اتصل عند الوصول"
          />
        </>
      )}
    </Sheet>
  );
}

function LabelledInput({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
}) {
  return (
    <View style={{ gap: space[1] }}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={color.textMuted}
        accessibilityLabel={label}
        style={[
          text.small,
          {
            minHeight: TAP_TARGET,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: color.borderSubtle,
            backgroundColor: color.surfaceCard,
            paddingHorizontal: space[3],
            color: color.textPrimary,
            textAlign: TEXT_START,
          },
        ]}
      />
    </View>
  );
}
