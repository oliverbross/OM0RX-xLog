# P3 integrated Mac acceptance — 12 October 2026

## Artifact and data boundary

These observations apply to the installed Developer ID-signed
`/Applications/OM0RX-xLog Integration.app`, version `0.4.0-alpha.2`, built from
`87f778a586d2435ba648669b908b8bb91b4e1ddf` content. They do not automatically
accept subsequent uncommitted changes or the direct-LAN FLEX provider.

The original native logbook and integrated private workspace were restored as
documented in [the recovery record](P3_WORKSPACE_RECOVERY_2026-10-12.md).
The integrated copy passed SQLite `quick_check` and contains 67,843 contacts.
No QSO was created, edited, deleted or synchronized during this acceptance.
The existing draft callsign was preserved. Standalone xCat remained closed.

## Live connections

After the operator approved the macOS Keychain access prompt directly, the
embedded Remote Station Agent connection authenticated using the saved item.
No token or password was displayed, extracted or included in evidence.

Observed between approximately 19:39 and 19:53 Australia/Darwin:

- FLEX state remained connected and fresh, initially 21.019500 MHz CW,
  VFO A RX/TX, VFO B 18.088030 MHz CW and split off.
- Route confirmed; interlock READY; coordinator safe_rx; alarms clear.
- KPA500 STBY, output 0 W, 29 °C, fault 00.
- KAT500 15 m, ANT1, READY, fault 0; SWR 1.28 last observation.
- Station commissioning remained at its existing true value; no policy or
  Windows settings were changed. Transmit opt-in remained disabled for testing.
- The separate authorized OM0RX-13 cluster session connected and increased
  from 14 to more than 50 real spots. Existing OM0RX-12 was not changed.
- Direct DCU-1 ARCO polling returned an initial azimuth of 173°.

## Authorized no-carrier control checks

The operator had explicitly authorized frequency changes and rotor movement.
No PTT, RF TUNE, CWX, OPERATE or RF transmission was used.

1. Requested ARCO 175° from observed 173°. The UI first showed a pending turn,
   then observed 176° and arrival within the existing ±2° tolerance.
2. Requested return to 173°. Hardware telemetry settled at 172°, within the
   same tolerance. A transient incorrect “Stopped short” message appeared
   before movement; this exposed a reused previous-target timestamp and led
   to a source fix plus a new deterministic regression test. That fix still
   requires acceptance in the next packaged build.
3. Used **Tune simplex** (frequency selection, not the RF **Tune** action) to
   select 21.020500 MHz CW. Authoritative A RX/TX readback reached that value;
   the app reported “Simplex tune confirmed by observed radio state.”
4. Restored 21.019500 MHz CW and observed matching A RX/TX readback, split off
   and PTT Receive. KPA remained STBY at 0 W and the route remained confirmed.

## Limits

This is live evidence for the remote-agent and DCU-1 paths on the named Mac
artifact, not full parity certification. It does not establish numerical
transport/render latency, direct-LAN FLEX or SmartLink acceptance, physical
Hamlib-device acceptance, Maestro colour display, live Wavelog single-writer
sync, or Windows/Linux functionality. Those remain separate acceptance gates.
