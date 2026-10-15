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

## Post-Hamlib review supplement

After the exact Hamlib receive-control work, three independent review passes
rechecked the complete branch for correctness, data safety, station safety and
native-window/runtime behavior. They confirmed nine concrete defects grouped
into eight remediation areas. Exact source
`c7beb576779351da269812dd65a60963ea7374ed` closes all eight areas and adds
focused regressions:

1. terminal shutdown reserves most of the host grace period for actual CW,
   Tune and PTT release instead of spending it on ordinary command retries;
2. keep-settings restore cannot combine one Wavelog destination's local IDs
   with another destination's settings, and every restore disables prior
   QRZ/Club Log delivery enrollment and queued candidates;
3. keeping local or merged content after a remote deletion detaches the
   vanished Wavelog identity before future synchronization;
4. automatic online-log delivery rechecks enrollment and candidate ownership
   before every cached dispatch, while every QRZ and Club Log credential change
   fences the delivery owner;
5. older Remote Agent revisions cannot overwrite newer authoritative stream
   state;
6. oversized legacy frequency and RF-drive telemetry is rejected rather than
   reaching trapping integer conversions;
7. delayed Direct FLEX send callbacks are fenced by connection generation and
   cannot fail a new connection's reused sequence number; and
8. main and detached Settings have separate recovery journals, while Separate
   Windows mode keeps the main recovery surface visible whenever unresolved
   layout state needs operator action.

The review and all regressions were source/package-local. The Windows Remote
Station Agent remained off and no station or RF action was issued.

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
- Post-Hamlib current-source rerun: **2,399/2,399 React tests in 160 files**,
  **445 Rust unit + 21 Rust integration**, **396 portable Swift tests in 52
  suites**, **195 native Swift tests in 26 suites**, TypeScript and the
  production bundle build all pass.
- The uninstalled macOS candidate built from exact source
  `c7beb576779351da269812dd65a60963ea7374ed` passes strict deep-signature
  verification and isolated **33/33** integrated-local-UI acceptance with
  `station_io: false`. The arm64 host SHA-256 is
  `2528e163727cbec5e4023f77312325838962e8652c95e4125c5364976fcf4a2f`; the
  universal x86_64/arm64 worker SHA-256 is
  `68279e1c7aeaf963d012ef6da66f4ef4d6355d969fc80d9af6e2378748153e4a`.
  The acceptance process exited cleanly and the candidate was not installed.
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

## QLog comment and FTP transport review supplement

A fresh read-only review of the QLog-inspired literal comment condition and FTP
oversize/timeout work found no actionable production defect. It rechecked input
bounds and migration, retained comment rendering, spot identity, libcurl result
classification, byte limits, verification authority, retry behavior and fixture
lifecycle.

The review did find one test-infrastructure defect: on macOS Bash 3.2, expanding
an empty PID array from an EXIT trap under `set -u` could abort cleanup before
servers and temporary files were removed. Source `1080e6e` uses a Bash-3.2-safe
guard for every PID-array cleanup loop. An actual forced pre-server failure
preserved its exit status and removed all task-owned temporary files. Later
source `0dfefc5` completed the remaining stalled/slow upload matrix. The clean
loopback suite now passes **9 tests / 12 executions**, the warning-clean native
suite passes **234 tests across 31 suites**, and no disposable server or
temporary root remains. This supplement used synthetic data only, external
network and station I/O stayed disabled, and no installed app was changed.

