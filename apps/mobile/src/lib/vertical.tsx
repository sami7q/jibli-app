import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { MerchantType } from '@jibli/contracts';
import { setAccentSection } from '@/theme';

/**
 * Which half of Jibli the customer is in — food, or the market.
 *
 * `null` means "has not chosen yet", and that is a real state rather than a
 * missing default: the two halves have different categories, different
 * banners and different merchants, so a home screen has nothing correct to
 * render until it knows which one it is showing. The chooser screen exists to
 * answer that, and the Gate sends anyone without an answer to it.
 *
 * Deliberately not persisted. A customer who bought milk on Tuesday should not
 * open the app hungry on Friday and land in a grocery — and the chooser is one
 * tap, which makes forgetting the cheaper direction to be wrong in. If that
 * proves annoying in use, persisting it is a one-line change here and nothing
 * else moves.
 */

interface VerticalApi {
  readonly vertical: MerchantType | null;
  readonly choose: (next: MerchantType) => void;
  /** Back to the chooser. The home screen's back button calls this. */
  readonly clear: () => void;
}

const VerticalContext = createContext<VerticalApi | null>(null);

export function VerticalProvider({ children }: { children: ReactNode }) {
  const [vertical, setVertical] = useState<MerchantType | null>(null);

  /*
   * The section decides the app's accent, and it is set here, in render.
   *
   * Not in an effect and not in `choose`: an effect runs after the tree has
   * painted, so the first frame of a green home screen would be orange, and a
   * callback is one place the section can change but not the only one. This
   * provider is above every screen, so assigning during its render means the
   * accent is already right by the time anything below reads `color.brand`.
   *
   * It is an assignment to a module variable derived entirely from state, so
   * running it twice — or on a render React throws away — costs nothing and
   * leaves the same value behind.
   */
  setAccentSection(vertical);

  const choose = useCallback((next: MerchantType) => setVertical(next), []);
  const clear = useCallback(() => setVertical(null), []);

  const value = useMemo<VerticalApi>(
    () => ({ vertical, choose, clear }),
    [vertical, choose, clear],
  );

  return <VerticalContext.Provider value={value}>{children}</VerticalContext.Provider>;
}

export function useVertical(): VerticalApi {
  const context = useContext(VerticalContext);
  if (!context) throw new Error('useVertical must be used inside VerticalProvider');
  return context;
}
