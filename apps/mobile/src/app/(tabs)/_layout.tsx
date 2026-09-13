import { Tabs } from 'expo-router';
import { Platform, View } from 'react-native';
import { color, palette, space, TAP_TARGET, text } from '@/theme';

/**
 * The signed-in shell.
 *
 * The root layout has declared a `(tabs)` group since the project was created
 * and the directory never existed, so a customer who signed in successfully
 * landed on an empty stack. This is that group.
 *
 * Four tabs, which is the ceiling: a fifth turns the bar into a row of icons
 * nobody reads, and everything else in this product is reachable from inside
 * one of these four.
 *
 * Icons are drawn as shapes rather than pulled from an icon font, for the same
 * reason the app icon is: the designs have not arrived yet, and a placeholder
 * that is obviously a placeholder is better than committing to an icon set that
 * will be replaced.
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
          // Room for the home indicator on iOS, where the bar sits over it.
          height: TAP_TARGET + (Platform.OS === 'ios' ? 34 : 12),
          paddingTop: space[1],
        },
        tabBarLabelStyle: text.caption,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'الرئيسية',
          tabBarIcon: ({ color: tint, focused }) => <TabDot tint={tint} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'طلباتي',
          tabBarIcon: ({ color: tint, focused }) => <TabDot tint={tint} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'حسابي',
          tabBarIcon: ({ color: tint, focused }) => <TabDot tint={tint} focused={focused} />,
        }}
      />
    </Tabs>
  );
}

/** A placeholder mark, sized to the icon slot the real set will occupy. */
function TabDot({ tint, focused }: { tint: string; focused: boolean }) {
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 2,
        borderColor: tint,
        backgroundColor: focused ? tint : palette.white,
      }}
    />
  );
}
