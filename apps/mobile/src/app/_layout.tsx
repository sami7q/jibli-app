import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
/*
 * Five faces, imported one file at a time.
 *
 * `@expo-google-fonts/cairo` has no `exports` map and its index `require()`s
 * all eight weights, so naming five of them still bundled ExtraLight, Light and
 * Black — 290 KB of font the app has no way to render, since `FAMILY_FOR_WEIGHT`
 * maps only these five. Metro keeps a required asset whether or not anything
 * reads the binding.
 *
 * Reaching past the index is what drops them: each path is one asset, and the
 * three nobody uses are no longer reachable from the graph at all.
 */
import Cairo_400Regular from '@expo-google-fonts/cairo/Cairo_400Regular.ttf';
import Cairo_500Medium from '@expo-google-fonts/cairo/Cairo_500Medium.ttf';
import Cairo_600SemiBold from '@expo-google-fonts/cairo/Cairo_600SemiBold.ttf';
import Cairo_700Bold from '@expo-google-fonts/cairo/Cairo_700Bold.ttf';
import Cairo_800ExtraBold from '@expo-google-fonts/cairo/Cairo_800ExtraBold.ttf';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiError, NetworkError } from '@/lib/api';
import { usePushNavigation } from '@/lib/push';
import { SessionProvider, useSession } from '@/lib/session';
import { signedInDestination } from '@/lib/after-sign-in';
import { UpdateGate } from '@/ui/update-gate';
import { AreaProvider } from '@/lib/area';
import { VerticalProvider, useVertical } from '@/lib/vertical';
import { CartProvider } from '@/lib/cart';
import { OfflineBanner, startNetworkWatch } from '@/lib/network';
import { ActiveOrderBar, OrderWatchProvider } from '@/lib/order-watch';
import { WorkLiveProvider } from '@/lib/work-live';
import { WorkAlertBar } from '@/ui/work-alert-bar';
import { GlobalCartBar } from '@/lib/cart-dock';
import { ErrorBoundary } from '@/lib/error-boundary';
import { startMonitoring } from '@/lib/monitoring';
import { DialogHost } from '@/ui/dialog-host';
import { DirectionProbe } from '@/ui/direction-probe';
import { LaunchIntro } from '@/ui/launch-intro';
import { ICON_FONT, ICON_FONT_FAMILY } from '@/ui/icon';
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

/*
 * The customer tabs are the app's anchor, so a cold start resolves to Home.
 *
 * Owner Mode's home now lives at `/(owner)/owner`, a real URL segment, so it no
 * longer ties with `(tabs)/index` at `/` — but this names the tabs as the
 * initial route outright, so the first screen a reviewer sees on launch or
 * reload is the customer home and never the seller screen (CUST-3).
 */
export const unstable_settings = { initialRouteName: '(tabs)' };

/*
 * Before anything can throw.
 *
 * At module scope for the same reason `enforceRtl` is: a crash during the very
 * first render — a bad font, a provider throwing on boot — is exactly the one
 * worth hearing about, and a reporter started inside a component would miss it.
 *
 * Does nothing without EXPO_PUBLIC_SENTRY_DSN. See src/lib/monitoring.ts.
 */
