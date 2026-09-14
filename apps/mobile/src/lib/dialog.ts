import { Alert, Platform } from 'react-native';

/**
 * Asking and telling, on both platforms.
 *
 * `react-native-web` ships `Alert` as this, in full:
 *
 *     class Alert { static alert() {} }
 *
 * An empty function. So every confirmation and every error message in this app
 * was silent in the browser — the sign-out button opened nothing and looked
 * broken, cancelling an order asked nothing and did nothing visible, «تم تفريغ
 * السلة» never appeared, and a failed checkout reported the failure to a method
 * that discards it. Nineteen calls, on the one surface the app is being
 * reviewed on.
 *
 * The browser has `confirm` and `alert` and they are synchronous and ugly and
 * they work. This is a review tool, not a shipped web build: the native path is
 * unchanged, and the point here is that a developer looking at the preview sees
 * what a phone would show rather than nothing at all.
 */

const isWeb = Platform.OS === 'web';

export interface ConfirmOptions {
  readonly title: string;
  readonly message?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  /** Renders the confirm in red on iOS, and nothing anywhere else. */
  readonly destructive?: boolean;
}

/**
 * Ask a yes/no question.
 *
 * Resolves `false` for every way of saying no — the cancel button, the
 * hardware back button on Android, tapping outside. A caller only ever has to
 * handle the yes.
 */
export function confirmAsync(options: ConfirmOptions): Promise<boolean> {
  const {
    title,
    message,
    confirmLabel = 'تأكيد',
    cancelLabel = 'تراجع',
    destructive = false,
  } = options;

  if (isWeb) {
    /*
     * `window.confirm` cannot show the button labels, so the question has to
     * carry them: «حذف الحساب؟» with OK/Cancel underneath is a different
     * question from «حذف الحساب؟» with «حذف»/«تراجع».
     */
    const text = [title, message, `— ${confirmLabel} / ${cancelLabel}`]
      .filter(Boolean)
      .join('\n\n');
    return Promise.resolve(globalThis.confirm?.(text) ?? false);
  }

  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      {
        text: confirmLabel,
        style: destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ]);
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
  if (isWeb) {
    globalThis.alert?.([title, message].filter(Boolean).join('\n\n'));
    return;
  }
  Alert.alert(title, message);
}
