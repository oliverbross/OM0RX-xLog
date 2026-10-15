# Direct FLEX exact receive-mode source and package acceptance — 15 October 2026

## Outcome

Source commit `77c15f2` adds a narrowly scoped Direct FLEX VFO-A mode control to
the shared Station Control owner. It closes the prior mutable-selected-slice
dependency without broadening the child window into general radio control.

The source and isolated macOS package are accepted. The Remote Station Agent was
powered off, no FLEX radio was contacted, and no RF, PTT, CW, tuner, amplifier,
antenna or rotor command was issued. Physical control acceptance remains open.

## Exact-target contract

- The native FLEX client now has a separate `setPrimaryMode` operation. It
  resolves the station-owned VFO-A slice at dispatch time and does not read or
  use `selectedSliceID`.
- The existing general `setMode` behavior remains unchanged for the main Direct
  FLEX control surface. The new capability is advertised separately as
  `set_mode_a` so an old backend can never be mistaken for an exact-target one.
- The detached control is visible only for Direct FLEX and only when the retained
  observation is fresh, connected, RX/PTT-off, explicitly identifies VFO A as
  receive, and advertises `set_mode_a`.
- Admission is bound to exact workspace setup revision, provider selection
  generation and UUID, selection-control revision, FLEX connection generation
  and one unconsumed observed sample.
- The durable receipt is persisted before transport. An unknown reply is retained
  and never replayed; a second request requires a new observation.
- Only explicit FLEX modes `USB`, `LSB`, `CW`, `CWR`, `AM`, `FM`, `RTTY`,
  `RTTYR`, `DIGU` and `DIGL` are accepted.
- A command ACK is not success. Completion requires a later authoritative
  observation showing VFO A still owns receive and has the requested mode.
- Agent and Hamlib mode controls remain unavailable in the detached surface
  because they do not yet provide this exact-target contract.

## Verification

- Focused renderer: **27/27**.
- Focused Rust station-session: **21/21**.
- Focused Direct FLEX Swift/XCTest: **25/25**.
- Full frontend: **2,395/2,395 across 160 files**.
- Full Rust/Tauri: **460/460**.
- Full portable Swift manifest: exit 0, including **394 Swift Testing cases**
  plus the XCTest suites.
- TypeScript and the production Vite/detached-window bundle gate pass. The
  existing large-chunk advisory is unchanged.
- `git diff --check` passes.

## Isolated macOS package

- Exact packaged source: `231e54e9fd8130561507e8a593a5aef64837e408`;
  the bundle's embedded distribution metadata records the same commit.
- Isolated native acceptance report:
  `prototype/dist/flexmode-231e54e-native-acceptance.json`.
- Result: **33/33**, `status: passed`, `scope: integrated-local-ui`,
  `station_io: false`.
- Strict deep signature verification passes.
- Host SHA-256:
  `eba020794da15486e62f5fcc824889429d0554cb4bcb11964872211238dd416f`
  (arm64).
- Worker SHA-256:
  `695cf1c6ce64bfaba0c1d3ac18275780418cf84bf9b46013fe78619ff087096e`
  (universal x86_64 + arm64).
- The candidate was not installed. After acceptance exited, only the existing
  installed app host/worker pair remained.

## Remaining acceptance

An installed Mac candidate must prove the control remains correctly
disabled with no radio, becomes available only from a fresh observed Direct FLEX
VFO-A receive sample, sends once, and changes only VFO A after fresh readback.
Physical radio evidence is required before this can be called live accepted.

