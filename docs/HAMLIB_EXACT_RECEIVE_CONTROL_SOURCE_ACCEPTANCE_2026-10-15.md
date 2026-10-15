# Hamlib exact receive-control source and package acceptance — 15 October 2026

## Outcome

Source commit `5a847a769d85df3339c214c00157802396843da7` adds exact
receive-frequency and receive-mode controls for the selected local Hamlib radio
in Desk and independent Station Control. The source and an uninstalled macOS
package are accepted at the isolated boundary.

The Remote Station Agent was powered off. No Agent, radio, amplifier, tuner,
antenna, rotor, PTT, CW or RF action was issued. Installed and physical Hamlib
acceptance remain open.

## Control contract

- Mounting, provider selection and saved setup remain passive. The controls are
  visible only from the existing selected Hamlib owner and require a fresh
  retained radio observation.
- UI and native admission independently require fresh exact Hamlib VFO and PTT
  field evidence proving receive VFO A and PTT off. Retained stale VFO/PTT
  values, unknown PTT, VFO B, an in-flight control, or a changed setup,
  selection, control or connection generation reject before dispatch.
- The operation is durably journaled before the Hamlib request. Unknown replies
  remain reviewable and never replay; one retained observation cannot issue two
  controls.
- The Hamlib session lock covers the precondition reads, one frequency or mode
  write and the complete readback sequence. The implementation never selects a
  VFO or changes split implicitly.
- Frequency succeeds only after exact frequency, VFO A and PTT-off readback.
  Mode succeeds only after exact native mode, VFO A and PTT-off readback.
  `DIGU` and `DIGL` map explicitly to Hamlib `PKTUSB` and `PKTLSB`.
- A successful command acknowledgement without the exact later readback is an
  error, not a confirmed radio state.

## Verification

- Focused Station Control and Hamlib renderer: **38/38**.
- Focused exact-control Rust tests: **7/7**; focused journal tests: **4/4**.
- Scripted rigctld coverage proves exact frequency and mode commands/readbacks,
  DIGU mapping, no write on VFO-B/PTT-on preconditions, and rejection of a
  mismatched post-write readback.
- Full frontend: **2,399/2,399 across 160 files**.
- Full Rust/Tauri: **445 unit + 21 integration tests**.
- TypeScript, production Vite/detached-window bundle checks and
  `git diff --check` pass. The existing Vite large-chunk advisory is unchanged.

## Isolated macOS package

- Embedded distribution source:
  `5a847a769d85df3339c214c00157802396843da7`.
- Acceptance report:
  `prototype/dist/hamlibreceive-5a847a7-native-acceptance.json`.
- Result: **33/33**, `status: passed`, `scope: integrated-local-ui`,
  `station_io: false`.
- Strict deep signature verification passes.
- Host SHA-256:
  `f38587724afbaa0b923082088a9f5d41c2a617563c749f60f70e3e10d6ff4714`
  (arm64).
- Worker SHA-256:
  `0b8fee21eb516dea0600ab978da7ca3582aa669ef5dc5d2f0add74a5890ec048`
  (universal x86_64 + arm64).
- The candidate exited after acceptance and was not installed. The already
  installed `/Applications/OM0RX-xLog.app` host and worker remained running.

## Remaining acceptance

With a configured Hamlib radio available, an installed Mac candidate must prove
both controls remain disabled until fresh VFO-A/PTT-off evidence, issue one
request, change only receive VFO A, and unlock only after exact readback.
Hardware-profile conditional apply, FLEX discovery and SmartLink remain separate
work; Windows and Linux packaging stays deferred until Mac operator acceptance.

