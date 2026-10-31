# OM0RX second receive-only IQ capture receipt

- Radio: FLEX-8400, serial `2525-1213-8402-7415`, `192.168.0.199`
- Source: existing SmartSDR DAX IQ 1 assignment
- Centre frequency: `1,840,000 Hz` (read live from the DAX IQ 1 panel)
- Sample rate: `48,000 complex samples/s`
- Capture UTC: `2026-10-31T03:51:30.4562367Z` to `2026-10-31T03:51:45.5286431Z`
- Usable duration: `14.775000 s`; `709,200` complex frames
- Decoder format: SigMF `cf32_le`, interleaved little-endian float32 I,Q

## Validation

- I: min `-1`, max `0.99999994`, RMS `0.434678477`
- Q: min `-1`, max `0.99999994`, RMS `0.434992527`
- I/Q correlation: `-0.000213007211`
- Non-finite frames: `0`
- WAV SHA-256: `A3F2E4E20D7C09C1EAEEB5519C868D9F82F5B677EAAD0490FCD9A61C66CB02B5`
- SigMF data SHA-256: `F33425B962437DB176C019B2255AF522EB55C8A56F6D2F5ABB7BEF601543B613`

No tuning or transmit action was performed. The existing panadapter/DAX IQ 1 assignment was not changed.

