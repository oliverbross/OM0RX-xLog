# Remote Agent exact receive-control source and package acceptance — 15 October 2026

## Outcome

Source commit `e90918452c21b8e4ded8956b839d60281ba2b68a` adds exact
receive-frequency and receive-mode controls for Remote Station Agent sessions in
the independent Station Control window. The existing Desk controls are unchanged.

The source and an uninstalled macOS package are accepted at the isolated boundary.
The Remote Station Agent was powered off. No Agent, radio, amplifier, tuner,
antenna, rotor, PTT, CW or RF action was issued. Installed and physical acceptance
remain open.

## Control contract

- The child exposes the controls only for a fresh connected Agent observation
  that is explicitly RX/PTT-off on VFO A and advertises `set_frequency_hz` or
  `set_mode` for the corresponding control.
- Every request carries the exact saved-setup revision, provider-selection
  generation and identity, selection-control revision, Agent connection
  generation and one unconsumed observation.
- Frequency and mode dispatch explicitly target VFO A. The existing general
  mode control still follows the selected receive VFO and was not changed.
- The operation is durably journaled before dispatch. Unknown replies are kept
  for review and never replayed.
- An Agent acknowledgement or optimistic pending overlay is not success.
  Completion waits for a later authoritative transport observation that is
  connected, known, not stale, not transmitting, still marks VFO A as receive,
  and contains the exact requested frequency or mode.
- The authoritative readback wait times out after four seconds and reports an
  unconfirmed outcome rather than claiming the radio changed.
- Hamlib exact-target controls remain unavailable because its current owner does
  not provide this authoritative VFO-A contract.

## Verification

- Focused detached Station Control renderer: **29/29**.
- Focused Rust station-session owner: **21/21**.
- Focused Swift authoritative Agent observation: **7/7**.
- Focused Swift station admission/readback: **11/11**.
- Full frontend: **2,397/2,397 across 160 files**.
- Full Rust/Tauri: **442 unit + 18 integration tests**.
- Full portable Swift: XStation **17**, XLogPrototype XCTest **204** with four
  intentional opt-in benchmark skips, XCluster **56**, and Swift Testing
  **394/394 across 52 suites**.
- TypeScript, production Vite/detached-window bundle checks and
  `git diff --check` pass. The existing Vite large-chunk advisory is unchanged.

## Isolated macOS package

- Embedded distribution source:
  `e90918452c21b8e4ded8956b839d60281ba2b68a`.
- Acceptance report:
  `prototype/dist/agentreceive-e909184-native-acceptance.json`.
- Result: **33/33**, `status: passed`, `scope: integrated-local-ui`,
  `station_io: false`.
- Strict deep signature verification passes.
- Host SHA-256:
  `ee2a2c2bc74a65f5675d2411584c87ae6d1634144bb33deb1a440fe0e5fe4e5a`
  (arm64).
- Worker SHA-256:
  `0b8fee21eb516dea0600ab978da7ca3582aa669ef5dc5d2f0add74a5890ec048`
  (universal x86_64 + arm64).
- The candidate exited after acceptance and was not installed. The already
  installed `/Applications/OM0RX-xLog.app` processes remained the only running
  app host and worker.

## Remaining acceptance

With the Agent available again, an installed Mac candidate must prove both
controls remain disabled until a fresh eligible VFO-A observation, issue one
request, change only receive VFO A, and unlock only after the later exact
authoritative readback. That hardware run is required before live acceptance.

