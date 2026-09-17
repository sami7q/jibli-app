import { Platform } from 'react-native';

/**
 * The sound an order update makes.
 *
 * Synthesised rather than bundled, and that is a deliberate trade. A packaged
 * `.mp3` needs an audio library — `expo-av` is a native module, so adding it
 * means a rebuild of both binaries for one four-second file — and the browser
 * preview, which is where this app is actually being reviewed, has a synthesiser
 * built into it. Three sine tones through a shared envelope cost nothing to
 * ship, cannot be the wrong sample rate, and sound the same on every machine.
 *
 * Why these notes: C6, E6, G6 — a major triad, played as a quick upward
 * arpeggio. A rising interval reads as "something arrived"; a falling one reads
 * as "something failed", which is the wrong thing to say about an accepted
 * order. Each voice is a plain sine with an instant attack and a long
 * exponential tail, which is what a struck bell does and what keeps it from
 * sounding like a buzzer. Peak gain is deliberately low: this plays while
 * somebody is holding the phone.
 *
 * On a device there is no synthesiser and no need for one — the notification
 * the OS draws carries the system alert sound, which is the sound the customer
 * has already chosen for their phone.
 */

/** C6, E6, G6 in equal temperament. */
const NOTES = [1046.5, 1318.51, 1567.98];

/** Seconds between the start of one note and the next. */
const STAGGER = 0.085;
const DECAY = 0.9;
const PEAK_GAIN = 0.085;

type AudioContextConstructor = new () => AudioContext;

/** Chrome and Safari disagree on the name; both have existed for a decade. */
function audioContextConstructor(): AudioContextConstructor | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const scope = window as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/**
 * One context for the life of the tab.
 *
 * Browsers cap how many can exist, and creating one per chime exhausts that
 * after a few dozen updates — the failure is silence, with nothing in the
 * console to explain it.
 */
let context: AudioContext | null = null;

/**
 * Play it.
 *
 * Resolves either way. A chime that cannot play is not an error worth
 * surfacing: the bar on screen has already said the same thing, and autoplay
 * policy means the first one before any interaction is expected to be refused.
 */
export async function playChime(): Promise<void> {
  const Constructor = audioContextConstructor();
  if (!Constructor) return;

  try {
    context ??= new Constructor();

    /*
     * Autoplay policy suspends a context created before the first gesture.
     * Resuming is a no-op once the page has been interacted with, and the
     * customer has tapped their way to an order by the time this matters.
     */
    if (context.state === 'suspended') await context.resume();

    const start = context.currentTime;

    for (const [index, frequency] of NOTES.entries()) {
      const at = start + index * STAGGER;

      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;

      const gain = context.createGain();
      // Not a hard 0: `exponentialRampToValueAtTime` is undefined at zero, and
      // a ramp that ends there clicks instead of fading.
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + DECAY);

      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + DECAY + 0.05);
    }
  } catch {
    /* No audio output, a blocked context, or a browser that said no. */
  }
}
