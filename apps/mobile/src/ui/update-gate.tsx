import { useEffect, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import Constants from 'expo-constants';
import { onVersionUnsupported } from '@/lib/api';
import { color, space } from '@/theme';
import { Button, Text } from '@/ui';

/**
 * The screen for the one error the customer can actually fix.
 *
 * The server refuses a binary it no longer supports with
 * `APP_VERSION_UNSUPPORTED` (plan §119) — because a contract changed, or a
 * pricing rule the old client would display wrongly, or a bug that must not be
 * allowed to place another order. The app has always sent `X-App-Version` and
 * has always had `ApiError.needsUpdate`, and nothing has ever drawn anything:
 * the refusal surfaced wherever it happened to land, as a generic failure, and
 * the customer retried it forever.
 *
 * This is deliberately a wall and not a banner. Every subsequent request will
 * be refused for the same reason, so letting them carry on browsing only
 * postpones the same dead end to the checkout — which is the worst place to
 * discover it, and the one where a stale client can do real harm.
 *
 * Rendered last in the root layout so it covers the tab bar, the order card
 * and any open sheet. It cannot be dismissed, because there is nothing behind
 * it that works.
 */
export function UpdateGate() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => onVersionUnsupported(setMessage), []);

  if (!message) return null;

  /*
   * Straight to this app's page, not to a search.
   *
   * `itms-apps://` opens the App Store app rather than Safari, and the Play
   * `market://` scheme does the same for Play — both fall back to the https
   * form if the store app is missing, which is why the fallback is tried
   * rather than assumed.
   *
   * The iOS id is only known once App Store Connect has issued one; until then
   * `EXPO_PUBLIC_IOS_APP_ID` is unset and the button opens a search for the
   * name instead of a broken link to id `undefined`.
   */
  const iosAppId = (Constants.expoConfig?.extra as { iosAppId?: string } | undefined)?.iosAppId;
  const androidPackage = 'iq.jibli.app';

  const openStore = () => {
    const [deepLink, webLink] =
      Platform.OS === 'ios'
        ? iosAppId
          ? [`itms-apps://apps.apple.com/app/id${iosAppId}`, `https://apps.apple.com/app/id${iosAppId}`]
          : ['itms-apps://search.itunes.apple.com/WebObjects/MZSearch.woa/wa/search?media=software&term=Jibli', 'https://apps.apple.com/search?term=Jibli']
        : [`market://details?id=${androidPackage}`, `https://play.google.com/store/apps/details?id=${androidPackage}`];

    void Linking.openURL(deepLink).catch(() => {
      void Linking.openURL(webLink).catch(() => undefined);
    });
  };

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: color.surfacePage,
        alignItems: 'center',
        justifyContent: 'center',
        padding: space[6],
        gap: space[4],
      }}
      // A wall, announced as one: a screen reader landing behind it would
      // otherwise read a list of controls that no longer do anything.
      accessibilityViewIsModal
    >
      <Text variant="h2" align="center">
        حدّث التطبيق للمتابعة
      </Text>
      <Text tone="muted" align="center">
        {message}
      </Text>
      <Button label="تحديث الآن" onPress={openStore} style={{ alignSelf: 'center' }} />
    </View>
  );
}
