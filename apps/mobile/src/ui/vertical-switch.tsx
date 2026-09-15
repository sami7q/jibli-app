import { Pressable, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { MerchantType } from '@jibli/contracts';
import { color, palette, radius, shadow, space, text } from '@/theme';
import { Text } from '@/ui';

/**
 * The two halves of Jibli, chosen at the top of the home screen.
 *
 * A segmented control rather than two hero tiles. Tiles are what the Turkish
 * delivery apps use, and they work there because those apps carry five or six
 * verticals — groceries, food, water, pharmacy — where a grid is the only
 * honest shape. Jibli has two, and two tiles would spend the most valuable
 * band of the screen on a choice most customers make once and never revisit,
 * pushing the banner and the first restaurant below the fold.
 *
 * So: one row, both halves always visible and legible, the active one filled.
 * It reads as a switch, which is what it is, and it costs about ninety points
 * of height instead of two hundred and forty.
 *
 * Each half says what it holds rather than only naming itself — «مطاعم ووجبات»
 * under أكل — because «جيبلي ماركت» means nothing to somebody opening the app
 * for the first time, and the subtitle is what turns a brand name into a
 * destination.
 */

const HALVES: readonly {
  readonly type: MerchantType;
  readonly label: string;
  readonly caption: string;
  readonly icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
}[] = [
  {
    type: 'RESTAURANT',
    label: 'جيبلي أكل',
    caption: 'مطاعم ووجبات',
    icon: 'silverware-fork-knife',
  },
  {
    type: 'MARKET',
    label: 'جيبلي ماركت',
    caption: 'بقالة ومواد غذائية',
    icon: 'basket-outline',
  },
];

export function VerticalSwitch({
  value,
  onChange,
}: {
  value: MerchantType;
  onChange: (next: MerchantType) => void;
}) {
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row-reverse',
        gap: space[3],
      }}
    >
      {HALVES.map((half) => {
        const active = half.type === value;

        return (
          <Pressable
            key={half.type}
            onPress={() => onChange(half.type)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${half.label} — ${half.caption}`}
            style={({ pressed }) => [
              {
                flex: 1,
                flexDirection: 'row-reverse',
                alignItems: 'center',
                gap: space[2],
                paddingVertical: space[3],
                paddingHorizontal: space[3],
                borderRadius: radius.lg,
                borderWidth: 1.5,
                borderColor: active ? color.brand : color.borderSubtle,
                backgroundColor: active ? color.brand : color.surfaceCard,
              },
              // The shadow only on the active half: two raised cards side by
              // side read as two buttons neither of which is chosen.
              active ? shadow.sm : null,
              pressed && !active ? { backgroundColor: color.surfaceSunken } : null,
            ]}
          >
            <MaterialCommunityIcons
              name={half.icon}
              size={22}
              color={active ? palette.white : color.brand}
            />
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  ...text.smallBold,
                  color: active ? palette.white : color.textPrimary,
                }}
                numberOfLines={1}
              >
                {half.label}
              </Text>
              <Text
                style={{
                  ...text.caption,
                  color: active ? palette.white : color.textMuted,
                  opacity: active ? 0.9 : 1,
                }}
                numberOfLines={1}
              >
                {half.caption}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
