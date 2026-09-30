import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import Icon from '@/ui/icon';
import { ROW, TAP_TARGET, color, lazySheet, palette, radius, space, text } from '@/theme';

/**
 * A password box with a lock, and an eye that reveals what was typed.
 *
 * The reveal is not a nicety on this screen. The customer is on a phone
 * keyboard that has to be switched between Arabic and Latin to satisfy the
 * "letters and a digit" rule, typing into dots — and a signup form that cannot
 * be checked before submitting is a signup form people abandon. Every consumer
 * app has settled on this control for the same reason.
 *
 * `secureTextEntry` toggles rather than the field being replaced, so the
 * keyboard does not dismiss and the cursor does not jump on reveal.
 */
export function PasswordField({
  value,
  onChangeText,
  placeholder = 'كلمة السر',
  accessibilityLabel = 'كلمة السر',
  editable = true,
  autoComplete = 'current-password',
  textContentType = 'password',
  onSubmitEditing,
  returnKeyType,
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  accessibilityLabel?: string;
  editable?: boolean;
  /** `new-password` on signup, so the keychain offers to save rather than fill. */
  autoComplete?: TextInputProps['autoComplete'];
  textContentType?: TextInputProps['textContentType'];
  onSubmitEditing?: () => void;
  returnKeyType?: TextInputProps['returnKeyType'];
}) {
  const [revealed, setRevealed] = useState(false);

  return (
    <View style={styles.row}>
      {/*
       * The lock leads and the eye trails. `ROW` reads right-to-left, so the
       * first child is the one on the right: the icon marks the field where
       * a line of Arabic begins, and the control sits at the far end where
       * every Arabic app puts it. The order used to be the other way round,
       * which put the eye on the right and the lock on the left — the mirror
       * of what the comment beside it promised.
       */}
      <Icon name="lock-outline" size={20} color={color.textMuted} style={styles.lock} />

      <Pressable
        onPress={() => setRevealed((shown) => !shown)}
        accessibilityRole="button"
        accessibilityLabel={revealed ? 'إخفاء كلمة السر' : 'إظهار كلمة السر'}
        accessibilityState={{ selected: revealed }}
        hitSlop={space[2]}
        style={styles.reveal}
      >
        <Icon
          name={revealed ? 'eye-off-outline' : 'eye-outline'}
          size={20}
          color={color.textMuted}
        />
      </Pressable>

      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.ink[400]}
        secureTextEntry={!revealed}
        autoCapitalize="none"
        autoCorrect={false}
        // Off while revealed: iOS strips the dots and, on some versions, the
        // value with them when the entry mode changes under an active
        // spell-checker.
        spellCheck={false}
        autoComplete={autoComplete}
        textContentType={textContentType}
        editable={editable}
        maxLength={256}
        accessibilityLabel={accessibilityLabel}
        {...(onSubmitEditing ? { onSubmitEditing } : {})}
        {...(returnKeyType ? { returnKeyType } : {})}
      />
    </View>
  );
}

const styles = lazySheet(() =>
  StyleSheet.create({
    row: {
      flexDirection: ROW,
      alignItems: 'center',
      minHeight: TAP_TARGET,
      backgroundColor: color.surfaceSunken,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: color.borderSubtle,
      paddingHorizontal: space[3],
    },
    input: {
      flex: 1,
      ...text.body,
      color: color.textPrimary,
      paddingVertical: space[3],
      paddingHorizontal: space[2],
    },
    reveal: {
      minWidth: TAP_TARGET - space[4],
      minHeight: TAP_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
    },
    lock: {
      // Physical: the gap is between the lock and the field, on the lock's left.
      marginLeft: space[1],
    },
  }),
);
