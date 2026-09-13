import { Component, type ErrorInfo, type ReactNode } from 'react';
import { View } from 'react-native';
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
     * Console, for now. When crash reporting is added this is the single place
     * it hooks into — which is half the reason the boundary exists before
     * there is anything to report to.
     */
    console.error('Unhandled render error', error, info.componentStack);
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
        <Button label="إعادة المحاولة" onPress={this.reset} />
      </View>
    );
  }
}
