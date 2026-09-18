import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import MaterialCommunityIcons from '@/ui/icon';
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
import { loadPreferredAddressId, savePreferredAddressId } from '@/lib/preferred-address';
import { color, radius, space, TAP_TARGET, TEXT_START, text } from '@/theme';
import { Button, ErrorState, Row, Text } from '@/ui';
import { MapPicker } from '@/ui/map-picker';
import { AreaChoice, areaStepTitle } from '@/ui/area-choice';
import { Sheet } from '@/ui/catalog';

/**
 * Addresses: the list, the form, and the city — in one sheet, deliberately.
 *
 * **One `Modal`, and that is the whole architecture of this file.** The list
 * used to live in its own sheet and open the form in a second one, and the
 * delete button asked `confirmAsync`, which draws a third. On iOS a modal
 * presented while another is already presenting does not appear — it fails
 * silently — so «تعديل» did nothing, «حذف» did nothing, and the dialog queue
 * was left with `showing = true` and no dialog on screen, which killed every
 * confirmation and every error message in the app until it was restarted. That
 * is what «التطبيق يجمد» was.
 *
 * So there is one sheet with three steps, and nothing inside it is allowed to
 * open a dialog. Deleting asks in the row itself, and failures are written into
 * the sheet rather than thrown at a global alert that cannot be drawn.
 *
 * What the steps are for:
 *
 *   list — the customer's own addresses, because «التوصيل إلى» used to open a
 *          catalogue of Iraq and ask them to find themselves in it, after they
 *          had already pinned their home on a map
 *   form — a pin and a sentence; everything else a form used to ask is a worse
 *          description of what the pin already says to the metre
 *   area — the governorate list, kept as the correction for a misread city
 *
 * **The city is read off the pin, not off the profile.** Standing in حديثة with
 * بغداد on the profile used to produce an address whose city said Baghdad and
 * whose pin was two hundred kilometres up the Euphrates — an order the API
 * accepts and a courier sent where nobody delivers. And it is careful about
 * which failure it reports: «we could not read your city» and «we do not
 * deliver to your city» are different facts, and the first dressed as the
 * second told a customer in an open city that Jibli does not come there.
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
 * dragging it across town must not leave the old city sitting under it.
 */
const RESOLVE_AGAIN_AFTER_M = 300;

/** Long enough for a drag to finish before anything is asked about it. */
const SETTLE_MS = 700;

