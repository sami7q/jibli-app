import { Component, type ErrorInfo, type ReactNode } from 'react';
import { View } from 'react-native';
import { captureError } from '@/lib/monitoring';
import { color, space } from '@/theme';
import { Button, Text } from '@/ui';

/**
 * The last line before a white screen.
 *
 * A render error anywhere in the tree unmounts everything above it, and React
 * Native's answer is a blank view — on a release build, with no red box and no
 * message. The customer sees an app that opened to nothing and force-quits.
 *
 * This does not attempt to recover the broken subtree: it offers to remount it,
 * which fixes a transient failure and honestly fails again on a deterministic
 * one rather than pretending.
 *
 * Deliberately a class: `componentDidCatch` has no hook equivalent, and this is
 * the one place in the app where that is still true.
 */

interface State {
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    /*
     * The hook this boundary was written to have.
     *
     * `console.error` alone went nowhere in a release build, so a render error
     * that unmounted a screen on a customer's phone left no trace anywhere —
     * the app showed this fallback and the team learned nothing. The console
     * line stays because it is what a developer sees in Metro; the capture is
     * what reaches anybody afterwards.
     *
     * `componentStack` is the part a stack trace alone does not give: which
     * component tree was rendering when it threw.
     */
    console.error('Unhandled render error', error, info.componentStack);
    captureError(error, { componentStack: info.componentStack });
  }

  private readonly reset = (): void => this.setState({ error: null });

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <View
        style={{
          flex: 1,
          backgroundColor: color.surfacePage,
          alignItems: 'center',
          justifyContent: 'center',
          padding: space[6],
          gap: space[3],
        }}
      >
        <Text variant="h2" align="center">
          حدث خطأ غير متوقع
        </Text>
        <Text tone="muted" align="center">
          نعتذر — أُغلقت الشاشة بسبب خلل. بياناتك وطلباتك لم تتأثر.
        </Text>
        <Button label="إعادة المحاولة" onPress={this.reset} style={{ alignSelf: 'center' }} />
      </View>
    );
  }
}
