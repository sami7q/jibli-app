import { useEffect, useState } from 'react';
import { type GeographyOption } from '@/lib/api';
import { useArea, type DeliveryArea } from '@/lib/area';
import { AreaChoice, areaStepTitle } from './area-choice';
import { Sheet } from './catalog';

/**
 * Choosing the delivery area — governorate, then city.
 *
 * The quick switch, and deliberately only that: it moves which restaurants are
 * listed, and nothing else. A customer changing city to see what is open there
 * is not filling in an address, and putting a map and four fields in front of
 * them would make a browsing decision feel like a commitment.
 *
 * The address form is where a home gets pinned. This is where a city gets
 * looked at. Both ask the same first question through the same list.
 */
export function AreaPicker({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { area, setArea } = useArea();
  const [governorate, setGovernorate] = useState<GeographyOption | null>(null);

  // Reopening should start from the current area, not from wherever the last
  // visit was abandoned.
  useEffect(() => {
    if (visible) setGovernorate(null);
  }, [visible]);

  const choose = async (chosen: GeographyOption, city: GeographyOption) => {
    const next: DeliveryArea = {
      governorateId: chosen.id,
      governorateNameAr: chosen.name_ar,
      cityId: city.id,
      cityNameAr: city.name_ar,
    };
    // `setArea` carries the choice to the profile for a signed-in customer, so
    // it follows them to another phone.
    await setArea(next);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={areaStepTitle(governorate)}>
      <AreaChoice
        governorate={governorate}
        onGovernorate={setGovernorate}
        selected={area ? { governorateId: area.governorateId, cityId: area.cityId } : null}
        onChoose={(chosen, city) => void choose(chosen, city)}
      />
    </Sheet>
  );
}
