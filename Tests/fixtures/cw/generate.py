"""Deterministic synthetic corpus. Development only; no radio or live destinations.

Generates PCM audio, complex float32 IQ and sample-aligned symbol annotations.
The generated signals and annotations are original GPL-3.0-only xLog fixtures.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import random
import struct

MORSE = dict(zip("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/?. ,".replace(" ", ""),
                ".- -... -.-. -.. . ..-. --. .... .. .--- -.- .-.. -- -. --- .--. --.- .-. ... - ..- ...- .-- -..- -.-- --.. ----- .---- ..--- ...-- ....- ..... -.... --... ---.. ----. -..-. ..--.. .-.-.- --..--".split()))

def keying(text, rate=3200, wpm=20):
    samples = [0.0] * (rate // 2)
    labels = []
    unit = rate * 1.2 / wpm

    def append(units, value):
        samples.extend([value] * round(unit * units))

    for char in text:
        if char == " ":
            append(4, 0.0)  # previous character already ended with three units
            continue
        first = len(samples)
        code = MORSE[char]
        for index, element in enumerate(code):
            append(3 if element == "-" else 1, 1.0)
            if index + 1 < len(code):
                append(1, 0.0)
        labels.append(dict(symbol=char, first_sample=first, end_sample=len(samples)))
        append(3, 0.0)
    samples.extend([0.0] * rate)
    samples.extend([0.0] * max(0, 6 * rate - len(samples)))
    return samples, labels

def generate(output):
    output.mkdir(parents=True, exist_ok=True)
    records = []
    for speed in (20, 30):
        envelope, labels = keying("CQ OM0RX", wpm=speed)
        audio = [0.6 * key * math.sin(2 * math.pi * 800 * i / 3200) for i, key in enumerate(envelope)]
        path = output / f"cq-{speed}.f32"
        path.write_bytes(struct.pack(f"<{len(audio)}f", *audio))
        records.append(dict(path=path.name, sample_rate=3200, text="CQ OM0RX", replay=True,
                            origin="synthetic", sha256=hashlib.sha256(path.read_bytes()).hexdigest(), labels=labels))
    # One independent carrier above and one below centre, unequal amplitudes,
    # seeded noise. This is acquisition/channelizer evidence, not a quality corpus.
    rate = 96000
    signals = [(keying("CQ DE OM0RX OM0RX K", rate, 30)[0], 6200, 0.4),
               (keying("CQ TEST DL1ABC DL1ABC", rate, 25)[0], -4100, 0.2)]
    rng = random.Random(728396)
    path = output / "two-stations-96k.cf32"
    with path.open("wb") as stream:
        for index in range(max(len(s[0]) for s in signals)):
            real, imag = rng.gauss(0, 0.002), rng.gauss(0, 0.002)
            for envelope, offset, gain in signals:
                key = envelope[index] if index < len(envelope) else 0
                phase = 2 * math.pi * offset * index / rate
                real += key * gain * math.cos(phase)
                imag += key * gain * math.sin(phase)
            stream.write(struct.pack("<ff", real, imag))
    records.append(dict(path=path.name, sample_rate=rate, centre_hz=14025000,
                        offsets_hz=[s[1] for s in signals], replay=True, origin="synthetic",
                        sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    (output / "manifest.json").write_text(json.dumps(dict(schema_version=1, seed=728396, recordings=records), indent=2) + "\n")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    generate(parser.parse_args().output)
