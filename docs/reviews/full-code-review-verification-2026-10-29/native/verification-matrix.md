# Native finding verification — 29 October 2026

Canonical documentation HEAD: `12824393f2799f21c223fadcb19d03305a5bf2f8`. Application source was unchanged from reviewed `4bd554a25951ddc995b4bef1715d3df12918a07b` (`git diff 4bd554a... HEAD -- Sources prototype/src-tauri/src` empty). Working tree was clean at this pass's start. No application, existing test, dependency, or configuration file was edited. All artifacts are isolated in this directory; first-pass evidence was preserved.

| Finding | Disposition | Severity | Verification improvement | Required qualification |
| --- | --- | --- | --- | --- |
| CR-002 registry lifecycle/capture | **Confirmed; narrow trigger wording** | High retained for omitted owned-output cleanup attempt | Real compiled modules through actual `LiveWorker.shutdownOutcome`; separate shared actors become terminal while routed agent/FLEX actors remain usable. Real routed TCI WebSocket to a disposable loopback server remains open after clean shutdown result, then closes after explicit routed disconnect. | Normal operating-module switch is blocked while GUI PTT/CW/Tune duties remain. Do not imply that active PTT normally passes that guard. Ordinary Quit follows a different editor-flush route. Neither probe establishes physical RF or an external watchdog failure. |
| CR-003 unowned fldigi RX | **Confirmed** | Medium retained | Reproduced using real compiled `XLogPrototypeSupport` without neighboring stubs. Never-configured, disabled, receive-only bridges each emit `main.rx` for shutdown and workspace suspension. External-I/O-disabled controls emit none. | Fake RPC/receiver only; actual external fldigi/radio response untested. |
| CR-007 native recorder consumer | **Confirmed** | Medium retained | Actual unchanged Rust store, synthetic PCM, two audit events. `local:false` ESM with a valid supplied marker creates no link; direct `local:true` creates one. Cursor advances through both; reopen/replay and later same-sequence reclassification do not repair the omitted link. | Host provenance itself is verified by contest reviewer; this pass independently validates native admission/consumption. No audio input/output device or playback exercised. |

## CR-002 false-positive challenge and corrected scope

Re-read the production allocation, all registry command routes and lifecycle hooks. The mismatch is real: `LiveStationMethods.swift:26-33` constructs per-slot agent/FLEX/TCI actors, while `LiveWorker.swift:374,414-416` installs capture/terminates different `Type.shared` allocations. Real-module probing confirms this behavior, not merely separate initializer expressions.

The ordinary Quit path at Rust `main.rs:2710-2715` prepares editor state and checks contest-surface retirement. Application Exit at `:4321-4353` stops existing CW/recorded-voice output and terminates the Swift worker, but provides no generic GUI PTT/Tune disconnect of every routed Swift session. `station_selection.rs:922-933` sets stopped flags only and explicitly relies on worker EOF. Worker EOF `Sources/XLogPrototypeWorker/main.swift:158-162` calls the real `shutdownOutcome`.

**Scope correction:** `require_module_transition_idle`, Rust `main.rs:2734-2769`, vetoes module switch on active/unresolved CW, carrier Tune, GUI PTT, amplifier/Cancel receipts and voice output before retiring services. Therefore the initial report's broad statement about switching modules with an active GUI PTT must be narrowed. The registry cleanup hook remains wrong during module retirement, but the active-output trigger is ordinary Quit/EOF, not a normally admitted active-PTT module switch.

Provider fallback challenge: `RemoteAgentClient` has no destructor sending controls. Its `stop` (`:139-153`) closes observation/reconnect tasks; the separate owned-release functions (`:345-354`) are only invoked by the owning `LiveStationSession.stop` (`:988-1008`). Its 35-second watchdog (`:526-530`) retires stale observation/reconnects, not a local RF release. `FlexRadioClient.stop` (`:147-158`) contains explicit best-effort controls, but no deinit invokes it; routed `LiveFlexSession.retireCurrent` (`:221-259`) is the owner-qualified route and is not reached by terminating its unrelated shared actor. External radio/Remote Agent watchdogs are not implemented in this repository and were not tested.

The connected TCI probe deliberately stops short of protocol readiness: the fake server completes an actual WebSocket handshake and sends no TCI commands. After `shutdownOutcome == 0`, socket remains open and routed snapshot reports `synchronizing`, generation1. Explicit routed disconnect closes it. This proves an omitted connected-resource cleanup; normal OS process exit would eventually close sockets. It is **not** proof of a socket surviving process exit or transmitter behavior. TCI itself is receive-control-only.

Power capture remains statically confirmed from the same ownership root cause: `startPowerCapture` attaches the gate to the unused shared agent, while registry-agent connect reads its own nil capture and installs nil callbacks (`LiveStationSession.swift:314-335`). `NativeDraftPowerGate.swift` requires an attached matching source/session before arming/emitting samples, so native radio-selection metadata does not substitute for the missing callback registration.

## CR-003 false-positive challenge