startMonitoring();

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
    /*
     * The icon font, loaded here rather than left to itself.
     *
     * `createIconSet` loads its own font in `componentDidMount` and renders an
     * empty `<Text/>` until it arrives — so every icon on the first screen pops
     * in a frame or two late, which on the tab bar is four holes that fill
     * themselves. Loading it with the text faces means it is already there when
     * the splash lifts, at no extra cost: it is the same file either way, 17 KB,
     * and the splash is already being held for Cairo.
     *
     * The key must be the family name `src/ui/icon.tsx` passed to
     * `createIconSet`, because that is what its `Font.isLoaded` check asks for.
     */
    [ICON_FONT_FAMILY]: ICON_FONT,
  });

  useEffect(() => startNetworkWatch(), []);

  /*
   * Which way the native layer actually lays out, measured before anything
   * that cares about it renders.
   *
   * `enforceRtl` above has *asked* for right-to-left; whether the platform
   * obliged is a separate fact, and one the flag has been seen to get wrong.
   * The probe lays out one hidden row, reads the answer off the layout, and
   * sets the theme's direction tokens from it — so every screen below renders
   * against the truth, on the first launch as on the hundredth.
   *
   * It keeps watching. A JavaScript reload has been seen to lay out its first
   * frame one way and mirror on the next, so the answer can change after the
   * screens are up; when it does, `generation` moves and everything under the
   * providers is drawn again from the new tokens. The providers themselves —
   * the session, the cart, the order watcher — keep their state through it.
   */
  const [direction, setDirection] = useState({ known: false, mirrored: false, generation: 0 });
  const probe = (
    <DirectionProbe
      onMeasured={(mirrored) =>
        setDirection((current) =>
          current.known && current.mirrored === mirrored
            ? current
            : { known: true, mirrored, generation: current.generation + 1 },
        )
      }
    />
  );

  /*
   * A font that fails to load is not a reason to show nothing. The system
   * Arabic face is worse-looking, not unreadable, and a blank screen is the
   * only outcome that loses the user entirely.
   */
  if (!direction.known || (!fontsLoaded && !fontError)) {
    return <View style={{ flex: 1, backgroundColor: color.brand }}>{probe}</View>;
  }

  return (
    <View style={{ flex: 1 }}>
      {probe}
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <SessionProvider>
              <VerticalProvider>
                <AreaProvider>
                  <CartProvider>
                    {/*
                     * Inside the router's tree and outside every screen: the bar
                     * has to survive navigation to be worth anything, and the
                     * watcher behind it has to keep polling while the customer is
                     * three screens away reading a different menu.
                     */}
                    <OrderWatchProvider>
                      {/*
                       * The shop's and the courier's live work: rings for a new
                       * order or task whatever screen is open. Idle for anyone
                       * who is neither.
                       */}
                      <WorkLiveProvider>
                        {/*
                         * Keyed by the direction measurement: a changed answer
                         * remounts everything the customer sees, under providers
                         * that keep their state. See the note by `direction`.
                         */}
                        <Fragment key={direction.generation}>
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
                          {/* Above the customer's bars: somebody is waiting on this one. */}
                          <WorkAlertBar />
                          {/*
                           * Last of all, so a dialog sits above every bar and sheet
                           * the app can have open — which is the whole point of one.
                           */}
                          <DialogHost />
                          {/*
                           * Above even the dialogs. When the server has said this
                           * binary may no longer be used, there is nothing underneath
                           * worth interacting with — including a dialog asking to
                           * confirm something the next request will refuse.
                           */}
                          <UpdateGate />
                        </Fragment>
                      </WorkLiveProvider>
                    </OrderWatchProvider>
                  </CartProvider>
                </AreaProvider>
              </VerticalProvider>
            </SessionProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </View>
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
  const { vertical, resolved: verticalResolved } = useVertical();
  const router = useRouter();
  const segments = useSegments();

  /*
   * Here rather than in `RootLayout` because it navigates, and the navigator
   * only exists from this point down. A tap handled above it goes nowhere.
   */
  usePushNavigation();

  /*
   * The opening animation plays on every launch, over whatever the router is
   * setting up underneath (see `LaunchIntro`), and the launch's own routing
   * decision is made exactly once — later navigation inside the app is the
   * customer's, not something to second-guess.
   */
  const [introDone, setIntroDone] = useState(false);
  const finishIntro = useCallback(() => setIntroDone(true), []);
  const launchRouted = useRef(false);

  useEffect(() => {
    if (state.status === 'loading') return;

    void SplashScreen.hideAsync();

    // Typed as a narrow tuple by expo-router's generated routes, so it is read
    // as plain strings here rather than fighting the generated type.
    const path = segments as readonly string[];
    const inAuth = path[0] === '(auth)';
    const onChooser = path[0] === 'choose';
    /*
     * The two groups that are not the customer app.
     *
     * A courier on a delivery and a grocer pricing a shelf are both signed in
     * to do one job, and neither of the rules below is about them: they have no
     * answer to «أكل أم ماركت؟» because they are not shopping, and bouncing
     * them to the chooser strands them one screen short of the thing they
     * opened the app for.
     */
    const inWorkMode = path[0] === '(driver)' || path[0] === '(owner)';

    /*
     * Screens that carry their own section or do not need one, so they must
     * survive a reload or a deep link rather than being bounced to the chooser
     * with their contents intact (CUST-7). A shop page, a cart, a checkout, an
     * order and the notifications feed are all about one specific thing already.
     */
    const carriesOwnContext =
      path[0] === 'cart' ||
      path[0] === 'checkout' ||
      path[0] === 'order' ||
      path[0] === 'restaurant' ||
      path[0] === 'notifications';

    /*
     * Where a launch begins.
     *
     * Signed in: straight to the three sections — «طعام / كوزمتك / ماركت» —
     * every time, so the app opens on the question it is built around rather
     * than on whichever list was open last. A shop owner opens onto their
     * shop. Not signed in, a guest included: the welcome screen, which signs
     * in or registers and still offers browsing as a guest (App Store
     * 5.1.1(ii)); both of its doors lead on to the sections.
     *
     * A launch that arrives somewhere specific — a notification opening an
     * order, a link to a shop, a courier or owner screen — is left where it is.
     */
    if (!launchRouted.current) {
      launchRouted.current = true;
      if (!carriesOwnContext && !inWorkMode && !inAuth) {
        if (state.status === 'ready' || state.status === 'offline-ready') {
          const me = state.me;
          const ownsShop = Object.keys(me?.restaurant_roles ?? {}).length > 0;
          router.replace((ownsShop ? '/(owner)/owner' : '/choose') as never);
          return;
        }
        if (state.status === 'guest') {
          router.replace('/(auth)/welcome');
          return;
        }
      }
    }

    /*
     * Nothing can render until the half is known.
     *
     * The home screen's banner, category strip and merchant list all belong to
     * one section or the other, so there is no correct thing to draw without
     * an answer — a default would simply be a guess shown as fact. The chooser
     * is the answer, and it sits outside the tabs so the tab bar does not
     * appear under a screen that is not part of the app yet.
     *
     * Only once the persisted choice has been read (`verticalResolved`), so a
     * remembered section is not overwritten by a chooser redirect in the frame
     * before it lands. Checked before the sign-in rules on purpose: browsing is
     * public, and a guest picks a section exactly as a signed-in customer does.
     */
    if (
      verticalResolved &&
      !vertical &&
      !onChooser &&
      !inAuth &&
      !inWorkMode &&
      !carriesOwnContext
    ) {
      router.replace('/choose');
      return;
    }

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
    if (state.status === 'guest') return;

    if (state.status === 'needs-profile' && path[1] !== 'profile') {
      router.replace('/(auth)/profile');
      return;
    }

    /*
     * Signed in and complete, but still sitting on a sign-in screen: this is
     * the hop after a successful OTP.
     *
     * The two portal sign-ins are the exception, and it has to be an explicit
     * one. Each sends its own user onward — a courier to `/(driver)/delivery`,
     * a shopkeeper to `/(owner)` — and effects run child-first, so without this
     * the Gate would win the race every time and land them on the customer home
     * screen a tick before their own screen could ask for anything.
     */
    const onPortalSignIn = path[1] === 'driver-login' || path[1] === 'owner-login';
    /*
     * «صاحب متجر؟» is a question, and a signed-in customer may be asked it
     * too — on the way back from the form, or from the welcome screen after
     * signing in. It sends people on itself; it is not a screen to be
     * hurried off.
     */
    const onPartnerDoors = path[1] === 'partner';

    if (
      (state.status === 'ready' || state.status === 'offline-ready') &&
      inAuth &&
      !onPortalSignIn &&
      !onPartnerDoors
    ) {
      // The same answer the sign-in screens give, so neither can win a race
      // against the other and strand someone who came to register a shop.
      router.replace(signedInDestination() as never);
    }
  }, [state, vertical, verticalResolved, segments, router]);

  /*
   * One tree whether or not the session has answered, so the intro starts the
   * moment the app opens and keeps running while the session resolves under
   * it, instead of a spinner first and the animation after.
   */
  const loading = state.status === 'loading';
  return (
    <View style={{ flex: 1, backgroundColor: loading ? color.brand : undefined }}>
      {loading ? (
        introDone ? (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <ActivityIndicator size="large" color={palette.white} />
          </View>
        ) : null
      ) : (
        <Slot />
      )}
      {introDone ? null : <LaunchIntro onDone={finishIntro} />}
    </View>
  );
}
