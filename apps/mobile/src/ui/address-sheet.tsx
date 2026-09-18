import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
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
import { lookupArea, metresBetween } from '@/lib/place-match';
import { notify } from '@/lib/dialog';
import { color, radius, space, TAP_TARGET, TEXT_START, text } from '@/theme';
import { Button, Row, Text } from '@/ui';
import { MapPicker } from '@/ui/map-picker';
import { AreaChoice, areaStepTitle } from '@/ui/area-choice';
import { Sheet } from '@/ui/catalog';

/**
 * The address, as a pin and a sentence.
 *
 * It asked seven questions before this — name, district, street, house number,
 * floor, landmark, a note for the courier — which is a form, and a form is what
 * people abandon. Everything on it was trying to describe a place that the pin
 * already identifies to the metre. So the pin is the address now, and the only
 * thing left to type is the part a map cannot show: which gate, which floor,
 * the bell that does not work.
 *
 * **The city is read off the pin, not off the profile.** That was a live bug
 * and a serious one. The form took the governorate and city from the
 * customer's profile while taking the point from their phone, so standing in
 * حديثة with بغداد on the profile produced an address whose city said Baghdad
 * and whose pin was two hundred kilometres up the Euphrates — an order the API
 * accepts, because Baghdad is open, and a courier sent somewhere nobody
 * delivers. The phone's geocoder names the place and `lookupArea` turns that
 * name into one of Jibli's own cities; it follows the pin when the pin moves.
 *
 * What it will not do is guess, and it is careful about which failure it
 * reports. «We could not read your city» and «we do not deliver to your city»
 * are different facts, and the first dressed as the second is what told a
 * customer standing in حديثة — an open city, reached by a courier every day —
 * that Jibli does not come there. Only a place that was positively identified
 * and is positively not served earns that sentence.
 */

/**
 * Below which two coordinates are the same place: 1e-5 degrees, about 1.1 m.
 *
 * Small enough that a real correction is never mistaken for an echo — nobody
 * adjusts a pin by a metre — and large enough to absorb the rounding Leaflet
 * does when it converts its centre pixel back to a latitude.
 */
const SAME_POINT_DEGREES = 1e-5;

/**
 * How far the pin must travel before the city is looked up again: 300 m.
 *
 * Nudging the pin onto the right doorway must not cost a geocoder call, and
 * dragging it across town must not leave the old city sitting under it. No
 * Iraqi city boundary is decided by 300 m of a customer's dragging.
 */
const RESOLVE_AGAIN_AFTER_M = 300;

/** Long enough for a drag to finish before anything is asked about it. */
const SETTLE_MS = 700;

