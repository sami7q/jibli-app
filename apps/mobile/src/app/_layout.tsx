import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import {
  Cairo_400Regular,
  Cairo_500Medium,
  Cairo_600SemiBold,
  Cairo_700Bold,
  Cairo_800ExtraBold,
} from '@expo-google-fonts/cairo';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiError, NetworkError } from '@/lib/api';
import { SessionProvider, useSession } from '@/lib/session';
import { OfflineBanner, startNetworkWatch } from '@/lib/network';
import { ErrorBoundary } from '@/lib/error-boundary';
import { color, enforceRtl, palette } from '@/theme';

/**
 * App root.
 *
 * Four things have to be true before the first screen renders, and the order
 * matters:
 *
 *   1. **RTL, at module scope.** Release 1 is Arabic-only regardless of device
 *      locale (plan §2), and `forceRTL` must be set before any layout happens.
 *   2. **Fonts loaded.** Text painted before Cairo arrives renders in the
 *      system Arabic face and then reflows — visible, and worse on a slow
 *      device where it lasts long enough to read.
 *   3. **The session resolved**, so a returning customer lands on Home and an
 *      incomplete profile is routed to the mandatory flow (plan §11).
 *   4. **The splash held** until 2 and 3 are done, rather than flashing an
 *      empty screen between them.
 */

// Must run before the first render, so it runs at module scope.
enforceRtl();

// Held until the app can actually paint; see `Gate` below.
void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // A business error is an answer, not a failure — retrying it is noise.
        if (error instanceof ApiError) return false;
        // A flaky mobile connection deserves a couple of attempts.
        if (error instanceof NetworkError) return failureCount < 3;
        return failureCount < 1;
      },
    },
    mutations: { retry: false },
  },
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Cairo_400Regular,
    Cairo_500Medium,
    Cairo_600SemiBold,
    Cairo_700Bold,
    Cairo_800ExtraBold,
  });

  useEffect(() => startNetworkWatch(), []);

  /*
   * A font that fails to load is not a reason to show nothing. The system
   * Arabic face is worse-looking, not unreadable, and a blank screen is the
   * only outcome that loses the user entirely.
   */
  if (!fontsLoaded && !fontError) {
    return <View style={{ flex: 1, backgroundColor: color.brand }} />;
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <StatusBar style="dark" />
            <OfflineBanner />
            <Gate />
          </SessionProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

/**
 * Routes to the right group for the session, and nothing else.
 *
 * Kept separate from `RootLayout` because it must be *inside* the provider to
 * read it — and separate from the screens because a redirect that lives in a
 * screen fires after that screen has already rendered, which is how a
 * signed-out user sees a flash of the home page.
 *
 * The `segments` check is what stops the loop: redirecting to `(auth)` from
 * inside `(auth)` re-runs the effect forever.
 */
function Gate() {
  const { state } = useSession();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (state.status === 'loading') return;

    void SplashScreen.hideAsync();

    // Typed as a narrow tuple by expo-router's generated routes, so it is read
    // as plain strings here rather than fighting the generated type.
    const path = segments as readonly string[];
    const inAuth = path[0] === '(auth)';

    if (state.status === 'signed-out' && !inAuth) {
      router.replace('/(auth)/phone');
      return;
    }

    if (state.status === 'needs-profile' && path[1] !== 'profile') {
      router.replace('/(auth)/profile');
      return;
    }

    // Signed in and complete, but still sitting on a sign-in screen: this is
    // the hop after a successful OTP.
    if ((state.status === 'ready' || state.status === 'offline-ready') && inAuth) {
      router.replace('/(tabs)');
    }
  }, [state, segments, router]);

  if (state.status === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: color.brand, justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={palette.white} />
      </View>
    );
  }

  return <Slot />;
}
