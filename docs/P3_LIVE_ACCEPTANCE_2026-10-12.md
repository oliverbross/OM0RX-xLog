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

## Subsequent alpha.2 package checkpoint

Source `97f65d7dffdca3524ca2e9bfd836bbf2d8bb4d62` was built, Developer ID signed,
accepted by Apple notarization and stapled. Gatekeeper reported
`source=Notarized Developer ID` for the installed app. Submission ID:
`cfa523c3-b64d-496a-92b4-be5036cc4f6a`. Archive SHA-256:
`fe2576ef91396fb72ebfff0dea0a5cecb2270eea7f95f4d9a20ca8371d30c48f`.

Tests at this source: native Swift 50; shared Swift 138; frontend 110; Rust 49
(the 16 Hamlib cases were also run explicitly against the bundled dummy
helpers); packaged worker process 4. Total unique tests: 351, zero failures in
the final runs. One earlier frontend run timed out under parallel compiler/test
contention; capping Vitest workers at four produced a clean complete rerun.

The outgoing app was retained outside Trash. After installation, SQLite
integrity remained `ok`, count remained 67,843, and the preserved draft loaded.
Only one application process and its one worker were running. Saved-Keychain
agent reconnect succeeded without displaying a token; ARCO polling resumed at
172°. The monitor showed both VFOs, MOX off, KPA STBY/0 W and confirmed route.

The monitor's small map no longer had the oversized toolbar, but a generic map
error banner remained over a rendered basemap. Publication was held pending
diagnosis rather than presenting that display as accepted. The next alpha.3
work adds source-specific safe diagnostics and further map/layout parity.
