import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { api, ApiError, type Address } from '@/lib/api';
import { useArea } from '@/lib/area';
import {
  captureCurrentLocation,
  hasLocationPermission,
  LOCATION_MESSAGES_AR,
  type Coordinates,
} from '@/lib/location';
import { notify } from '@/lib/dialog';
import { color, radius, space, TAP_TARGET, TEXT_START, text } from '@/theme';
import { Button, Row, Text } from '@/ui';
import { MapPicker } from '@/ui/map-picker';
import { Sheet } from '@/ui/catalog';

/**
 * Saving an address, with the pin the courier will actually drive to.
 *
 * Lived inside `checkout.tsx`, which meant the only moment a customer could
 * put their home on the map was the moment they were trying to pay for food.
 * It is shared now: the home screen offers it on a first visit, and checkout
 * opens the same sheet.
 *
 * **The map opens where the customer is standing.** That is the whole point of
 * the change. Before, it opened on Tahrir Square at a zoom where a house is one
 * building among four hundred, and the customer had to notice a button to move
 * it — so most addresses were saved with no useful point, or worse, with the
 * fallback reported as a real one. Now, if the permission has already been
 * granted (the home screen asks on the way in), the sheet takes a fix before it
 * draws and opens centred on it, pin down, at building zoom.
 *
 * The fix is still a starting point, not an answer. A phone indoors is
 * routinely fifty metres out and fifty metres is the next building along, so
 * the map is draggable and the caption says to correct it.
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
  onCreated,
  title = 'عنوان جديد',
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (address: Address) => void;
  title?: string;
}) {
  const { area } = useArea();
  const [label, setLabel] = useState('المنزل');
  const [district, setDistrict] = useState('');
  const [street, setStreet] = useState('');
  const [landmark, setLandmark] = useState('');

  /**
   * The point on the address.
   *
   * `null` means nobody has chosen one — and the map is now careful to leave it
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
   * Once per opening, not once per render — and reset on close so that the next
   * address starts from wherever the customer is *then*, which for a second
   * address is usually somewhere else entirely.
   */
  const autoLocated = useRef(false);

  const locate = useCallback(async (announce: boolean) => {
    setLocating(true);
    const outcome = await captureCurrentLocation();
    setLocating(false);

    if (outcome.status === 'ok') {
      setCoordinates(outcome.coordinates);
      return;
    }
    // Silent when the sheet asked on its own: a customer who opened a form was
    // not asking about GPS, and a toast they did not provoke is noise. The
    // button beside the map says the same thing when they do ask.
    if (announce) notify('تحديد الموقع', LOCATION_MESSAGES_AR[outcome.status]);
  }, []);

  useEffect(() => {
    if (!visible) {
      autoLocated.current = false;
      return;
    }
    if (autoLocated.current || coordinates) return;
    autoLocated.current = true;

    void (async () => {
      /*
       * Only when the answer is already yes.
       *
       * `captureCurrentLocation` would raise the system dialog, and a permission
       * prompt that appears because a sheet opened — rather than because
       * somebody pressed something — is the one every customer denies. The home
       * screen asks once, early, on its own terms; this reads that answer.
       */
      if (!(await hasLocationPermission())) return;
      await locate(false);
    })();
  }, [visible, coordinates, locate]);

  /*
   * The map moved, so the pin moved.
   *
   * A point chosen by hand has no accuracy figure and should not borrow one
   * from a GPS fix that is no longer what is being saved — `null` says «this
   * is where somebody pointed», which is the honest thing for the driver's
   * screen to receive.
   *
   * Unless the map is only echoing back the point it was handed. It reports
   * its opening position so that somebody who is already in the right place
   * can just save, and when that position came from the GPS a moment earlier,
   * taking the echo at face value would throw the accuracy away and downgrade
   * «دقة تقريبية ٣٠ متر» to a vaguer sentence about dragging. A metre is below
   * what any phone can resolve and above Leaflet's pixel rounding at this
   * zoom, so a move smaller than that is not a move.
   */
  const pickOnMap = useCallback((next: { latitude: number; longitude: number }) => {
    setCoordinates((current) =>
      current && Math.abs(current.latitude - next.latitude) < SAME_POINT_DEGREES
        && Math.abs(current.longitude - next.longitude) < SAME_POINT_DEGREES
        ? current
        : { latitude: next.latitude, longitude: next.longitude, accuracy: null },
    );
  }, []);

  const create = useMutation({
    mutationFn: () =>
      api.createAddress({
        label,
        governorate_id: area?.governorateId,
        city_id: area?.cityId,
        ...(district ? { district_text: district } : {}),
        ...(street ? { street } : {}),
        ...(landmark ? { landmark } : {}),
        ...(coordinates
          ? {
              coordinates: {
                latitude: coordinates.latitude,
                longitude: coordinates.longitude,
              },
            }
          : {}),
        is_default: true,
      }),
    onSuccess: onCreated,
    onError: (error) => {
      notify('تعذّر حفظ العنوان', error instanceof ApiError ? error.messageAr : 'حاول مرة أخرى.');
    },
  });

  const canSave = Boolean(area) && district.trim().length > 0;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      footer={
        <Button
          label="حفظ العنوان"
          block
          disabled={!canSave || create.isPending}
          loading={create.isPending}
          onPress={() => create.mutate()}
        />
      }
    >
      {area ? (
        <Row gap={space[2]}>
          <MaterialCommunityIcons name="map-marker-outline" size={18} color={color.brand} />
          <Text variant="small" tone="secondary">
            {area.governorateNameAr} — {area.cityNameAr}
          </Text>
        </Row>
      ) : (
        <Text variant="small" tone="danger">
          اختر منطقتك من الشاشة الرئيسية أولاً.
        </Text>
      )}

      {/*
        * The map, before the fields.
        *
        * «قرب صيدلية النور» is only unambiguous to somebody who already knows
        * the street. A point is what turns it into an address a courier can
        * reach without phoning, and this is where it gets set: the map opens on
        * the customer, the pin stays in the middle, and what is under it is
        * saved with the order and handed to the driver as a navigation link.
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
                  : 'تحديد موقعي الحالي'}
            </Text>
            <Text variant="caption" tone="muted">
              {coordinates
                ? coordinates.accuracy
                  ? `دقة تقريبية ${Math.round(coordinates.accuracy)} متر — اسحب الخريطة للتصحيح`
                  : 'اسحب الخريطة لضبط الدبوس بدقة'
                : 'اسحب الخريطة إلى منزلك، أو اضغط هنا لاستخدام موقعك'}
            </Text>
          </View>
        </Row>
      </Pressable>

      <LabelledInput
        label="الاسم"
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
        label="الشارع"
        value={street}
        onChangeText={setStreet}
        placeholder="شارع ١٤ رمضان"
      />
      <LabelledInput
        label="أقرب نقطة دالة"
        value={landmark}
        onChangeText={setLandmark}
        placeholder="قرب صيدلية النور"
      />
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