The global production process owner authorizes cleanup of xLog services, not unowned external fldigi transmission. Both lifecycle methods unconditionally call `returnToReceive` (`LiveFldigiBridge.swift:121-131,289-292`); only external-I/O availability guards `main.rx`. There is no configuration or retained transmit-duty check. The real-module eight-case matrix includes receive-only enabled/start with a fake receiver, eliminating a missing-configuration-only artifact. Existing explicit Stop and failed-TX release tests remain valid controls; an explicit emergency Stop policy is separate from ordinary automatic shutdown.

## CR-007 false-positive challenge

Native `contest_recorder::admission` (`:84-108`) marks only exact `contest_qso_commit`; ESM/F-key requests are neither translated nor aliased before this comparison. `worker::request_using` invokes admission for the actual worker method, and periodic `Recorder.catch_up/reconcile_keys` (`:418-491`) later loads Host audit changes. `Archive::reconcile` (`contest_recorder_store.rs:655-724`) requires `commit && local:true` before checking markers or its recorded-time fallback. The actual-source consumer reproduction supplied a valid marker for the ESM event anyway; it was still skipped and the durable cursor advanced. This excludes a missing-marker-only explanation. Import/replica exclusion remains intentional and must survive a fix.

## Commands and results

All listed successful checks returned exit0. No full suite was repeated.

```sh
# Re-link first-pass production objects into a temporary library; object hashes
# and exact swiftc args are preserved in native-library-command.json.
/opt/homebrew/bin/lean-ctx -c 'python3 /tmp/xlog-review-verification-20261028-12824393/native/build_native_library.py'

/opt/homebrew/bin/lean-ctx -c 'swift -I .build/prototype-tests/debug -I Sources/CSQLitePrototype -I /tmp/xlog-review-verification-20261028-12824393/native -L /tmp/xlog-review-verification-20261028-12824393/native -lReviewNative -Xlinker -rpath -Xlinker /tmp/xlog-review-verification-20261028-12824393/native /tmp/xlog-review-verification-20261028-12824393/native/verify_registry_lifecycle.swift'

/opt/homebrew/bin/lean-ctx -c 'python3 /tmp/xlog-review-verification-20261028-12824393/native/run_tci_shutdown.py'

/opt/homebrew/bin/lean-ctx -c 'swift -I .build/prototype-tests/debug -I Sources/CSQLitePrototype -I /tmp/xlog-review-verification-20261028-12824393/native -L /tmp/xlog-review-verification-20261028-12824393/native -lReviewNative -Xlinker -rpath -Xlinker /tmp/xlog-review-verification-20261028-12824393/native /tmp/xlog-review-verification-20261028-12824393/native/verify_fldigi_module.swift'

/opt/homebrew/bin/lean-ctx -c 'python3 /tmp/xlog-review-verification-20261028-12824393/native/prepare_recorder_package.py'
/opt/homebrew/bin/lean-ctx -c 'cargo run --offline --manifest-path /tmp/xlog-review-verification-20261028-12824393/native/Cargo.toml --target-dir /tmp/xlog-review-verification-20261028-12824393/native/cargo-target'
```

Raw results are `registry-lifecycle.log`, `tci-loopback-result.log`, `tci-loopback-server.json`, `fldigi-module.log`, and `recorder-store.log`. The isolated Rust package pins the exact versions already in application `Cargo.lock`, resolves offline and imports the unchanged application store via `#[path]`. Synthetic PCM is written only to the disposable fixture. The temporary Swift module map names the original C headers, not interface stubs. Production Swift objects were reused from the first pass, with their hashes recorded; this is not a fresh package/release build or installed-app acceptance.

Diagnostic attempts preserved: first Swift interpreter invocation lacked the generated C module maps and failed with `missing required module CCWProcess`; temporary explicit maps fixed import without changing the repo. First isolated-manifest generator used unavailable Python `tomllib` and failed before manifest creation; replaced with deterministic exact-name/version extraction. First Cargo invocation consequently failed for missing manifest; corrected invocation passed. A broad ignored-build-directory glob was denied by lean-ctx policy; no policy or role was changed, and no denied scan was retried. No package/tool installation occurred.

## New coverage and remaining work

`coverage.json` records source ranges and newly traced flows in this pass only. It is supplemental to the complete first-pass inventory and must not upgrade untouched files. Additional source examined: provider observation watchdog/stop semantics; native module-switch output-idle veto; worker shutdown ordering; exact TCI connector/disconnect; native power gate/source emission requirements; recorder audit catch-up and persistence/reopen behavior.

No new independent defect is promoted in this bounded pass. The full review remains incomplete. Remaining material gaps include actual routed direct-agent/FLEX transmit release using a fake transport through an injectable registry, hardware watchdog behavior, Keychain/provider integration, packaged EOF/OS termination, broader per-window command admission, recorder native device/playback acceptance and unreviewed provider parsing. Shutdown currently awaits several background retirements before radio cleanup; cancellation/deadline behavior under stalled real providers remains a targeted verification gap rather than a new unsubstantiated finding.
