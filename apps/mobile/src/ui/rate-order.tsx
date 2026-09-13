import { useState } from 'react';
import { Alert, Pressable, TextInput, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { api, ApiError } from '@/lib/api';
import { color, palette, radius, space, TAP_TARGET, text } from '@/theme';
import { Button, Row, Text } from './index';
import { Sheet } from './catalog';

/**
 * Rating an order.
 *
 * The window opens a quarter of an hour after delivery and the server owns
 * that rule — this sheet is only reachable when it has said so. The stars are
 * the required part; the comment is not, because a customer who wants to give
 * five stars and move on should not be made to write a sentence first.
 */

const WORDS = ['', 'سيئ', 'مقبول', 'جيد', 'جيد جداً', 'ممتاز'] as const;

export function RateOrderSheet({
  visible,
  orderId,
  restaurantName,
  onClose,
  onSubmitted,
}: {
  visible: boolean;
  orderId: string;
  restaurantName: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');

  const submit = useMutation({
    mutationFn: () => api.submitReview(orderId, rating, comment.trim() || undefined),
    onSuccess: () => {
      setRating(0);
      setComment('');
      onSubmitted();
    },
    onError: (error) =>
      Alert.alert(
        'تعذّر إرسال التقييم',
        error instanceof ApiError ? error.messageAr : 'حاول مرة أخرى.',
      ),
  });

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="كيف كان طلبك؟"
      footer={
        <Button
          label="إرسال التقييم"
          block
          disabled={rating === 0 || submit.isPending}
          loading={submit.isPending}
          onPress={() => submit.mutate()}
        />
      }
    >
      <Text tone="secondary" align="center">
        {restaurantName}
      </Text>

      <Row gap={space[2]} justify="center" style={{ paddingVertical: space[2] }}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Pressable
            key={star}
            onPress={() => setRating(star)}
            accessibilityRole="radio"
            accessibilityState={{ selected: rating === star }}
            accessibilityLabel={`${star} من ٥`}
            style={{
              width: TAP_TARGET,
              height: TAP_TARGET,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MaterialCommunityIcons
              name={star <= rating ? 'star' : 'star-outline'}
              size={34}
              color={star <= rating ? palette.warning[500] : color.borderStrong}
            />
          </Pressable>
        ))}
      </Row>

      {/*
       * The word under the stars, not just the count: «جيد جداً» is what
       * someone means, and it also tells a screen-reader user what they picked
       * without counting announcements.
       */}
      <Text align="center" variant="smallBold" tone={rating > 0 ? 'brand' : 'muted'}>
        {rating > 0 ? WORDS[rating] : 'اختر تقييمك'}
      </Text>

      <TextInput
        value={comment}
        onChangeText={setComment}
        placeholder="أضف ملاحظة (اختياري)"
        placeholderTextColor={color.textMuted}
        accessibilityLabel="ملاحظة على الطلب"
        multiline
        maxLength={500}
        style={[
          text.small,
          {
            minHeight: 96,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: color.borderSubtle,
            backgroundColor: color.surfaceCard,
            padding: space[3],
            color: color.textPrimary,
            textAlignVertical: 'top',
          },
        ]}
      />

      <View style={{ height: space[1] }} />
    </Sheet>
  );
}
