import { Tabs } from 'expo-router';
import { Text as RNText, View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@/ui/icon';
import { TEXT_SCALE_CEILING } from '@/ui';
import { color, LAID_OUT_RTL, radius, space, TAB_BAR_CONTENT_HEIGHT, text } from '@/theme';

/**
 * The shell.
 *
 * Four tabs, which `main.html` and `9.html` agree on — الرئيسية، المفضلة،
 * طلباتي، حسابي — and which is also the ceiling: a fifth turns the bar into a
 * row of icons nobody reads.
 *
 * Icons are real now rather than the placeholder dots this file shipped with:
 * an outline for the resting state and a solid for the active one, which is
 * how the comps distinguish them and how a tab bar reads at a glance without
 * relying on colour alone.
 *
 * A guest sees all four. المفضلة and طلباتي ask for an account when opened,
 * which is the honest shape — hiding them would tell a browsing customer the
 * app does less than it does.
 */

/** The bar, in reading order: الرئيسية first, حسابي last. */
const TABS = [
  { name: 'index', title: 'الرئيسية', icon: 'home' },
  { name: 'favorites', title: 'المفضلة', icon: 'heart' },
  { name: 'orders', title: 'طلباتي', icon: 'clipboard-list' },
  { name: 'account', title: 'حسابي', icon: 'account' },
] as const;

/**
 * Which tab the app opens on, and which one «back» returns to.
 *
 * Both have to be said out loud once the declaration order stops being the
 * reading order below. React Navigation takes the *first* declared route as
 * the initial one and, by default, sends the Android back button there too —
 * so a bar declared حسابي-first would open the app on the account screen and
 * bounce every back press into it.
 */
const HOME = 'index';

/**
 * The icon's box, and what is drawn in it.
 *
 * The navigator gives every icon a 31×28 slot and draws two copies in it —
 * the active and the resting one, faded between — each absolutely positioned
 * and stretched to the slot. Whatever the icon renders is centred in that
 * slot, and anything taller than it spills out both ends. The dot used to be
 * drawn *below* the icon in normal flow, which made the pair 31 tall in a 28
 * slot: the overflow landed wherever the platform put it, and on a phone the
 * dot sat off to one side of the icon rather than under it.
 *
 * So the box is sized here, once, and the slot is told to match it: the icon
 * is centred in the upper part, and the dot is pinned to the bottom edge and
 * centred by the box itself. Nothing overflows, so nothing drifts.
 */
const ICON_BOX = { width: 31, height: 28 } as const;
const ICON_SIZE = 23;
/** The band the icon is centred in; the dot takes the rest. */
const ICON_BAND = 22;
const DOT = 4;

export default function TabsLayout() {
  /*
   * The bar draws its items in declaration order, left to right, and that row
   * is the one thing in the app `ROW` cannot reach: it lives inside
   * `BottomTabBar`, under a style no navigator option exposes.
   *
   * So the order is reversed here instead, and only where it has to be. When
   * the platform is already laying out right-to-left — a store build where
   * `forceRTL` has taken, or the browser under `dir="rtl"` — that row mirrors
   * itself and reading order is already visual order. When it is not, the app
   * is drawn right-to-left by `ROW` while the tab bar alone still runs the
   * other way, which is exactly the split this removes: الرئيسية on the far
   * right, حسابي on the far left, in both modes.
   */
  const ordered = LAID_OUT_RTL ? TABS : [...TABS].reverse();

  /*
   * The bar's height is the bar plus whatever the system is occupying below it.
   *
   * It used to be a constant — 48 plus 34 on iOS for the home indicator, plus a
   * guessed 14 on Android. The 34 is right; the 14 was a number, not a
   * measurement. An Android phone on three-button navigation reserves about 48
   * there, and because setting `height` explicitly overrides the inset
   * React Navigation would otherwise add, the icons and labels were pushed into
   * the system navigation bar.
   *
   * That stopped being a cosmetic problem when the app moved to API 36:
   * Android 15 enforces edge-to-edge and an app can no longer opt out, so the
   * system bar is drawn over the app's own layout by default on every device.
   *
   * Reading the real inset costs a hook and is correct on all of them — gesture
   * navigation, three-button, and the iOS home indicator alike.
   */
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      initialRouteName={HOME}
      backBehavior="initialRoute"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.brand,
        tabBarInactiveTintColor: color.textMuted,
        tabBarStyle: {
          backgroundColor: color.surfaceCard,
          borderTopColor: color.borderSubtle,
          height: TAB_BAR_CONTENT_HEIGHT + insets.bottom,
          paddingTop: space[1],
          paddingBottom: insets.bottom,
        },
        // The slot the navigator draws the icon in, matched to the box
        // `TabIcon` fills — see `ICON_BOX`.
        tabBarIconStyle: ICON_BOX,
      }}
    >
      {ordered.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: (props) => <TabIcon {...props} name={tab.icon} />,
            /*
             * Drawn here rather than through `tabBarLabelStyle`, so the active
             * label can be heavier than the resting one. Same size either
             * way: `captionBold` is `caption` in the bold cut, so the word
             * does not reflow under the finger that selected it.
             */
            tabBarLabel: ({ focused, color: tint }) => (
              <RNText
                numberOfLines={1}
                maxFontSizeMultiplier={TEXT_SCALE_CEILING}
                style={[
                  focused ? text.captionBold : text.caption,
                  { color: tint, textAlign: 'center' },
                ]}
              >
                {tab.title}
              </RNText>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

/** Outline when resting, solid plus a dot when active — as the comps draw it. */
function TabIcon({
  color: tint,
  focused,
  name,
}: {
  /*
   * `ColorValue`, not `string`, since SDK 57.
   *
   * React Native widened every colour prop to admit its own opaque handles —
   * a platform colour or a processed one — and expo-router passes the tab
   * bar's tint straight through. Both consumers below take `ColorValue`
   * already, so this is only the declaration catching up with what was always
   * being handed to it.
   */
  color: ColorValue;
  focused: boolean;
  name: 'home' | 'heart' | 'clipboard-list' | 'account';
}) {
  return (
    <View style={{ width: ICON_BOX.width, height: ICON_BOX.height, alignItems: 'center' }}>
      <View style={{ height: ICON_BAND, justifyContent: 'center' }}>
        <MaterialCommunityIcons
          name={focused ? name : (`${name}-outline` as const)}
          size={ICON_SIZE}
          color={tint}
        />
      </View>

      {/*
       * Always drawn, so the icon sits at the same height on every tab; only
       * the colour says which one is open. Absolute, on the bottom edge, and
       * centred by the box — the one arrangement that cannot end up beside
       * the icon.
       */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          alignSelf: 'center',
          width: DOT,
          height: DOT,
          borderRadius: radius.full,
          backgroundColor: focused ? tint : 'transparent',
        }}
      />
    </View>
  );
}
