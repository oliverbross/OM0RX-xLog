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

## Corrected Station: OM0RX-WIN10

The human then instructed `use OM0RX-WIN10 IT'S ON`. Rates and the readiness
chat released their live-action leases before a second 12-second run with that
exact name. The transport again closed using `stopTransportOnly()`.

At `2026-10-26T09:52:13Z`, this run recorded:

- Station `OM0RX-WIN10 (SmartSDR-Win)` and VFO A at 7.081800 MHz with the
  `RX+TX` VFO designation. This is not proof of an active transmission.
- Readiness true, connection generation 1, inventory revision `1`, Station
  handle `123016563`.
- Panadapter `40000000`, matching client handle `123016563`, DAX IQ channel 1,
  receive antenna `ANT1`, panadapter centre 7.074000 MHz. The panadapter centre
  is distinct from the observed slice frequency.
- Path properties: `loopa=0`, `loopb=0`, `pre=+16dB`, `wide=0`; transverter
  field empty. These are observations, not accepted RF/front-end limits.
- Requestable rates 48/96/192 kHz; no measured delivery rate. Transmit state
  known off remained false. No physical discovery identity was reported.
- Empty handoff list; `handoffGranted=false` and `iqAcquired=false`.

The instrument code and its built executable were unchanged from the first run.
The working branch was based on `e66b6f65`, with unrelated focused-scheduling
edits being finalized in isolation. No app or radio settings were changed. All
live-action holds were released afterward.

This establishes an observed Station-owned IQ resource, not acquisition
acceptance. The human was asked whether other consumers have released this exact
DAX IQ channel for exclusive receive-only qualification. Fresh receive-state,
physical identity and subsequent IQ/mapping checks remain required; no stream
was created while those facts were missing.

The human subsequently confirmed channel 1 was released and available. The mode
owner then reported a separate live mode-switch recovery and requested a hold on
all further live network/app actions; this CW chat acknowledged that hold. The
channel release does not establish receive state, physical identity or acquisition.
