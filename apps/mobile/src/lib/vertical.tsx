import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { MerchantType } from '@jibli/contracts';

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
