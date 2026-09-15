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
import { AreaProvider } from '@/lib/area';
import { CartProvider } from '@/lib/cart';
import { OfflineBanner, startNetworkWatch } from '@/lib/network';
import { ActiveOrderBar, OrderWatchProvider } from '@/lib/order-watch';
import { GlobalCartBar } from '@/lib/cart-dock';
import { ErrorBoundary } from '@/lib/error-boundary';
import { DialogHost } from '@/ui/dialog-host';
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
            <AreaProvider>
              <CartProvider>
                {/*
                 * Inside the router's tree and outside every screen: the bar
                 * has to survive navigation to be worth anything, and the
                 * watcher behind it has to keep polling while the customer is
                 * three screens away reading a different menu.
                 */}
                <OrderWatchProvider>
                  <StatusBar style="dark" />
                  <OfflineBanner />
                  <Gate />
                  {/*
                   * After the screens, not before them. The card floats over
                   * whatever is showing, and React Native stacks by order —
                   * drawn first, it would sit under every screen it is meant
                   * to float above.
                   */}
                  <ActiveOrderBar />
                  <GlobalCartBar />
                  {/*
                   * Last of all, so a dialog sits above every bar and sheet
                   * the app can have open — which is the whole point of one.
                   */}
                  <DialogHost />
                </OrderWatchProvider>
              </CartProvider>
            </AreaProvider>
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
    const onWelcome = path[1] === 'welcome';

    /*
     * Signed out and undecided: the welcome screen, not the phone screen.
     *
     * Sending someone straight to "enter your number" is the App Store 5.1.1(ii)
     * rejection — registration demanded for content that does not require it.
     * The welcome screen offers browsing as a guest beside signing in, and the
     * number is asked for at checkout, where an account genuinely is needed.
     */
    if (state.status === 'signed-out' && !inAuth) {
      router.replace('/(auth)/welcome');
      return;
    }

    /*
     * A guest is a signed-in-enough user as far as routing goes: they may be
     * anywhere except the welcome screen, which they have already answered.
     * Reaching sign-in from inside the app is a deliberate move, not something
     * to redirect away from.
     */
    if (state.status === 'guest') {
      if (onWelcome) router.replace('/(tabs)');
      return;
    }

    if (state.status === 'needs-profile' && path[1] !== 'profile') {
      router.replace('/(auth)/profile');
      return;
    }

    /*
     * Signed in and complete, but still sitting on a sign-in screen: this is
     * the hop after a successful OTP.
     *
     * The courier sign-in is the exception, and it has to be an explicit one.
     * That screen sends its own user to `/(driver)/delivery`, and effects run
     * child-first — so without this the Gate would win the race every time and
     * land a driver on the customer home screen a tick before their own screen
     * could ask for anything.
     */
    const onDriverLogin = path[1] === 'driver-login';

    if (
      (state.status === 'ready' || state.status === 'offline-ready') &&
      inAuth &&
      !onDriverLogin
    ) {
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
