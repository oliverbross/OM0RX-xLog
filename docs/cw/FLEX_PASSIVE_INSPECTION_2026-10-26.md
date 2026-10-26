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

## Inspector v2: connection not established

After installed 1.3.34 passed its final protected-data/mode-switch audit, the
readiness owner explicitly granted one further 12-second passive metadata
window. This ran the built v2 instrument from source `7cc3a288`, with the working
branch at `31153377`, still requesting `OM0RX-WIN10` at `192.168.0.199`.

The report at `2026-10-26T11:05:47Z` contained only `Connecting to
192.168.0.199:4992` and `Stopped`. No TCP-connected/session/Station announcement
was recorded. Readiness was false, generation -1, inventory revision `0`, and
both panadapter and handoff lists were empty. The optional control transmit
observation was absent. Transmit-known-off, handoff-granted and IQ-acquired were
all false. The inspector closed its own transport and released the live window.

This did not reproduce the earlier reachable Station inventory and provides no
new evidence about transmit state or DAX ownership. A subsequent local routing
table query was blocked by the shell allowlist (`route` is not permitted); it
was not executed or rerouted, and no additional allowlist entry was added.
The human was asked to confirm the VPN and radio availability before another
separately coordinated connection attempt. No cause of the connection failure
is inferred from this run.

## Coordinated v2 retry: control RX, IQ state unknown

The human explicitly confirmed `VPN connected and Flex awake`. After a new
readiness-owner live-window acknowledgement, one further 12-second passive run
connected successfully. At `2026-10-26T11:14:11Z`, it again observed
`OM0RX-WIN10 (SmartSDR-Win)`, Station handle `123016563` and owned panadapter
`40000000` / DAX IQ 1 / ANT1, centred at 7.074000 MHz. Readiness was true,
connection generation 1 and inventory revision `1`. VFO A was separately listed
at 7.081800 MHz. Path metadata remained loopa/loopb/wide `0`, pre `+16dB` and an
empty transverter field.

The optional control-owner transmit observation was present: connected true,
transmitting false, revision `3`, read at the same reported UTC second. The IQ
capability's `transmitStateKnownOff` remained false. These are separate reads;
their timestamps describe inspector reads, not the radio's event time. Neither
the control observation nor the Station inventory overrides the IQ gate.

Handoff and IQ acquisition stayed false. The inspector closed its transport,
released the live window and did not automatically retry. This establishes
restored point-in-time TCP reachability and a control/IQ evidence discrepancy;
it does not identify the parser condition responsible or prove physical
discovery, RF mapping or acquisition readiness. An offline bounded diagnostic
was then prepared to expose the existing IQ interlock parser's refusal without
changing its receive-state rule.
