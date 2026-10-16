import { useState } from 'react';
import { Linking, Pressable, TextInput, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import MaterialCommunityIcons from '@/ui/icon';
import { api, ApiError } from '@/lib/api';
import { configString } from '@/lib/app-config';
import { notify } from '@/lib/dialog';
import { ROW, color, palette, radius, space, TAP_TARGET, text } from '@/theme';
import { Button, Row, Text } from './index';
import { Sheet } from './catalog';

/**
 * Rating an order.
 *
 * The window opens a quarter of an hour after delivery and the server owns
 * that rule — this sheet is only reachable when it has said so. The stars are
 * the required part; the comment is not, because a customer who wants to give
 * five stars and move on should not be made to write a sentence first.
 *
 * A comment is text the shop and other people read, so it carries the one
 * thing both stores require of user content: the author agrees to the
 * content rules first. The box appears only once something is typed — a
 * rating alone is not text and stays one tap.
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
  const [accepted, setAccepted] = useState(false);
  const hasComment = comment.trim().length > 0;

  const submit = useMutation({
    mutationFn: () =>
      api.submitReview(orderId, rating, comment.trim() || undefined, hasComment && accepted),
    onSuccess: (result) => {
      setRating(0);
      setComment('');
      setAccepted(false);
      // A held comment is not an error, but the author should know why it is not
      // visible yet; a published one gets a short thank-you rather than closing
      // in silence (CUST-15).
      if (result.held) notify('شكراً لتقييمك', result.note_ar);
      else notify('شكراً', 'تم تسجيل تقييمك.');
      onSubmitted();
    },
    onError: (error) =>
      notify('تعذّر إرسال التقييم', error instanceof ApiError ? error.messageAr : 'حاول مرة أخرى.'),
  });

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="كيف كان طلبك؟"
      footer={
        <View style={{ gap: space[1] }}>
          <Button
            label="إرسال التقييم"
            block
            disabled={rating === 0 || (hasComment && !accepted) || submit.isPending}
            loading={submit.isPending}
            onPress={() => submit.mutate()}
          />
          {/* A visible way out, so the sheet is not dismissible only by the
              backdrop or the Android back button (CUST-15). */}
          <Pressable
            onPress={onClose}
            disabled={submit.isPending}
            accessibilityRole="button"
            accessibilityLabel="لاحقاً"
            style={({ pressed }) => [
              { minHeight: TAP_TARGET, alignItems: 'center', justifyContent: 'center' },
              pressed ? { opacity: 0.6 } : null,
            ]}
          >
            <Text variant="smallBold" tone="muted">
              لاحقاً
            </Text>
          </Pressable>
        </View>
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

      {hasComment ? (
        <View style={{ gap: space[1] }}>
          <Pressable
            onPress={() => setAccepted((value) => !value)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: accepted }}
            accessibilityLabel="أوافق على قواعد المحتوى"
            style={{
              flexDirection: ROW,
              alignItems: 'flex-start',
              gap: space[2],
              minHeight: TAP_TARGET,
            }}
          >
            <MaterialCommunityIcons
              name={accepted ? 'checkbox-marked' : 'checkbox-blank-outline'}
              size={22}
              color={accepted ? color.brand : color.textMuted}
            />
            <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
              أوافق على قواعد المحتوى: لا شتائم ولا إساءة، ولا أرقام هواتف أو روابط. يراجع فريق
              جيبلي التعليقات المخالفة ويحذفها.
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              const url = configString('termsUrl');
              if (url) void Linking.openURL(url).catch(() => undefined);
            }}
            accessibilityRole="link"
            style={{ alignSelf: 'flex-start', paddingVertical: space[1] }}
          >
            <Text variant="caption" tone="brand">
              قراءة الشروط وقواعد المحتوى
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View style={{ height: space[1] }} />
    </Sheet>
  );
}
