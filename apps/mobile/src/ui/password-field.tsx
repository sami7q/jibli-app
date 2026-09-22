import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import Icon from '@/ui/icon';
import { ROW, TAP_TARGET, color, palette, radius, space, text } from '@/theme';

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
       * The eye sits on the leading edge and the lock on the trailing one,
       * which under RTL puts the control on the left and the icon on the
       * right — the arrangement the comps draw, and the one every Arabic app
       * uses. `ROW` resolves the direction; hard-coding `row` here would
       * mirror it wrongly in the one mode the app actually ships in.
       */}
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

      <Icon name="lock-outline" size={20} color={color.textMuted} style={styles.lock} />
    </View>
  );
}

const styles = StyleSheet.create({
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
    marginStart: space[1],
  },
});
