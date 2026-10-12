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

## Alpha.3 diagnostic and layout checkpoint

Developer ID-signed `1f98d372ffc78ef9e9ade64efd09dcaba7b1df2d` was installed
after the operator explicitly approved a restart. The previous bundle was
retained outside Trash at `Documents/OM0RX-App-Backups/xLog-97f65d7-before-1f98d37.app`.
This diagnostic build has not yet been notarized or publicly released.

The operator was actively testing and saved M7KOD themselves before restart;
the private logbook consequently increased to **67,844** contacts. The agent
did not create that QSO. The post-install read-only SQLite check returned `ok`
and 67,844 contacts. The latest draft and subsequently operator-entered
VK8NSB were retained; earlier draft/frequency values were not restored over
the operator's changes.

Tests for this source: native Swift 50 (unchanged core), shared Swift 145,
frontend 131, Rust 50 including 16 real bundled Hamlib dummy cases, packaged
worker process 4: **380 unique tests passed**. Both GitHub workflows completed
successfully at the exact SHA (`38238717951`, `38238717946`).

With explicit operator permission, saved remote-agent/ARCO/OM0RX-13
connections were re-established. At approximately 20:32 Australia/Darwin,
the monitor displayed 18.146000 MHz USB, RX A, MOX off, KPA STBY/0 W/29 °C,
KAT 17 m/ANT1, READY, confirmed route and clear alarms. ARCO readback was
307°, stopped. Frequency and rotor changes since earlier acceptance were
operator activity, not movements made by the update checks.

The new diagnostics exposed the exact map failure: `There is no tile manager
with ID 'land'`. Source review traced it to calling MapLibre `isSourceLoaded`
before asynchronous style registration, not a failed external tile service.
A source fix and delayed-style regression tests are being validated; this
installed artifact still displays the diagnostic banner.

Native View menu presets were exercised at 1000×720 and 1440×940. The desk,
map and band map remained together, without sidebar scrolling. The compact
sidebar's three-column metrics wrapped labels/values awkwardly; a two-column
correction, tighter band-map controls and separated propagation source text
are queued for the next build. The station handover notice also persisted
after reconnect and is being corrected. These observations do not certify
full parity or the subsequent uncommitted changes.

## M7KOD sync diagnosis — installed alpha.3, 12 October 2026

Read-only inspection of the installed integration app found M7KOD preserved in
the local logbook and in Pending outbox: Queued, 0 attempts, sync Not started.
The app remains manual-sync during migration. A credential-metadata presence
query returned item-not-found for its separate Wavelog token entry; no token was
read or printed. The Wavelog URL and station ID were already configured in Settings.

The original native xLog was also running when checked. No sync was started and
neither application was quit. Settings was opened for the operator to save the
token directly into the secure field, and single-writer cutover/manual-sync
permission was requested. Successful server authentication and upload of M7KOD
remain **unverified** until that operator step and explicit sync acceptance.

### Authorized synchronization result

The operator subsequently saved the token directly in the app, closed the native
app and authorized manual synchronization from the integrated workspace. Process
inspection confirmed only Integration and its worker were running. Before sync,
the application created and verified
`OM0RX-xLog-2026-10-12T11-50-45Z.xlogbackup`: 67,844 QSOs, one pending change,
271.4 MB, with settings/reference cache. No credential was read or printed.

After the single-writer confirmation and Synchronize now action, the application
reported **Completed** and **Pending outbox 0**. A read-only SQLite check found
M7KOD (20 m SSB, 14.275 MHz) mapped to server-returned Wavelog ID **178693**, with
`is_dirty=0` and no deletion timestamp. The outbox count was zero and
`PRAGMA quick_check` returned `ok`. This is successful authenticated upload and
local acknowledgement evidence, not a separate browser inspection of Wavelog.

The next alpha groups service configuration and credentials together. The existing
Wavelog URL/station ID and QRZ username were present; Club Log integration remains
a CTY reference downloader rather than a QSO account uploader.

### Alpha.4 source validation checkpoint

After all implementation agents froze their changes: frontend **194/194** passed,
TypeScript passed, Rust **68/68** passed (including bundled Hamlib dummy tests).
The shared Swift suite passed **151/151**, and the native suite passed **50/50**.
These are source/test results; packaged UI, hardware, notarization and release
acceptance are separate gates.
