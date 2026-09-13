import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import { View } from 'react-native';
import { color, space } from '@/theme';
import { Text } from '@/ui';

/**
 * Whether the phone can reach anything.
 *
 * Two separate jobs, and it matters that they are separate:
 *
 *   React Query needs to know so it stops retrying into a dead radio and
 *   resumes the moment the connection returns. Without this it burns battery
 *   retrying on a train and then shows stale data for a minute after the
 *   signal comes back, because nothing told it to refetch.
 *
 *   The user needs to know, because "the button did nothing" and "you have no
 *   signal" are the same experience without a banner saying which.
 *
 * `isInternetReachable` rather than `isConnected`: an Iraqi café's wifi that
 * has dropped its uplink is connected and useless, and that case is common
 * enough to be the one worth handling.
 */

/**
 * Wire NetInfo into React Query. Call once, at the app root.
 *
 * `setEventListener` returns nothing — the unsubscribe belongs to the NetInfo
 * subscription the callback creates — so it is captured here and handed back
 * for the effect to clean up.
 */
export function startNetworkWatch(): () => void {
  let unsubscribe: (() => void) | undefined;

  onlineManager.setEventListener((setOnline) => {
    unsubscribe = NetInfo.addEventListener((state) => {
      setOnline(state.isConnected === true && state.isInternetReachable !== false);
    });
    return unsubscribe;
  });

  return () => unsubscribe?.();
}

export function useIsOffline(): boolean {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setOffline(state.isConnected !== true || state.isInternetReachable === false);
    });
    return unsubscribe;
  }, []);

  return offline;
}

/**
 * A bar, not a dialog.
 *
 * Losing signal mid-scroll is not an error to acknowledge — the app still
 * works from cache, and a modal would interrupt someone who was reading a menu.
 */
export function OfflineBanner() {
  const offline = useIsOffline();
  if (!offline) return null;

  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        backgroundColor: color.warningSoft,
        paddingVertical: space[2],
        paddingHorizontal: space[4],
        borderBottomWidth: 1,
        borderBottomColor: color.warning,
      }}
    >
      <Text variant="caption" align="center" style={{ color: color.warningStrong }}>
        لا يوجد اتصال بالإنترنت — ما تراه محفوظ مسبقاً
      </Text>
    </View>
  );
}
