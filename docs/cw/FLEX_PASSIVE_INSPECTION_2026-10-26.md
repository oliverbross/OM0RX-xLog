# Passive Flex inventory, 26 October 2026

The human enabled the Slovak-house VPN and explicitly confirmed it was ready.
After the GM5E playback check released its live-action hold, the developer-only
`xlog-cw-flex-inspect` ran once for 12 seconds against `192.168.0.199:4992`,
requesting Station `Red-Dingo`. Source was `50f2518b`; the inspected executable
was built from `2d912071` (its code was unchanged). No installed application,
radio configuration, Agent route or audio setting was changed.

At `2026-10-26T09:18:32Z`, the historical report recorded:

- TCP connected and the radio session started.
- Station `Maestro (SmartSDR-Maestro)` was observed.
- VFO A was listed at 14.030370 MHz with the `RX+TX` VFO designation. This
  designation does not establish that the radio was transmitting.
- The client remained waiting for `Red-Dingo` slice A. Readiness was false,
  connection generation was -1, inventory revision was `0`, panadapters and
  handoff panadapters were empty, and transmit-state-known-off was false.
- The requestable-rate list was 48, 96 and 192 kHz; no actual sample rate or
  sample arrival was measured.
- `handoffGranted` and `iqAcquired` were both false. The instrument closed its
  own transport using `stopTransportOnly()`.

This proves bounded TCP reachability through the VPN and the observed Maestro
Station announcement. It does not prove a Red-Dingo binding, physical discovery,
available DAX resource, receive state, IQ transport, RF mapping or decoder
acceptance. No additional network action was started. The human was asked to
confirm whether Maestro is the intended Station before another passive check;
an exact resource handoff remains a separate later step.
