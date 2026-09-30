import { Platform, Vibration } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { playChime } from './chime';

/**
 * The sound of a new order.
 *
 * For the two people who are waited on: a shop owner with an order on the
 * board, and a courier with a task. The customer's own chime (`chime.ts`) is
 * soft on purpose — it is news. This is a call to act, so it is the bundled
 * `new_order.wav` (three rising bell notes, twice) at full volume, with a
 * vibration a phone face-down on a counter still makes heard.
 *
 * It plays in silent mode on iOS: an owner who silenced the phone for a
 * meeting still expects the shop to ring — that is what the switch in Owner
 * Mode is for, not the hardware one.
 *
 * Never throws. A phone with no audio output still vibrates, and one that
 * refuses both has still drawn the banner.
 */

const PATTERN = [0, 380, 160, 380];

let player: AudioPlayer | null = null;
let modeSet = false;

export async function ringWorkAlert(): Promise<void> {
  try {
    Vibration.vibrate(PATTERN);
  } catch {
    /* No vibrator, or the permission is missing from a custom build. */
  }

  if (Platform.OS === 'web') {
    await playChime();
    return;
  }

  try {
    if (!modeSet) {
      await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers' });
      modeSet = true;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro asset
    player ??= createAudioPlayer(require('../../assets/sounds/new_order.wav') as number);
    player.volume = 1;
    await player.seekTo(0);
    player.play();
  } catch {
    /* Audio unavailable: the vibration and the banner still stand. */
  }
}
