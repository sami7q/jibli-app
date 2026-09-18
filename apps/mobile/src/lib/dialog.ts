/**
 * Asking and telling, in the app's own voice.
 *
 * These were handed to the platform, and both platforms answered badly. On web
 * `react-native-web` ships `Alert` as this, in full:
 *
 *     class Alert { static alert() {} }
 *
 * An empty function — so every confirmation and every error in this app was
 * silent in the browser. The fallback was `window.confirm`, which works and is
 * where «An embedded page at localhost:8081 says» comes from: browser chrome
 * above Arabic text, OK and Cancel in English, left-aligned.
 *
 * On a phone `Alert.alert` draws the operating system's dialog, which is
 * better and still not the app's: no Cairo, no brand colour, and on Android
 * the affirmative lands on the right where this layout reads left.
 *
 * So the dialog is drawn by `DialogHost` now, mounted once at the root. This
 * module is the imperative half — a queue and a subscription, no React — so
 * that the nineteen call sites keep calling a plain function from wherever
 * they are, including from inside a `catch`.
 *
 * **Never call these from inside an open `Sheet`.** `DialogHost` is a `Modal`
 * and so is `Sheet`, and iOS will not present a modal over one that is already
 * presenting: the dialog does not appear, `resolve` is never called, and
 * `showing` below stays `true` for the rest of the process — which silences
 * every confirmation and every error message in the app until it is restarted.
 * The browser hides this completely, because `Modal` there is an ordinary
 * `div` that stacks happily, so it cannot be caught in the web preview.
 *
 * A sheet says things in itself: an error line in its own body, and a
 * confirmation on the row it is about. Where a message really belongs to the
 * screen behind, the sheet hands it up through `onClose` and the screen — which
 * is not a modal — says it once the sheet is gone.
 */

export interface ConfirmOptions {
  readonly title: string;
  readonly message?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  /** Renders the affirmative in red. */
  readonly destructive?: boolean;
}

export interface DialogRequest {
  readonly kind: 'confirm' | 'notify';
  readonly title: string;
  readonly message?: string | undefined;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly destructive: boolean;
  /** Called once, with the answer. `false` for every way of saying no. */
  readonly resolve: (confirmed: boolean) => void;
}

type Listener = (request: DialogRequest | null) => void;

let listener: Listener | null = null;

/*
 * A queue, because two dialogs can be asked for in the same tick.
 *
 * Checkout does exactly this: a quote comes back with a changed price and a
 * closed restaurant, and both want saying. Without a queue the second
 * `setState` in one tick replaces the first and a message is lost — which is
 * the failure mode this whole module exists to end.
 */
const pending: DialogRequest[] = [];
let showing = false;

function pump(): void {
  if (showing || !listener) return;

  const next = pending.shift();
  if (!next) return;

  showing = true;
  listener(next);
}

/** Mounted by `DialogHost`. Returns its own unsubscribe. */
export function subscribeToDialogs(next: Listener): () => void {
  listener = next;
  pump();

  return () => {
    if (listener === next) listener = null;
  };
}

function enqueue(request: Omit<DialogRequest, 'resolve'>, resolve: (value: boolean) => void): void {
  pending.push({
    ...request,
    resolve: (confirmed) => {
      showing = false;
      resolve(confirmed);
      // Whatever was asked while this one was open.
      pump();
    },
  });
  pump();
}

/**
 * Ask a yes/no question.
 *
 * Resolves `false` for every way of saying no — the cancel button, the
 * hardware back button, tapping outside. A caller only ever has to handle the
 * yes.
 */
export function confirmAsync(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    enqueue(
      {
        kind: 'confirm',
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel ?? 'تأكيد',
        cancelLabel: options.cancelLabel ?? 'تراجع',
        destructive: options.destructive ?? false,
      },
      resolve,
    );
  });
}

/**
 * Say something that needs acknowledging and nothing else.
 *
 * Not a toast: these are the messages a customer has to read before carrying
 * on — a price that changed, an order that could not be placed — and a banner
 * that fades is the wrong shape for those.
 */
export function notify(title: string, message?: string): void {
  enqueue(
    {
      kind: 'notify',
      title,
      message,
      confirmLabel: 'حسناً',
      cancelLabel: 'حسناً',
      destructive: false,
    },
    () => {},
  );
}
