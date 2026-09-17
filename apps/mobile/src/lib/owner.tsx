import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type OwnerShop } from './api';
import { useSession } from './session';
import { loadSelectedShop, rememberSelectedShop } from './owner-store';
import { isShopSupported } from './owner-vertical';

/*
 * The vertical gate lives in `owner-vertical.ts`, which holds no React and is
 * therefore testable on its own. Re-exported so screens have one import.
 */
export { catalogNoun, isShopSupported } from './owner-vertical';

/**
 * Owner Mode — which shop, and what this account may do in it.
 *
 * Not a provider. Owner Mode is a destination reached from «حسابي», not a mode
 * the whole app runs in: the same person orders their lunch from the app they
 * price their shelves in, and wrapping the tree in an owner context would make
 * every customer screen re-render when a shop list refreshes.
 *
 * So it is a hook over one cached query. React Query holds the shop list, every
 * owner screen reads the same cache entry, and there is exactly one request per
 * session for it.
 */

export interface OwnerSession {
  readonly isLoading: boolean;
  readonly isError: boolean;
  /** Every shop the account belongs to, supported or not. */
  readonly shops: readonly OwnerShop[];
  /** The shops Owner Mode can actually open. */
  readonly usable: readonly OwnerShop[];
  /** The one being worked on, or null while it is being decided. */
  readonly shop: OwnerShop | null;
  readonly select: (shopId: string) => Promise<void>;
  readonly can: (permission: string) => boolean;
  readonly refetch: () => void;
}

export function useOwner(): OwnerSession {
  const { state } = useSession();
  const signedIn = state.status === 'ready' || state.status === 'offline-ready';

  const shops = useQuery({
    queryKey: ['owner-shops'],
    queryFn: () => api.ownerShops(),
    enabled: signedIn,
    // A shop list changes when staff add a branch, not by the minute.
    staleTime: 10 * 60_000,
  });

  const remembered = useQuery({
    queryKey: ['owner-selected-shop'],
    queryFn: () => loadSelectedShop(),
    enabled: signedIn,
    staleTime: Infinity,
  });

  const all = useMemo<readonly OwnerShop[]>(() => shops.data?.restaurants ?? [], [shops.data]);
  const usable = useMemo(() => all.filter(isShopSupported), [all]);

  /*
   * One shop means no choice to make.
   *
   * A grocer with a single shop should never see a picker — and a remembered id
   * that no longer appears in the list (access revoked, shop closed) has to
   * fall back rather than leave the screen empty and unexplained.
   */
  const shop = useMemo<OwnerShop | null>(() => {
    if (usable.length === 0) return null;
    const saved = usable.find((entry) => entry.id === remembered.data);
    return saved ?? usable[0] ?? null;
  }, [usable, remembered.data]);

  const select = useCallback(async (shopId: string) => {
    await rememberSelectedShop(shopId);
    await remembered.refetch();
  }, [remembered]);

  /*
   * Permissions shape the screen; they never guard it.
   *
   * The server asserts every one of these again — `assertRestaurantPermission`
   * on each route — so this only decides whether to draw a button. A cashier
   * seeing a disabled «إضافة منتج» is better than one who taps it and reads a
   * 403 they cannot act on.
   */
  const can = useCallback(
    (permission: string) => Boolean(shop?.permissions.includes(permission)),
    [shop],
  );

  return {
    isLoading: shops.isLoading || remembered.isLoading,
    isError: shops.isError,
    shops: all,
    usable,
    shop,
    select,
    can,
    refetch: () => void shops.refetch(),
  };
}
