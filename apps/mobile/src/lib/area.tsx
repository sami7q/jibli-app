import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api as apiClient } from './api';
import { loadArea, saveArea } from './secure-session';
import { useMe, useSession } from './session';

/**
 * Where the customer is ordering to.
 *
 * Two sources, one answer. A signed-in customer's area is their profile's, and
 * the server is authoritative about it. A guest has no profile, so their area
 * is whatever they picked in the header — and they must be able to pick one,
 * because `GET /restaurants` takes a city id and a guest without one sees an
 * empty app, which is the App Store 5.1.1(ii) problem arriving by a different
 * road.
 *
 * The choice is persisted so the second launch does not ask again.
 */

export interface DeliveryArea {
  readonly governorateId: string;
  readonly governorateNameAr: string;
  readonly cityId: string;
  readonly cityNameAr: string;
}

interface AreaApi {
  readonly area: DeliveryArea | null;
  /** True until the stored choice has been read; the header waits on it. */
  readonly isResolving: boolean;
  readonly setArea: (area: DeliveryArea) => Promise<void>;
}

const AreaContext = createContext<AreaApi | null>(null);

function parse(serialized: string | null): DeliveryArea | null {
  if (!serialized) return null;

  try {
    const value = JSON.parse(serialized) as Partial<DeliveryArea>;
    // Every field or nothing: a half-written area would put the header in a
    // state no screen knows how to render.
    if (
      typeof value.governorateId === 'string' &&
      typeof value.governorateNameAr === 'string' &&
      typeof value.cityId === 'string' &&
      typeof value.cityNameAr === 'string'
    ) {
      return value as DeliveryArea;
    }
  } catch {
    /* A corrupt entry is the same as none. */
  }

  return null;
}

export function AreaProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const { refresh } = useSession();
  const [area, setLocalArea] = useState<DeliveryArea | null>(null);
  const [isResolving, setResolving] = useState(true);

  useEffect(() => {
    let alive = true;
    void loadArea().then((stored) => {
      if (!alive) return;
      /*
       * Only if nothing has answered yet.
       *
       * Both effects run on mount and this one is asynchronous, so on a fresh
       * sign-in the profile can have set the area before the (empty) stored
       * value arrives — and a plain assignment would wipe it back to null.
       */
      setLocalArea((current) => current ?? parse(stored));
      setResolving(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  /*
   * The profile seeds the area; it does not police it.
   *
   * Applied when it is new to this device — a fresh sign-in, or a city changed
   * on another phone — and not again afterwards. Enforcing it on every render
   * instead would make the header's picker useless for a signed-in customer:
   * they choose a city, and it snaps straight back to their profile's.
   *
   * The ref is what makes "new" mean new. Comparing against the current area
   * cannot distinguish "the profile changed" from "they just picked something
   * else", and those need opposite answers.
   */
  const appliedProfileCity = useRef<string | null>(null);

  useEffect(() => {
    if (!me?.city_id || !me.city_name_ar || !me.governorate_id || !me.governorate_name_ar) return;
    if (appliedProfileCity.current === me.city_id) return;

    appliedProfileCity.current = me.city_id;
    const fromProfile: DeliveryArea = {
      governorateId: me.governorate_id,
      governorateNameAr: me.governorate_name_ar,
      cityId: me.city_id,
      cityNameAr: me.city_name_ar,
    };
    setLocalArea(fromProfile);
    void saveArea(JSON.stringify(fromProfile));
  }, [me]);

  const api = useMemo<AreaApi>(
    () => ({
      area,
      isResolving,
      setArea: async (next) => {
        setLocalArea(next);
        await saveArea(JSON.stringify(next));

        /*
         * A signed-in customer's area is part of their profile, so the change
         * follows them to another phone. Deliberately not awaited: the screen
         * is already showing the new city and a slow request must not hold a
         * sheet open.
         *
         * A failure costs the sync, not the choice, and one failure is
         * expected rather than exceptional — the lists offered here are
         * filtered by the `ordering` capability while the profile is validated
         * against `customer_signup`, so a city open for ordering but not for
         * signup is refused. Browsing it still works, which is what was asked
         * for; only the cross-device default does not move.
         */
        if (!me) return;
        void apiClient
          .updateProfile({ governorate_id: next.governorateId, city_id: next.cityId })
          .then(() => refresh())
          .catch(() => undefined);
      },
    }),
    [area, isResolving, me, refresh],
  );

  return <AreaContext.Provider value={api}>{children}</AreaContext.Provider>;
}

export function useArea(): AreaApi {
  const context = useContext(AreaContext);
  if (!context) {
    throw new Error('useArea must be used inside <AreaProvider>');
  }
  return context;
}