export function AddressSheet({
  visible,
  onClose,
  onSaved,
  start = 'form',
  title,
  address,
  initialArea,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
  /** Fired after a save, with the new id. The list stays open; a lone form closes. */
  readonly onSaved?: (addressId: string) => void;
  /** Which step to open on. `list` for «التوصيل إلى», `form` for «أضف عنوانك». */
  readonly start?: 'list' | 'form';
  /** The title of the opening step; later steps title themselves. */
  readonly title?: string;
  /** Open straight into editing this address. Only meaningful with `start: 'form'`. */
  readonly address?: Address | null;
  /**
   * The area to fall back to before the pin has said anything — the city a new
   * customer chose thirty seconds ago on the profile screen.
   */
  readonly initialArea?: DeliveryArea | null;
}) {
  const { area: currentArea, setArea } = useArea();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<'list' | 'form' | 'area'>(start);
  /** The address the form is editing, or `null` while adding one. */
  const [editing, setEditing] = useState<Address | null>(address ?? null);
  /**
   * Bumped every time a form is opened.
   *
   * The seeding effect keys on this rather than on `step`, because returning
   * from the city step is also an arrival at the form — and reseeding there
   * would wipe the city the customer had just gone to choose.
   */
  const [formSession, setFormSession] = useState(0);

  const [governorate, setGovernorate] = useState<GeographyOption | null>(null);

  const [area, setLocalArea] = useState<DeliveryArea | null>(null);
  /**
   * Where the city came from, which is the difference between a fact and a
   * leftover — and, in two of these cases, the difference between «we could not
   * tell» and «we do not deliver there».
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

  /**
   * What went wrong, said here rather than thrown at a global dialog.
   *
   * `notify` draws a `Modal`, and a `Modal` cannot be presented over this one.
   * Calling it from inside a sheet does not show a message — it wedges the
   * dialog queue and silences every message after it.
   */
  const [problem, setProblem] = useState<string | null>(null);

  /** The row whose delete is waiting to be confirmed, in the row itself. */
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  /** Once per form session, not once per render. */
  const autoLocated = useRef(false);
  /** The last point the city was looked up for, so a nudge costs nothing. */
  const lastResolved = useRef<{ latitude: number; longitude: number } | null>(null);
  /**
   * The selected area, readable from inside the lookup.
   *
   * A governorate-only answer has to be weighed against what is already
   * selected — «you are in الأنبار» agrees with حديثة and disagrees with بغداد.
   */
  const areaRef = useRef<DeliveryArea | null>(null);

  useEffect(() => {
    areaRef.current = area;
  }, [area]);

  const addresses = useQuery({
    queryKey: ['addresses'],
    queryFn: () => api.addresses(),
    enabled: visible,
    staleTime: 5 * 60_000,
  });

  const preferred = useQuery({
    queryKey: ['addresses', 'preferred'],
    queryFn: () => loadPreferredAddressId(),
    staleTime: Infinity,
  });

  /**
   * Every city the platform serves, in one request.
   *
   * Matching a pin has to consider all of them at once, and `ordering` is the
   * right list for a delivery address.
   */
  const tree = useQuery({
    queryKey: ['geography', 'tree', 'ordering'],
    queryFn: () => api.geographyTree('ordering'),
    staleTime: 30 * 60_000,
    enabled: visible,
  });

  /** Open the form on an address, or on nothing. */
  const openForm = useCallback((target: Address | null) => {
    setEditing(target);
    setGovernorate(null);
    setProblem(null);
    setConfirmingDelete(null);
    autoLocated.current = false;
    lastResolved.current = null;
    setFormSession((session) => session + 1);
    setStep('form');
  }, []);

  /* Opening the sheet returns it to its starting step. */
  useEffect(() => {
    if (!visible) {
      autoLocated.current = false;
      lastResolved.current = null;
      return;
    }

    setStep(start);
    setProblem(null);
    setConfirmingDelete(null);
    setGovernorate(null);
    setEditing(address ?? null);
    setFormSession((session) => session + 1);
  }, [visible, start, address]);

  /*
   * Seed the form for one session.
   *
   * Everything is read once, when a form is opened: following `currentArea`
   * afterwards would overwrite what the pin — or the customer — has since said.
   */
  useEffect(() => {
    if (!visible) return;

    const target = editing;
    setSource('carried');
    setDetectedPlace(null);
    setLocalArea(
      target
        ? {
            governorateId: target.governorate.id,
            governorateNameAr: target.governorate.name_ar,
            cityId: target.city.id,
            cityNameAr: target.city.name_ar,
          }
        : // The explicit choice wins over the remembered one: `initialArea`
          // comes from the signup screen, where a city was picked seconds ago.
          (initialArea ?? currentArea ?? null),
    );
    setDescription(target?.landmark ?? '');
    setDistrictHint(target?.district_text ?? null);
    setCoordinates(
      target?.latitude != null && target.longitude != null
        ? { latitude: target.latitude, longitude: target.longitude, accuracy: null }
        : null,
    );
  }, [formSession]);

  /** Read the city under a point, and the neighbourhood if there is one. */
  const resolveFrom = useCallback(
    async (point: { latitude: number; longitude: number }) => {
      const branches = tree.data;
      if (!branches) return;

      setResolving(true);
      const place = await describePlace(point);
      setResolving(false);
      // No geocoder on this platform — the browser preview, mostly. The area
      // already there stays, and the row below it can still be tapped.
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
         * nothing to ask.
         */
        setDetectedPlace(found.governorateNameAr);
        setSource(areaRef.current?.governorateId === found.governorateId ? 'pin' : 'narrow');
        return;
      }

      /*
       * The area is left exactly as it was for both remaining answers, because
       * neither names a city to replace it with. What changes is what the screen
       * says — and these two must never say the same thing.
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
      if (announce) setProblem(LOCATION_MESSAGES_AR[outcome.status]);
      return;
    }
    setProblem(null);
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
       * somebody pressed something — is the one every customer denies.
       */
      if (!(await hasLocationPermission())) return;
      await locate(false);
    })();
  }, [visible, step, coordinates, locate]);

  /*
   * The city follows the pin, once the pin has stopped moving — and only when
   * it has actually gone somewhere. A drag across Baghdad fires `moveend` a
   * dozen times, and asking the geocoder each time is a dozen questions with
   * one answer.
   */
  useEffect(() => {
    if (!visible || step !== 'form' || !coordinates || !tree.data) return;
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
  }, [visible, step, coordinates, tree.data, resolveFrom]);

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

  /** Make an address the one this phone orders to, and move the storefront with it. */
  const choose = useCallback(
    async (entry: Address) => {
      await savePreferredAddressId(entry.id);
      await setArea({
        governorateId: entry.governorate.id,
        governorateNameAr: entry.governorate.name_ar,
        cityId: entry.city.id,
        cityNameAr: entry.city.name_ar,
      });
      await preferred.refetch();
      onClose();
    },
    [setArea, preferred, onClose],
  );

  const remove = useMutation({
    mutationFn: (entry: Address) => api.deleteAddress(entry.id),
    onSuccess: async () => {
      setConfirmingDelete(null);
      await queryClient.invalidateQueries({ queryKey: ['addresses'] });
    },
    onError: (error) =>
      setProblem(error instanceof ApiError ? error.messageAr : 'تعذّر حذف العنوان.'),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!area) throw new Error('no area');

      const created = await api.createAddress({
        label: editing?.label ?? 'المنزل',
        governorate_id: area.governorateId,
        city_id: area.cityId,
        ...(districtHint ? { district_text: districtHint } : {}),
        ...(description.trim() ? { landmark: description.trim() } : {}),
        /*
         * Carried through rather than asked for: the street, house number,
         * floor and courier note are no longer on this form, the driver's
         * screen still prints them, and an address saved before it was
         * simplified may well have them.
         */
        ...(editing?.street ? { street: editing.street } : {}),
        ...(editing?.building ? { building: editing.building } : {}),
        ...(editing?.floor ? { floor: editing.floor } : {}),
        ...(editing?.delivery_notes ? { delivery_notes: editing.delivery_notes } : {}),
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
      if (editing) await api.deleteAddress(editing.id).catch(() => undefined);

      // The address just saved is the one they meant to order to, and where it
      // is delivered is where they are ordering from.
      await savePreferredAddressId(created.id);
      if (area.cityId !== currentArea?.cityId) await setArea(area);

      return created;
    },
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['addresses'] });
      await preferred.refetch();
      onSaved?.(created.id);
      // Opened from the list, it goes back to the list; opened on its own — from
      // checkout, or the card on the home screen — it has nothing to go back to.
      if (start === 'list') setStep('list');
      else onClose();
    },
    onError: (error) =>
      setProblem(error instanceof ApiError ? error.messageAr : 'تعذّر حفظ العنوان.'),
  });

  /*
   * A pin is enough. A description alone is enough too — somebody who refused
   * the location permission and will not drag a map still has «قرب صيدلية
   * النور», which is how the city has always been addressed.
   */
  const canSave =
    Boolean(area) && (coordinates !== null || description.trim().length > 0) && !save.isPending;

  /*
   * Red is for something the customer has to act on, and nothing else. Not
   * knowing the name of a place says nothing about whether Jibli delivers there.
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

  const rows = addresses.data ?? [];

  const sheetTitle =
    step === 'area'
      ? areaStepTitle(governorate)
      : step === 'list'
        ? (title ?? 'عناويني')
        : editing
          ? 'تعديل العنوان'
          : start === 'form'
            ? (title ?? 'ثبّت منزلك')
            : 'عنوان جديد';

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={sheetTitle}
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
      {/*
        * Anything that went wrong, in the sheet.
        *
        * Never `notify` from in here: it draws a `Modal`, a `Modal` cannot be
        * presented over this one, and the attempt leaves the dialog queue
        * believing a dialog is open — which silences every message afterwards.
        */}
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

      {step === 'list' ? (
        <AddressList
          rows={rows}
          loading={addresses.isLoading}
          error={
            addresses.isError
              ? addresses.error instanceof ApiError
                ? addresses.error.messageAr
                : 'تعذّر تحميل العناوين'
              : null
          }
          onRetry={() => void addresses.refetch()}
          preferredId={preferred.data ?? null}
          confirmingDelete={confirmingDelete}
          deleting={remove.isPending}
          onChoose={(entry) => void choose(entry)}
          onEdit={(entry) => openForm(entry)}
          onAskDelete={setConfirmingDelete}
          onConfirmDelete={(entry) => remove.mutate(entry)}
          onAdd={() => openForm(null)}
        />
      ) : step === 'area' ? (
        <>
          {/*
            * A way out that is not «choose a city».
            *
            * Without this the only exits from the city list were picking one or
            * dismissing the whole sheet, which throws away a half-written
            * address for the crime of looking.
            */}
          <Pressable
            onPress={() => setStep('form')}
            accessibilityRole="button"
            accessibilityLabel="رجوع إلى العنوان"
            style={({ pressed }) => [
              { minHeight: TAP_TARGET, justifyContent: 'center' },
              pressed ? { opacity: 0.6 } : null,
            ]}
          >
            <Row gap={space[1]}>
              <MaterialCommunityIcons name="close" size={16} color={color.textMuted} />
              <Text variant="caption" tone="muted">
                رجوع إلى العنوان
              </Text>
            </Row>
          </Pressable>

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
              setDetectedPlace(null);
              setStep('form');
            }}
          />
        </>
      ) : (
        <>
          {start === 'list' ? (
            <Pressable
              onPress={() => setStep('list')}
              accessibilityRole="button"
              accessibilityLabel="رجوع إلى عناويني"
              style={({ pressed }) => [
                { minHeight: TAP_TARGET, justifyContent: 'center' },
                pressed ? { opacity: 0.6 } : null,
              ]}
            >
              <Row gap={space[1]}>
                <MaterialCommunityIcons name="chevron-right" size={18} color={color.brand} />
                <Text variant="smallBold" tone="brand">
                  عناويني
                </Text>
              </Row>
            </Pressable>
          ) : null}

          {/*
            * The map first, because the map is the address. It opens on the
            * customer, the pin stays in the middle, and what is under it is
            * saved with the order and handed to the courier as a navigation
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

          {/*
            * The city, read off the pin — shown rather than asked, and tappable
            * because a geocoder can be wrong and there is none at all in a
            * browser.
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
            * The one thing left to type. Everything the old form asked — street,
            * house number, floor — was an attempt to say what a pin already
            * says. What a pin cannot say is which of the three doors is yours.
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

/** The saved addresses, with the actions that belong to each one. */
function AddressList({
  rows,
  loading,
  error,
  onRetry,
  preferredId,
  confirmingDelete,
  deleting,
  onChoose,
  onEdit,
  onAskDelete,
  onConfirmDelete,
  onAdd,
}: {
  readonly rows: readonly Address[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly preferredId: string | null;
  readonly confirmingDelete: string | null;
  readonly deleting: boolean;
  readonly onChoose: (entry: Address) => void;
  readonly onEdit: (entry: Address) => void;
  readonly onAskDelete: (addressId: string | null) => void;
  readonly onConfirmDelete: (entry: Address) => void;
  readonly onAdd: () => void;
}) {
  if (loading) {
    return (
      <View style={{ paddingVertical: space[8], alignItems: 'center' }}>
        <ActivityIndicator color={color.brand} />
      </View>
    );
  }

  if (error) return <ErrorState message={error} onRetry={onRetry} />;

  return (
    <>
      {rows.length === 0 ? (
        <Text tone="muted" align="center">
          لا عناوين محفوظة بعد — أضف عنوانك وثبّته على الخريطة.
        </Text>
      ) : (
        rows.map((entry) => {
          const chosen = preferredId ? preferredId === entry.id : entry.is_default;
          const pinned = entry.latitude != null && entry.longitude != null;
          const confirming = confirmingDelete === entry.id;

          return (
            <View
              key={entry.id}
              style={{
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: confirming ? color.danger : chosen ? color.brand : color.borderSubtle,
                backgroundColor: chosen ? color.brandSoft : color.surfaceCard,
                overflow: 'hidden',
              }}
            >
              <Pressable
                onPress={() => onChoose(entry)}
                accessibilityRole="button"
                accessibilityState={{ selected: chosen }}
                accessibilityLabel={`${entry.governorate.name_ar} ${entry.city.name_ar}${entry.landmark ? ` — ${entry.landmark}` : ''}`}
                style={({ pressed }) => [
                  {
                    minHeight: TAP_TARGET + 10,
                    paddingHorizontal: space[3],
                    justifyContent: 'center',
                  },
                  pressed ? { opacity: 0.7 } : null,
                ]}
              >
                <Row gap={space[2]}>
                  <MaterialCommunityIcons
                    name={pinned ? 'map-marker-check' : 'map-marker-alert-outline'}
                    size={20}
                    color={pinned ? color.successStrong : color.dangerStrong}
                  />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="smallBold" tone={chosen ? 'brand' : 'primary'}>
                      {entry.governorate.name_ar} — {entry.city.name_ar}
                    </Text>
                    <Text variant="caption" tone="muted" numberOfLines={2}>
                      {/*
                        * A missing pin is called out rather than left blank: it
                        * is the difference between a courier arriving and a
                        * courier phoning, and it is fixable in two taps.
                        */}
                      {pinned
                        ? (entry.landmark ?? entry.district_text ?? 'مثبّت على الخريطة')
                        : 'بلا دبوس — افتحه وثبّته على الخريطة'}
                    </Text>
                  </View>
                  {chosen ? (
                    <MaterialCommunityIcons name="check-circle" size={20} color={color.brand} />
                  ) : null}
                </Row>
              </Pressable>

              {/*
                * Deleting asks in the row.
                *
                * `confirmAsync` draws a dialog, and a dialog is a `Modal` that
                * cannot be presented over the sheet holding this list — the ask
                * never appeared, the delete never happened, and the queue was
                * left wedged. An inline confirmation is also simply better: the
                * question sits on the thing it is about.
                */}
              <Row
                justify="space-between"
                style={{
                  borderTopWidth: 1,
                  borderTopColor: color.borderSubtle,
                  paddingHorizontal: space[3],
                }}
              >
                {confirming ? (
                  <>
                    <Pressable
                      onPress={() => onConfirmDelete(entry)}
                      disabled={deleting}
                      accessibilityRole="button"
                      accessibilityLabel="تأكيد حذف العنوان"
                      style={({ pressed }) => [
                        { minHeight: TAP_TARGET, justifyContent: 'center' },
                        pressed ? { opacity: 0.6 } : null,
                      ]}
                    >
                      <Row gap={space[1]}>
                        {deleting ? (
                          <ActivityIndicator size="small" color={color.dangerStrong} />
                        ) : (
                          <MaterialCommunityIcons
                            name="trash-can"
                            size={16}
                            color={color.dangerStrong}
                          />
                        )}
                        <Text variant="captionBold" tone="danger">
                          تأكيد الحذف
                        </Text>
                      </Row>
                    </Pressable>

                    <Pressable
                      onPress={() => onAskDelete(null)}
                      accessibilityRole="button"
                      accessibilityLabel="تراجع عن الحذف"
                      style={({ pressed }) => [
                        { minHeight: TAP_TARGET, justifyContent: 'center' },
                        pressed ? { opacity: 0.6 } : null,
                      ]}
                    >
                      <Text variant="caption" tone="muted">
                        تراجع
                      </Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Pressable
                      onPress={() => onEdit(entry)}
                      accessibilityRole="button"
                      accessibilityLabel="تعديل العنوان"
                      style={({ pressed }) => [
                        { minHeight: TAP_TARGET, justifyContent: 'center' },
                        pressed ? { opacity: 0.6 } : null,
                      ]}
                    >
                      <Row gap={space[1]}>
                        <MaterialCommunityIcons
                          name="pencil-outline"
                          size={16}
                          color={color.brand}
                        />
                        <Text variant="caption" tone="brand">
                          تعديل
                        </Text>
                      </Row>
                    </Pressable>

                    <Pressable
                      onPress={() => onAskDelete(entry.id)}
                      accessibilityRole="button"
                      accessibilityLabel="حذف العنوان"
                      style={({ pressed }) => [
                        { minHeight: TAP_TARGET, justifyContent: 'center' },
                        pressed ? { opacity: 0.6 } : null,
                      ]}
                    >
                      <Row gap={space[1]}>
                        <MaterialCommunityIcons
                          name="trash-can-outline"
                          size={16}
                          color={color.dangerStrong}
                        />
                        <Text variant="caption" tone="danger">
                          حذف
                        </Text>
                      </Row>
                    </Pressable>
                  </>
                )}
              </Row>
            </View>
          );
        })
      )}

      <Pressable
        onPress={onAdd}
        accessibilityRole="button"
        accessibilityLabel="إضافة عنوان جديد"
        style={({ pressed }) => [
          {
            minHeight: TAP_TARGET + 6,
            borderRadius: radius.md,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: color.brand,
            justifyContent: 'center',
            paddingHorizontal: space[3],
          },
          pressed ? { opacity: 0.7 } : null,
        ]}
      >
        <Row gap={space[2]}>
          <MaterialCommunityIcons name="plus" size={20} color={color.brand} />
          <Text variant="smallBold" tone="brand">
            إضافة عنوان جديد
          </Text>
        </Row>
      </Pressable>
    </>
  );
}
