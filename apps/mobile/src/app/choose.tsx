import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { MerchantType } from '@jibli/contracts';
import { useVertical } from '@/lib/vertical';
import { color, palette, radius, shadow, space, text } from '@/theme';
import { Screen, Text } from '@/ui';
import { Enter } from '@/ui/enter';
import { JibliWordmark } from '@/ui/brand';

/**
 * Which half of Jibli, asked before anything is shown.
 *
 * The switch that used to sit on the home screen could only ever swap the
 * merchant list — the banner above it and the category strip below it belonged
 * to neither half in particular, because they were the same rows for both. And
 * they cannot be: «برجر» is not an aisle, a Ramadan restaurant offer has no
 * place above a grocery basket, and a paid placement is sold for one section
 * rather than for the app.
 *
 * So the question moves in front of the home screen. Two tiles, full width,
 * because this is the whole content of the screen and there is nothing to
 * compete with — the compression that made a segmented control right inside a
 * scrolling page is exactly what is absent here.
 *
 * Each tile carries what its half actually contains rather than only its name.
 * «جيبلي ماركت» means nothing on a first launch; «بقالة ومواد غذائية — يوصل
 * خلال دقائق» is a destination.
 */

const HALVES: readonly {
  readonly type: MerchantType;
  readonly label: string;
  readonly caption: string;
  readonly examples: string;
  readonly icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  readonly tint: string;
  readonly ink: string;
}[] = [
  {
    type: 'RESTAURANT',
    label: 'جيبلي أكل',
    caption: 'مطاعم ووجبات',
    examples: 'مندي · برجر · بيتزا · شاورما · حلويات',
    icon: 'silverware-fork-knife',
    tint: color.brand,
    ink: palette.orange[700],
  },
  {
    type: 'MARKET',
    label: 'جيبلي ماركت',
    caption: 'بقالة ومواد غذائية',
    examples: 'خضار · ألبان · لحوم · مخبوزات · منظفات',
    icon: 'basket-outline',
    // Green, and not as decoration: the two halves must be distinguishable
    // from across the room, not only by reading them.
    tint: palette.success[500],
    ink: palette.success[700],
  },
];

export default function ChooseScreen() {
  const router = useRouter();
  const { choose } = useVertical();

  const enter = (type: MerchantType) => {
    choose(type);
    router.replace('/(tabs)');
  };

  return (
    <Screen edges={['top', 'bottom']} padded={false}>
      <View style={{ flex: 1, padding: space[5], gap: space[5], justifyContent: 'center' }}>
        <Enter delay={0}>
          <View style={{ alignItems: 'center', gap: space[2], marginBottom: space[2] }}>
            <JibliWordmark width={150} tint={color.brand} pinTint={palette.white} />
            <Text variant="h3" style={{ textAlign: 'center' }}>
              شنو تريد اليوم؟
            </Text>
            <Text tone="muted" style={{ textAlign: 'center' }}>
              اختر القسم، وتقدر ترجع تبدّله بأي وقت
            </Text>
          </View>
        </Enter>

        {HALVES.map((half, index) => (
          <Enter key={half.type} delay={80 + index * 80}>
            <Pressable
              onPress={() => enter(half.type)}
              accessibilityRole="button"
              accessibilityLabel={`${half.label} — ${half.caption}`}
              style={({ pressed }) => [
                {
                  borderRadius: radius.xl,
                  backgroundColor: half.tint,
                  padding: space[5],
                  gap: space[2],
                  minHeight: 168,
                  justifyContent: 'center',
                  ...shadow.lg,
                },
                pressed ? { opacity: 0.92, transform: [{ scale: 0.99 }] } : null,
              ]}
            >
              {/*
                A large, low-contrast glyph behind the words rather than beside
                them. Beside, it competes with the label at the one size where
                both are readable; behind, it reads as texture and the tile
                still says one thing.
              */}
              <MaterialCommunityIcons
                name={half.icon}
                size={124}
                color="rgba(255,255,255,0.16)"
                style={{ position: 'absolute', insetInlineStart: -12, bottom: -24 }}
              />

              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: space[3] }}>
                <MaterialCommunityIcons name={half.icon} size={30} color={palette.white} />
                <Text style={{ ...text.h2, color: palette.white }}>{half.label}</Text>
              </View>

              <Text style={{ ...text.bodyBold, color: palette.white, opacity: 0.95 }}>
                {half.caption}
              </Text>
              <Text style={{ ...text.small, color: palette.white, opacity: 0.85 }}>
                {half.examples}
              </Text>
            </Pressable>
          </Enter>
        ))}
      </View>
    </Screen>
  );
}
