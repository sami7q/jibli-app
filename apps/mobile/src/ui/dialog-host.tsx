import { useEffect, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { color, palette, radius, shadow, space, TAP_TARGET, text } from '@/theme';
import { Text } from '@/ui';
import { subscribeToDialogs, type DialogRequest } from '@/lib/dialog';

/**
 * The app's own dialogs, drawn rather than delegated.
 *
 * Both platforms were handing these to something outside the app. On web,
 * `react-native-web` ships `Alert` as an empty function, so the fallback was
 * `window.confirm` — which in the preview renders as «An embedded page at
 * localhost:8081 says», a browser chrome banner above Arabic text, with OK and
 * Cancel in English and the message left-aligned. On a phone, `Alert.alert`
 * draws the operating system's dialog: better, but still not the app's — it
 * cannot carry Cairo, the brand's orange, or an RTL button order, and on
 * Android it puts the affirmative action on the right where this layout reads
 * left.
 *
 * So: one dialog, drawn in React, identical on both. It sits at the root and
 * listens; nothing renders until something asks.
 *
 * `Modal` rather than an absolutely-positioned view, because a dialog has to
 * be above everything including a bottom sheet that is already open — and on
 * Android it is what makes the hardware back button dismiss the dialog instead
 * of navigating the screen underneath it.
 */
export function DialogHost() {
  const [request, setRequest] = useState<DialogRequest | null>(null);

  useEffect(() => subscribeToDialogs(setRequest), []);

  if (!request) return null;

  const isConfirm = request.kind === 'confirm';

  const dismiss = (confirmed: boolean) => {
    // Cleared first: the resolver may open another dialog, and the state has
    // to be free before it does or the second one never appears.
    setRequest(null);
    request.resolve(confirmed);
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      // Android's back button. A dialog that cannot be dismissed that way is a
      // dialog the platform considers broken.
      onRequestClose={() => dismiss(false)}
    >
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: space[6],
          backgroundColor: 'rgba(17,24,39,0.5)',
        }}
      >
        {/*
         * Tapping the scrim answers no, on a question. On a notice there is
         * only one answer, so it closes.
         */}
        <Pressable
          onPress={() => dismiss(false)}
          accessibilityRole="button"
          accessibilityLabel="إغلاق"
          style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
        />

        <View
          accessibilityViewIsModal
          accessibilityRole="alert"
          style={{
            width: '100%',
            maxWidth: 420,
            backgroundColor: color.surfaceCard,
            borderRadius: radius.xl,
            padding: space[5],
            gap: space[3],
            ...shadow.xl,
          }}
        >
          <Text variant="h3" style={{ textAlign: 'center' }}>
            {request.title}
          </Text>

          {request.message ? (
            <Text tone="secondary" style={{ textAlign: 'center' }}>
              {request.message}
            </Text>
          ) : null}

          {/*
           * Buttons in a reversed row so the affirmative sits where the eye
           * ends in Arabic. A single button stretches — there is nothing to
           * choose between.
           */}
          <View
            style={{
              flexDirection: 'row-reverse',
              gap: space[3],
              marginTop: space[2],
            }}
          >
            <Pressable
              onPress={() => dismiss(true)}
              accessibilityRole="button"
              accessibilityLabel={request.confirmLabel}
              style={({ pressed }) => [
                {
                  flex: 1,
                  minHeight: TAP_TARGET,
                  borderRadius: radius.lg,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: request.destructive ? color.danger : color.brand,
                },
                pressed ? { opacity: 0.85 } : null,
              ]}
            >
              <Text style={{ ...text.bodyBold, color: palette.white }}>{request.confirmLabel}</Text>
            </Pressable>

            {isConfirm ? (
              <Pressable
                onPress={() => dismiss(false)}
                accessibilityRole="button"
                accessibilityLabel={request.cancelLabel}
                style={({ pressed }) => [
                  {
                    flex: 1,
                    minHeight: TAP_TARGET,
                    borderRadius: radius.lg,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: color.borderStrong,
                    backgroundColor: color.surfaceCard,
                  },
                  pressed ? { backgroundColor: color.surfaceSunken } : null,
                ]}
              >
                <Text variant="bodyBold" tone="secondary">
                  {request.cancelLabel}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}
