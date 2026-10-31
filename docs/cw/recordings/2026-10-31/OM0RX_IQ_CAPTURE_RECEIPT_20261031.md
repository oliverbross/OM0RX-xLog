# OM0RX receive-only IQ capture receipt

- Radio: FLEX-8400, serial `2525-1213-8402-7415`, `192.168.0.199`
- Source: existing SmartSDR DAX IQ 1 assignment
- Centre frequency: `7,050,312 Hz` (read live from the DAX IQ 1 panel)
- Sample rate: `48,000 complex samples/s` (DAX setting and endpoint format)
- Capture UTC: `2026-10-31T00:56:35.9653996Z` to `2026-10-31T00:56:56.0913548Z`
- Usable duration: `19.800000 s`; `950,400` complex frames
- Native WAV: stereo IEEE-float32, channel 1 = I, channel 2 = Q
- Decoder raw: SigMF `cf32_le`, interleaved little-endian float32 I,Q

## Validation

- I: min `-1`, max `0.99999994`, RMS `0.0425805826`
- Q: min `-1`, max `0.99999994`, RMS `0.0424799201`
- I/Q correlation: `0.00249589694`
- Non-finite frames: `0`
- WAV SHA-256: `BE49DC06B9B103DDF77C0B5159A0E7C73C2160E47E76B4F7FA65E476F520A8DF`
- SigMF data SHA-256: `3F2B0B66A9D14E486B20CEE9189A64A4177C03E8C9F671B67496A73A6F97DAC4`

No tuning or transmit action was performed. The existing panadapter/DAX IQ 1 assignment was not changed.

