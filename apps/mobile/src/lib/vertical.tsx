import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { MerchantType } from '@jibli/contracts';
import { setAccentSection } from '@/theme';
import { clearVertical, loadVertical, saveVertical } from './secure-session';

/**
 * Which half of Jibli the customer is in — food, or the market.
 *
 * `null` means "has not chosen yet", and that is a real state rather than a
 * missing default: the two halves have different categories, different
 * banners and different merchants, so a home screen has nothing correct to
 * render until it knows which one it is showing. The chooser screen exists to
 * answer that, and the Gate sends anyone without an answer to it.
 *
 * Persisted, so a reload or a deep link does not strand a customer on the
 * chooser with a full cart and a destination in hand (CUST-7). `resolved` says
 * whether the stored choice has been read yet, so the Gate does not redirect
 * to the chooser in the one frame before it lands. Changing section («تبديل
 * القسم») clears it, so that is still one tap away.
 */

interface VerticalApi {
  readonly vertical: MerchantType | null;
  /** False until the persisted choice has been read on launch. */
  readonly resolved: boolean;
  readonly choose: (next: MerchantType) => void;
  /** Back to the chooser. The home screen's back button calls this. */
  readonly clear: () => void;
}

const VerticalContext = createContext<VerticalApi | null>(null);

export function VerticalProvider({ children }: { children: ReactNode }) {
  const [vertical, setVertical] = useState<MerchantType | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadVertical()
      .then((stored) => {
        if (!alive) return;
        if (stored) setVertical(stored);
      })
      .finally(() => {
        if (alive) setResolved(true);
      });
    return () => {
      alive = false;
    };
  }, []);

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

  const choose = useCallback((next: MerchantType) => {
    setVertical(next);
    void saveVertical(next);
  }, []);
  const clear = useCallback(() => {
    setVertical(null);
    void clearVertical();
  }, []);

  const value = useMemo<VerticalApi>(
    () => ({ vertical, resolved, choose, clear }),
    [vertical, resolved, choose, clear],
  );

  return <VerticalContext.Provider value={value}>{children}</VerticalContext.Provider>;
}

export function useVertical(): VerticalApi {
  const context = useContext(VerticalContext);
  if (!context) throw new Error('useVertical must be used inside VerticalProvider');
  return context;
}
