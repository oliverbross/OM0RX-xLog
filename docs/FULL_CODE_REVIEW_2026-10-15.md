# Full code review — 15 October 2026

## Reviewed baseline

- Repository documentation HEAD after closure: `5053788`.
- Product code is unchanged from the packaged `df3b5e7` source baseline; the
  later commit records evidence only.
- Scope: Swift logbook/synchronization and station owners, Tauri native-window
  and notification owners, React task surfaces and workspace modes, packaging
  workflow, and the regression tests that bind those contracts.
- The Windows Remote Station Agent was intentionally off. No radio, amplifier,
  tuner, rotor, PTT, Tune or CW command was sent.

## Review findings and disposition

The independent review found ten concrete correctness/data-safety/UI risks.
Every one is closed in the current source, primarily by `db7ed47` and its
regressions:

1. terminal station shutdown drains direct-transmit acquisitions before the
   provider is stopped;
2. Direct FLEX release attempts both `transmit tune 0` and `xmit 0`, retaining
   the first error only after both safety releases were attempted;
3. an all-space Kenwood `KY` payload remains a clear-CW command rather than
   becoming a query;
4. delayed Agent frequency verification is fenced by task cancellation,
   connection generation and verification identity;
5. a Wavelog destination cannot change while the workspace retains linked
   remote IDs;
6. import identity gives `SUBMODE` precedence, so FT4 and FT8 do not collapse
   while equivalent FT8 encodings still match;
7. every requested reference-data payload is preflighted before a restore can
   replace the live database, including legacy packages;
8. reviewed conflict resolution advances the remote baseline so the same
   remote state does not immediately recreate the conflict;
9. conflicted or held rows are excluded before the 500-contact upload cap, so
   later unrelated contacts cannot be starved; and
10. acknowledged Sync mutation receipts are pruned before the 1,024-entry
    admission limit, while pending/unknown outcomes remain fail-closed.

The packaging workflow names and archives `OM0RX-xLog.app`. Separate Windows
presentation follows the committed workspace mode and does not flash the Canvas
back into view during a background draft save.

No additional product-code patch was necessary during this final pass: each
reported issue was already present in current source with a focused regression.

## Verification

- Portable Swift review set: **66 XCTest + 26 Swift Testing = 92 passed**. This
  includes embedded CAT, Direct FLEX, Remote Agent reconnect, terminal
  shutdown, bounded reconciliation, conflict review, mutation-journal rollover,
  SUBMODE import identity and the complete Wavelog identity-join audit.
- Normal Swift backup-envelope suite: **6 passed**.
- React detached/window set: **60 passed**.
- Complete React suite: **2,394 passed in 160 files**.
- Rust/Tauri suite: **460 passed**.
- TypeScript/Vite production build and detached-window bundle check: passed.
- Responsive browser QA: nine representative task surfaces at **360×640** and
  **1280×800** had document width equal to viewport width and zero controls
  escaping horizontally. The real Desk-component geometry fixture passed all
  **37 widths from 360 to 3,840 pixels**, including fractional breakpoint
  boundaries.
- The exact `df3b5e7` macOS source bundle remains strictly deep signed and passed
  the isolated **33/33** integrated-local-UI acceptance with `station_io: false`.

One deliberately stressed frontend run overlapped the full Rust compilation and
timed out in three long-running tests. The exact two files then passed **57/57**
alone, and the uncontended complete frontend rerun passed **2,394/2,394**. This
was resource contention, not accepted as a hidden product failure.

## Open acceptance boundaries

- Windows Agent source commit `67d2902` now restores verified barefoot drive on
  explicit Standby and the exact pre-Operate drive after failure/cancellation;
  incomplete rollback returns structured `operate-rollback-incomplete` evidence.
  Its 131 focused station/Agent/policy tests pass. Installation and physical
  KPA/KAT/FLEX acceptance remain open because the Agent was intentionally off.
- Installed automatic Wavelog synchronization must still run once against the
  documented-order correction; the completed live probe was GET-only.
- Actual macOS alert popup/sound delivery, native multi-display geometry and
  operator visual acceptance remain open.
- Windows and Linux packages remain deliberately deferred until the operator
  accepts the Mac build.
- Hardware, WAN timing, RF output, notarization of a future release and provider
  account behavior cannot be inferred from these source/package-local tests.

