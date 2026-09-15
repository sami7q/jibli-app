import { Tabs } from 'expo-router';
import { View, type ColorValue } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { color, LAID_OUT_RTL, radius, space, TAB_BAR_HEIGHT, text } from '@/theme';

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
          height: TAB_BAR_HEIGHT,
          paddingTop: space[1],
        },
        tabBarLabelStyle: text.caption,
      }}
    >
      {ordered.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: (props) => <TabIcon {...props} name={tab.icon} />,
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
    <View style={{ alignItems: 'center', gap: 3 }}>
      <MaterialCommunityIcons
        name={focused ? name : (`${name}-outline` as const)}
        size={23}
        color={tint}
      />
      <View
        style={{
          width: 5,
          height: 5,
          borderRadius: radius.full,
          backgroundColor: focused ? tint : 'transparent',
        }}
      />
    </View>
  );
}
