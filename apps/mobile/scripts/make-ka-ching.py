"""Synthesises the new-order sound: a cash register's «ka-ching».

Written rather than downloaded, so the sound has no licence to track: the
file is ours. A short mechanical «ka» (the drawer's latch: a filtered noise
burst over a low thump) and a bright «ching» (a bell's inharmonic partials,
struck twice a moment apart, with a few coin glints), mono, 16-bit, 22.05 kHz
— the format the old `new_order.wav` used, so every platform that played that
plays this.

    python apps/mobile/scripts/make-ka-ching.py apps/mobile/assets/sounds/new_order.wav
"""

import math
import random
import struct
import sys
import wave

RATE = 22050
DURATION = 1.25
random.seed(7)  # Deterministic: the same file every run.

n = int(RATE * DURATION)
out = [0.0] * n


def add(start_s, samples):
    start = int(start_s * RATE)
    for i, value in enumerate(samples):
        if start + i < n:
            out[start + i] += value


# «ka»: the latch. A 35 ms burst of noise, smoothed into a click, over a
# 140 Hz thump that dies in 60 ms.
latch = []
smooth = 0.0
for i in range(int(0.06 * RATE)):
    t = i / RATE
    smooth = 0.55 * smooth + 0.45 * random.uniform(-1, 1)
    burst = smooth * math.exp(-t / 0.012) * 0.55
    thump = math.sin(2 * math.pi * 140 * t) * math.exp(-t / 0.02) * 0.45
    latch.append(burst + thump)
add(0.0, latch)

# «ching»: a bell. Partials at inharmonic ratios give the metallic colour;
# the higher ones die faster, as a struck bell's do.
BELL = [(1.0, 1.0, 0.55), (2.76, 0.6, 0.35), (5.40, 0.35, 0.22), (8.93, 0.18, 0.12)]


def bell(fundamental, length_s, level):
    samples = []
    for i in range(int(length_s * RATE)):
        t = i / RATE
        attack = min(1.0, t / 0.004)
        value = 0.0
        for ratio, amp, decay in BELL:
            value += amp * math.sin(2 * math.pi * fundamental * ratio * t) * math.exp(-t / decay)
        samples.append(value * attack * level)
    return samples


add(0.07, bell(1318.5, 1.15, 0.42))   # E6, the first strike
add(0.16, bell(1760.0, 1.05, 0.30))   # A6, the second, a moment later

# Coin glints: three tiny high pings scattered through the ring.
for at, freq in [(0.11, 4186.0), (0.22, 3729.3), (0.31, 4698.6)]:
    ping = [
        math.sin(2 * math.pi * freq * (i / RATE)) * math.exp(-(i / RATE) / 0.03) * 0.12
        for i in range(int(0.12 * RATE))
    ]
    add(at, ping)

# Normalise to -1 dBFS and fade the last 80 ms so it never ends in a click.
peak = max(abs(v) for v in out) or 1.0
gain = 0.89 / peak
fade = int(0.08 * RATE)
frames = bytearray()
for i, value in enumerate(out):
    if i > n - fade:
        value *= (n - i) / fade
    frames += struct.pack('<h', int(max(-1.0, min(1.0, value * gain)) * 32767))

with wave.open(sys.argv[1], 'wb') as file:
    file.setnchannels(1)
    file.setsampwidth(2)
    file.setframerate(RATE)
    file.writeframes(bytes(frames))
print('wrote', sys.argv[1], f'{DURATION}s')
