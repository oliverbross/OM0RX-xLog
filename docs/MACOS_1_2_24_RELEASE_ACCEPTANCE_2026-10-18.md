# OM0RX-xLog macOS 1.2.24 release acceptance — 2026-10-18

## Outcome

Version 1.2.24 is installed in `/Applications/OM0RX-xLog.app` from the canonical checkout at source commit `fd64a5129c9a629490e0f447bf45fa8157d66e63`. The normal app relaunched successfully, retained its saved data and station configuration, connected to the Remote Station Agent and ShackCQ cluster, and loaded 68,207 contacts. The separate Contesting Test app remained running during the replacement.

The installed Radio spots settings show a 15-minute default RBN/Spotted window, independent FLEX/Maestro and SunSDR2/TCI outputs, and FLEX/Maestro forwarding saved on. The live status reported that the Remote Station Agent accepted the FLEX command path; this acceptance does not prove that a marker was visually rendered on the Maestro. No transmit, CW keying, QSO logging, amplifier transition, manual rotor command, or TCI marker was exercised during release acceptance.

## Included changes

- Radio spots settings and 15-minute default own-call pickup history.
- Independent include/exclude filtering for every Special classification, shared by cluster views.
- Chaser & DX confirmed/worked presentation, separate DXCC and operation history, and resizable columns across its tabs.
- Working RBN source filtering and `RBN` Special classification.
- Split-frequency logging with transmit frequency in `FREQ`, receive frequency in `FREQ_RX`/`BAND_RX`, and callsign retention while moving the transmit VFO.
- Amplifier operate recovery without the receipt-review guardrail UI, including the telemetry race repair.
- Authoritative radio reads for QSO band, mode and frequency, including the missing radio-slot identity repair.
- Independent FLEX/Maestro and TCI/SunSDR radio spot delivery; FLEX routing now addresses configured radio slots and TCI emits bounded protocol `SPOT` frames.

## Verification

- Full Rust suite: 639 tests passed.
- TCI protocol tests: 14 passed.
- Radio spot broker tests: 15 passed.
- Portable/native Swift suites: 473 passed.
- Normal Swift suites: 310 passed.
- Radio spots settings UI tests: 37 passed.
- TypeScript compile and production Vite bundle: passed.
- The parallel full-UI run exposed seven pre-existing timing-sensitive failures; the one spot-barrier, two rotor and four live-app cases all passed when rerun in isolation.
- macOS packaging checks: 3 passed.
- Worker self-test: passed with station, network and file I/O disabled.
- Candidate and installed bundles: strict deep Developer ID code-sign verification passed.
- Signing identity: `Developer ID Application: Oliver Bross (4WCMQ4U946)`; Team ID `4WCMQ4U946`.
- Candidate and installed versions: 1.2.24; bundle ID `com.oliverbross.xlog.integration`.
- Candidate and installed main executable hashes matched.
- Visible startup acceptance: 21.015000 MHz CW connected, one cluster and 63 current spots, 68,207 contacts loaded, rotor connected, and the preserved active QSO draft remained populated.
- Visible Radio spots acceptance: 15-minute default displayed; FLEX/Maestro saved on with agent acceptance status; SunSDR2/TCI saved off.

## Installed hashes

- `xlog-prototype`: `c3240bf546e860b83fa34380b452473bfde97e1406f8206439ed23fe8e44f2d9`
- `xlog-prototype-worker`: `441fbe33dda552d7a3cd9b7776cf4c1aae476ae11a14675cd0702d619e76973f`
- `rigctld`: `bdad9f993d89f7622f518cb0620e8194b6f2e3cb89241fe9adf83ee29b75979d`
- `rotctld`: `346898f1365280e0fffee279ebbe427895330f8b1e3c05dfcce15d02d1ecaff3`

## Source and rollback

- Accepted main source: `74add1e`.
- Packaged source and version commit: `fd64a5129c9a629490e0f447bf45fa8157d66e63` on `codex/macos-1.2.24`.
- Candidate bundle: `/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog.app`.
- Verified rollback copies:
  - `/Users/oliver/Documents/Projects/OM0RX-xLog/dist/installation-backups/1.2.23-before-1.2.24-2026-10-18T0815-Australia-Darwin/OM0RX-xLog.app`
  - `/Users/oliver/Documents/Projects/OM0RX-xLog/dist/installation-backups/1.2.23-before-1.2.24-2026-10-18T0815-Australia-Darwin/OM0RX-xLog-original.app`
- Notarization was not performed or claimed.
