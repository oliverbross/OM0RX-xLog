# Integrated Mac live acceptance — 2026-10-12

Local observation times below are Australia/Darwin. Installed build:
`b9744fd91b8eddcbf8481eb3674423d2a776836c`, version `0.4.0-alpha.1`.
This records real installed-app observations, not simulator results or a claim
of complete native feature parity.

## Authorization and ownership

The operator entered the agent token directly into the application and confirmed
connection. The token was not read, printed, logged, copied into a command or
included in this report. Standalone xCat was stopped with operator approval.
The operator subsequently authorized radio-frequency changes and rotor movement
while personally monitoring the station. No PTT, TUNE-start, CW, OPERATE or
explicit RF-power command was used. Transmit opt-in remained unchecked.

## Direct station connection

At 17:20:45 the shared app reported `direct_agent`, transport `ready`, observed
radio state, and current receive/observation timestamps. Later observations at
17:23:57, 17:25:39, 17:26:50, 17:28:53 and 17:29:46 continued to advance.
These are sampled UI observations, **not** a continuous WebSocket frame capture
or a latency percentile measurement.

- VFO A: 18.160000 MHz USB, RX/TX A, split off.
- VFO B: 18.088030 MHz CW.
- KPA500: STBY, output 0 W, fault 00, temperature 29°C.
- KAT500: AUTO, 17 m, ANT1, READY, fault 0.
- Route: FLEX ANT1 → KPA500 → KAT500 → KAT ANT1, confirmed.
- Interlock READY, PTT Receive, alarms clear at observed checkpoints.
- Commissioning was already Yes and was not changed. No Windows settings or
  policy were edited.
- The separate monitor displayed both VFOs, 0 W output, SWR 1.28 explicitly
  labelled LAST, live accessory details and the direct-agent source.

The earlier Windows 502/hardware-disconnected evidence is historical; this
embedded-client acceptance followed the operator's Windows restart. Standalone
xCat loopback resets were bypassed by explicit embedded ownership, not fixed or
claimed to be fixed.

## Authorized frequency test

Submitted 18.161000 MHz through the station simplex frequency form. The app
reported **Simplex tune confirmed by observed radio state**, and authoritative
receive/transmit A readback showed 18.161000 MHz USB. Submitted the original
18.160000 MHz and received the same observed-state confirmation. The restored
frequency persisted in later station and monitor observations. KPA stayed STBY
at 0 W, PTT showed Receive, route remained confirmed and alarms remained clear
at these checkpoints. No QSO was created or changed for this test.

## Direct DCU-1 rotor test

Connected the existing operator-specified ARCO TCP endpoint directly from the
Mac, without routing through the Windows agent. Initial azimuth readback was
53°. A requested 58° was followed by 59° readback; a requested return to 53° was
followed by 52° readback, which remained visible on the monitor. This proves
bidirectional commanded movement and changing controller feedback, **not** exact
mechanical positioning. The observed result differed by 1° from each requested
heading; no repeated correction movements were attempted.

The monitor showed one observed antenna needle at 052°. Manual target metadata,
movement direction and completion presentation are not yet projected by the
embedded rotor session; “No selected target” remains visible after manual moves.
Rotor tracking/presets and this target-presentation gap remain open parity work.

## Cluster, data and cleanup

The OM0RX-13 session continued receiving real spots (32 initially, 50 shown later),
classified against the isolated 67,843-contact logbook. The standalone OM0RX-12
cluster session was not changed. FLEX spot forwarding was not enabled or tested.

The operator explicitly changed the earlier local app-retention instruction:
close and remove previous xLog versions. The synthetic prototype was quit; the
old native app did not answer two accessibility attempts and was terminated with
SIGTERM (not SIGKILL). Both old processes were verified gone before moving files.

Recoverable Trash folder:
`~/.Trash/OM0RX-xLog-older-apps-20261012-1725/`.
It contains the previous native and prototype Applications bundles, the old
prototype build bundle, native build bundle and earlier integration backup.
Only `/Applications/OM0RX-xLog Integration.app` remains installed as xLog.
Its application process and one bundled worker are the only running xLog
processes; the worker is not a second application. Original logbooks, Application
Support, settings, credentials, source history and published releases were not
deleted. Future updates must close the previous app before replacing it.

Strict signature verification of the retained installed app passed. No executable
source changed during this acceptance turn, so the published alpha archive and
previous 174-test result are unchanged; the full suite was not rerun for this
documentation-only update. Notarization, complete parity, rapid supersession,
cross-band timing and Windows/Linux live integration remain unclosed.