export function AddressSheet({
  visible,
  onClose,
  onSaved,
  title = 'ثبّت منزلك',
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
   * The area to fall back to before the pin has said anything — the city a new
   * customer chose thirty seconds ago on the profile screen.
   */
  readonly initialArea?: DeliveryArea | null;
}) {
  const { area: currentArea, setArea } = useArea();

  const [step, setStep] = useState<'form' | 'area'>('form');
  const [governorate, setGovernorate] = useState<GeographyOption | null>(null);

  const [area, setLocalArea] = useState<DeliveryArea | null>(null);
  /**
   * Where the city came from, which is the difference between a fact and a
   * leftover — and, in two of these cases, the difference between «we could not
   * tell» and «we do not deliver there». Reporting the first as the second is
   * what told a customer standing in حديثة, an open city, that Jibli does not
   * reach them.
   */
  const [source, setSource] = useState<
    'carried' | 'chosen' | 'pin' | 'narrow' | 'outside' | 'unknown'
  >('carried');
  /** The place the geocoder named, when it is worth repeating back. */
  const [detectedPlace, setDetectedPlace] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  /** The geocoder's neighbourhood, kept for the address list rather than shown. */
  const [districtHint, setDistrictHint] = useState<string | null>(null);

  /**
   * The point on the address.
   *
   * `null` means nobody has chosen one — and the map is careful to leave it
   * null rather than reporting wherever it happened to open. A wrong point is
   * worse than none, because none still falls back to searching the text.
   */
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [locating, setLocating] = useState(false);
  const [resolving, setResolving] = useState(false);

  /** Once per opening, not once per render. */
  const autoLocated = useRef(false);
  /** The last point the city was looked up for, so a nudge costs nothing. */
  const lastResolved = useRef<{ latitude: number; longitude: number } | null>(null);
  /**
   * The selected area, readable from inside the lookup.
   *
   * A governorate-only answer has to be weighed against what is already
   * selected — «you are in الأنبار» agrees with حديثة and disagrees with بغداد
   * — and the callback that receives it must not be rebuilt every time the area
   * changes, or the settle timer restarts on its own state.
   */
  const areaRef = useRef<DeliveryArea | null>(null);

  /**
   * Every city the platform serves, in one request.
   *
   * Matching a pin has to consider all of them at once, and `ordering` is the
   * right list for a delivery address: a city we cannot deliver to is not an
   * answer to «where shall we bring it».
   */
  const tree = useQuery({
    queryKey: ['geography', 'tree', 'ordering'],
    queryFn: () => api.geographyTree('ordering'),
    staleTime: 30 * 60_000,
    enabled: visible,
  });

  /*
   * Everything resets each time the sheet opens, not when it closes: a form
   * that empties itself as it slides away looks like the answer was thrown out.
   */
  useEffect(() => {
    if (!visible) {
      autoLocated.current = false;
      lastResolved.current = null;
      return;
    }

    setStep('form');
    setGovernorate(null);
    setSource('carried');
    setDetectedPlace(null);
    setLocalArea(
      address
        ? {
            governorateId: address.governorate.id,
            governorateNameAr: address.governorate.name_ar,
            cityId: address.city.id,
            cityNameAr: address.city.name_ar,
          }
        : // The explicit choice wins over the remembered one: `initialArea`
          // comes from the signup screen, where a city was picked seconds ago.
          (initialArea ?? currentArea ?? null),
    );
    setDescription(address?.landmark ?? '');
    setDistrictHint(address?.district_text ?? null);
    setCoordinates(
      address?.latitude != null && address.longitude != null
        ? { latitude: address.latitude, longitude: address.longitude, accuracy: null }
        : null,
    );
    // Deliberately keyed on the opening alone: reacting to the area afterwards
    // would overwrite what the pin, or the customer, has since said.
  }, [visible, address]);

  useEffect(() => {
    areaRef.current = area;
  }, [area]);

  /** Read the city under a point, and the neighbourhood if there is one. */
  const resolveFrom = useCallback(
    async (point: { latitude: number; longitude: number }) => {
      const branches = tree.data;
      if (!branches) return;

      setResolving(true);
      const place = await describePlace(point);
      setResolving(false);
      // No geocoder on this platform — the browser preview, mostly. The area
      // that is already there stays, and the row below it can still be tapped.
      if (!place) return;

      if (place.district) setDistrictHint(place.district);

      const found = lookupArea(place.names, branches);

      if (found.status === 'matched') {
        setLocalArea(found.area);
        setDetectedPlace(null);
        setSource('pin');
        return;
      }

      if (found.status === 'governorate') {
        /*
         * The governorate is certain and the city is not. If what is already
         * selected sits inside it, the pin and the selection agree and there is
         * nothing to ask — that is the common case for somebody who set their
         * city once and has not moved governorate since.
         */
        setDetectedPlace(found.governorateNameAr);
        setSource(
          areaRef.current?.governorateId === found.governorateId ? 'pin' : 'narrow',
        );
        return;
      }

      /*
       * The area is left exactly as it was for both of the remaining answers,
       * because neither of them names a city to replace it with. What changes
       * is what the screen says — and these two must never say the same thing.
       */
      setDetectedPlace(found.status === 'outside' ? found.placeNameAr : null);
      setSource(found.status);
    },
    [tree.data],
  );

  /** Take a fix. `announce` is the difference between a press and an attempt. */
  const locate = useCallback(async (announce: boolean) => {
    setLocating(true);
    const outcome = await captureCurrentLocation();
    setLocating(false);

    if (outcome.status !== 'ok') {
      if (announce) notify('تحديد الموقع', LOCATION_MESSAGES_AR[outcome.status]);
      return;
    }
    setCoordinates(outcome.coordinates);
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
   * The city follows the pin, once the pin has stopped moving.
   *
   * On settle rather than on every frame, and only when it has actually gone
   * somewhere: a drag across Baghdad fires `moveend` a dozen times, and asking
   * the geocoder each time would be a dozen questions with one answer.
   */
  useEffect(() => {
    if (!visible || !coordinates || !tree.data) return;
    if (
      lastResolved.current &&
      metresBetween(lastResolved.current, coordinates) < RESOLVE_AGAIN_AFTER_M
    ) {
      return;
    }

    const point = { latitude: coordinates.latitude, longitude: coordinates.longitude };
    const timer = setTimeout(() => {
      lastResolved.current = point;
      void resolveFrom(point);
    }, SETTLE_MS);

    return () => clearTimeout(timer);
  }, [visible, coordinates, tree.data, resolveFrom]);

  /*
   * The map moved, so the pin moved — unless it is only echoing back the point
   * it was handed. It reports its opening position so somebody already in the
   * right place can just save, and taking that echo at face value would throw
   * away the accuracy figure the GPS came with.
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

  const save = useMutation({
    mutationFn: async () => {
      if (!area) throw new Error('no area');

      const created = await api.createAddress({
        label: address?.label ?? 'المنزل',
        governorate_id: area.governorateId,
        city_id: area.cityId,
        ...(districtHint ? { district_text: districtHint } : {}),
        ...(description.trim() ? { landmark: description.trim() } : {}),
        /*
         * Carried through rather than asked for.
         *
         * The street, house number, floor and courier note are no longer on
         * this form, but the driver's screen still prints them and an address
         * saved before the form was simplified may well have them. Dropping
         * them on an unrelated edit would quietly delete something useful.
         */
        ...(address?.street ? { street: address.street } : {}),
        ...(address?.building ? { building: address.building } : {}),
        ...(address?.floor ? { floor: address.floor } : {}),
        ...(address?.delivery_notes ? { delivery_notes: address.delivery_notes } : {}),
        ...(coordinates
          ? { coordinates: { latitude: coordinates.latitude, longitude: coordinates.longitude } }
          : {}),
        is_default: true,
      });

      /*
       * Retire the row this one replaces, after the replacement exists, because
       * `POST` clears the previous default inside its own transaction: the
       * customer is never left without one, and a failed delete costs a stale
       * row rather than an address.
       */
      if (address) await api.deleteAddress(address.id).catch(() => undefined);

      // Where it is being delivered is where they are ordering from. Without
      // this, the pin says حديثة and the storefront still lists Baghdad.
      if (area.cityId !== currentArea?.cityId) await setArea(area);

      return created;
    },
    onSuccess: (created) => onSaved(created.id),
    onError: (error) => {
      notify('تعذّر حفظ العنوان', error instanceof ApiError ? error.messageAr : 'حاول مرة أخرى.');
    },
  });

  /*
   * A pin is enough. A description alone is enough too — somebody who refused
   * the location permission and will not drag a map still has «قرب صيدلية
   * النور», which is how the city has always been addressed.
   */
  const canSave =
    Boolean(area) && (coordinates !== null || description.trim().length > 0) && !save.isPending;

  /*
   * Red is for something the customer has to act on, and nothing else.
   *
   * Not knowing the name of a place says nothing about whether Jibli delivers
   * there, and the city carried over may well be right — alarming somebody
   * about it is how «لا نوصّل إلى موقعك» ended up on the screen of a customer
   * standing in a city that is open.
   */
  const needsAttention = !area || source === 'narrow' || source === 'outside';

  const cityNote = resolving
    ? 'جارٍ قراءة المدينة من الموقع…'
    : source === 'pin'
      ? 'من موقعك على الخريطة'
      : source === 'narrow'
        ? `موقعك في ${detectedPlace ?? 'محافظة أخرى'} — اختر مدينتك`
        : source === 'outside'
          ? `لا نوصّل إلى ${detectedPlace ?? 'موقعك'} بعد`
          : source === 'unknown'
            ? 'تعذّر قراءة المدينة من الموقع — تأكد منها'
            : source === 'chosen'
              ? 'اخترتها بنفسك'
              : 'اضغط للتغيير';

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={step === 'area' ? areaStepTitle(governorate) : title}
      footer={
        step === 'form' ? (
          <Button
            label="حفظ العنوان"
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
            setSource('chosen');
            setStep('form');
          }}
        />
      ) : (
        <>
          {/*
           * The map first, because the map is the address.
           *
           * It opens on the customer, the pin stays in the middle, and what is
           * under it is saved with the order and handed to the courier as a
           * navigation link.
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

          {/*
           * The city, read off the pin.
           *
           * Shown rather than asked, because the pin already answers it — and
           * tappable, because a geocoder can be wrong and because there is no
           * geocoder at all in a browser. The line underneath says where the
           * answer came from, so «بغداد» sitting under a pin in الأنبار can
           * never look like a confirmed fact again.
           */}
          <Pressable
            onPress={() => {
              setGovernorate(null);
              setStep('area');
            }}
            accessibilityRole="button"
            accessibilityLabel={`المدينة: ${area ? `${area.governorateNameAr} — ${area.cityNameAr}` : 'لم تُحدَّد'} — اضغط للتغيير`}
            style={({ pressed }) => [
              {
                minHeight: TAP_TARGET + 6,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: needsAttention ? color.danger : color.borderSubtle,
                backgroundColor: color.surfaceCard,
                paddingHorizontal: space[3],
                justifyContent: 'center',
              },
              pressed ? { opacity: 0.7 } : null,
            ]}
          >
            <Row justify="space-between">
              <Row gap={space[2]}>
                <MaterialCommunityIcons
                  name="map-marker-radius-outline"
                  size={20}
                  color={needsAttention ? color.dangerStrong : color.brand}
                />
                <View style={{ gap: 2, flex: 1 }}>
                  <Text variant="smallBold" tone={needsAttention ? 'danger' : 'primary'}>
                    {area ? `${area.governorateNameAr} — ${area.cityNameAr}` : 'اختر مدينتك'}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {cityNote}
                  </Text>
                </View>
              </Row>
              <MaterialCommunityIcons name="chevron-left" size={20} color={color.textMuted} />
            </Row>
          </Pressable>

          {/*
           * The one thing left to type.
           *
           * Everything the old form asked — street, house number, floor — was
           * an attempt to say where a pin already says. What a pin cannot say
           * is which of the three doors is yours, so that is what is asked,
           * once, in the customer's own words.
           */}
          <View style={{ gap: space[1] }}>
            <Text variant="caption" tone="muted">
              وصف المكان للمندوب
            </Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="قرب صيدلية النور، الباب الأزرق، الطابق الثاني"
              placeholderTextColor={color.textMuted}
              accessibilityLabel="وصف المكان للمندوب"
              multiline
              style={[
                text.small,
                {
                  minHeight: TAP_TARGET + 18,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: color.borderSubtle,
                  backgroundColor: color.surfaceCard,
                  paddingHorizontal: space[3],
                  paddingTop: space[3],
                  paddingBottom: space[3],
                  color: color.textPrimary,
                  textAlign: TEXT_START,
                  textAlignVertical: 'top',
                },
              ]}
            />
          </View>
        </>
      )}
    </Sheet>
  );
}
