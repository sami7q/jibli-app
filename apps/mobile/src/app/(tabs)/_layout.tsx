import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { color, radius, space, TAB_BAR_HEIGHT, text } from '@/theme';

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
export default function TabsLayout() {
  return (
    <Tabs
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
      <Tabs.Screen
        name="index"
        options={{
          title: 'الرئيسية',
          tabBarIcon: (props) => <TabIcon {...props} name="home" />,
        }}
      />
      <Tabs.Screen
        name="favorites"
        options={{
          title: 'المفضلة',
          tabBarIcon: (props) => <TabIcon {...props} name="heart" />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'طلباتي',
          tabBarIcon: (props) => <TabIcon {...props} name="clipboard-list" />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'حسابي',
          tabBarIcon: (props) => <TabIcon {...props} name="account" />,
        }}
      />
    </Tabs>
  );
}

/** Outline when resting, solid plus a dot when active — as the comps draw it. */
function TabIcon({
  color: tint,
  focused,
  name,
}: {
  color: string;
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
