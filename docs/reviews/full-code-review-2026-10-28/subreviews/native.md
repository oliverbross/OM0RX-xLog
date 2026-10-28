# Native shell and provider review — 28 October 2026

Reviewed source: `main` at `4bd554a25951ddc995b4bef1715d3df12918a07b`. This is a bounded review, incomplete for the assigned approximately 87,000 source lines. No application, test, dependency, or configuration file was edited. Per-file inventory and exact depth are in `coverage.json`.

## Proposed findings

### NATIVE-01 — Worker shutdown terminates unused singleton radios rather than the routed radio slots

- Severity: **High**, because normal EOF/quit omits the existing owned PTT/CW/Tune release path for the actual connected radio owners. Physical RF behavior depends on the external radio/agent watchdog and was not exercised.
- Confidence: high; **supported by static cross-component analysis**.
- Primary location: `Sources/XLogPrototypeSupport/LiveWorker.swift:414-416` (`shutdownOutcome`), plus `:374` (`startPowerCapture`).
- Root cause: `Sources/XLogPrototypeSupport/LiveStationMethods.swift:26-33` independently constructs `StationRadioRegistry.agents`, `.flex`, and `.tci` for radio1/radio2. Production `handle` selects those objects at `:121-126` and invokes them at `:130-175`. In contrast `LiveStationSession.shared` (`LiveStationSession.swift:199`), `LiveFlexSession.shared` (`LiveFlexSession.swift:54`), and `LiveTCISession.shared` (`LiveTCISession.swift:14`) are different objects allocated by separate `Type()` calls. Worker shutdown calls only those unrelated `.shared` objects.
- Trigger: connect an actual routed direct-agent/FLEX slot, acquire an owned GUI PTT/Tune control, then quit or retire the worker for a module change without explicit disconnect. The worker EOF path invokes `shutdownOutcome` (`Sources/XLogPrototypeWorker/main.swift:158-162`), but the connected slot never receives `terminate()`.
- Safeguards checked: Rust `main.rs:4328-4353` stops CW if a CW owner exists, then sets shutdown flags and closes worker input. `station_selection.rs:922-933` sets stopped flags only and explicitly relies on Swift EOF. There is no registry-wide radio disconnect/terminate API or call in `LiveStationMethods.swift`. `LiveStationSession.shutdown` (`:582-600`) and `stop` (`:988-1008`) implement the intended owned release path but only execute on the actual owner if explicitly reached. `LiveFlexSession.retireCurrent` (`:221-259`) similarly releases owned transmission before stopping transport.
- Additional concrete impact from the same ownership mismatch: `LiveWorker.swift:374` installs `NativeDraftPowerGate` on the unused `.shared` agent. Routed registry agents retain their own `powerCapture == nil` and capture that nil in connect (`LiveStationSession.swift:314-335`), so their measured power callbacks cannot feed the installed gate. Treat as one ownership root cause rather than a separate duplicate defect.
- Recommendation: make `LiveStationMethods` own explicit startup/retirement APIs over the exact radio1/radio2 registry objects; install capture on the routed owner(s), and terminate all actual slot providers with bounded concurrent releases. Preserve inactive-radio routing fences and unresolved release obligations.
- Regression: an injected registry with two fake providers, one GUI PTT owner and one receive-only observer; invoke the worker's real startup/shutdown lifecycle and prove capture registration reaches the routed instance, only owned releases are attempted, both slot owners become terminal, and no replacement starts. Repeat for module retirement and pending acquisition.

### NATIVE-02 — Quitting an xLog worker sends fldigi RX even when xLog never enabled or used fldigi

- Severity: **Medium**, because routine quit or workspace change can interrupt an independently operating external fldigi instance without any xLog transmit ownership.
- Confidence: high; **reproduced with the actual unmodified actor source and fake RPC**, with neighboring interfaces stubbed. No real fldigi, network, radio, or RF was used.
- Location: `Sources/XLogPrototypeSupport/LiveFldigiBridge.swift:121-131` (`stopForShutdown`, `suspendForWorkspaceChange`) and `:289-292` (`returnToReceive`).
- Mechanism: shutdown/workspace retirement always calls `returnToReceive`; its sole guard is production external-I/O availability, and it always invokes `main.rx`. It never checks configuration, a prior xLog `main.tx`, an acquisition token, or a retained release duty. `LiveWorker.shutdownOutcome` (`:393-396`) calls it for every process owner, including ordinary logging. Create/restore reaches `suspendForWorkspaceChange` at `LiveWorker.swift:603-615`, even before the requested workspace mutation succeeds.
- Reproduction: create `LiveFldigiBridge` with a nonexistent configuration path, `externalIOAllowed:{true}`, and a fake RPC recorder. Call shutdown; recorded calls are `["main.rx"]`. A second never-configured actor called through workspace suspension also records `["main.rx"]`. Output is preserved in `fldigi-repro.log`.
- Safeguards/tests checked: production singleton gating only distinguishes which worker may stop process services; it does not establish ownership of external fldigi. Existing `LiveFldigiBridgeTests.swift` covers error rollback, explicit Stop, disabled external I/O, and in-flight context retirement; it lacks never-configured/receive-only shutdown ownership assertions.
- Recommendation: retain an explicit output/release obligation only after xLog admits a transmit attempt, scope it to the engine/session, and send `main.rx` during lifecycle cleanup only for that retained duty. Retain uncertain release state instead of swallowing its failure. Explicit operator Stop may have a separately defined emergency policy.
- Regression: shutdown/workspace change on never-configured, disabled, and receive-only bridges emits zero XML-RPC controls; a pending or completed xLog transmit attempt emits the required owned release; unrelated or replaced engine identity is not released.

## Architecture traced

Bundled React windows call typed Rust Tauri commands. `main.rs` applies window role, operating-module, runtime-isolation and native-owner gates; `worker.rs` shares one NDJSON Swift subprocess with bounded request slots, ID demultiplexing, generation fences, timeouts, passive-read abandonment and kill/reap retirement. Swift `LiveWorker` routes persistence/services and station methods. `LiveStationMethods` selects one of two provider registries; native Rust selections/receipts retain radio/rotor/GUI output authority. CW compute has its own resource-hashed child process, bounded IQ/output queues and teardown; CW local cluster output is loopback-only with per-client limits and self-loop guards. WSJT-X receive uses bounded UDP frames, ingress caps, instance/decode selection and contest lease checks. fldigi bridges loopback UDP completions and explicit XML-RPC output.

## Validation

- `cargo test --locked --manifest-path prototype/src-tauri/Cargo.toml`: **PASS**, exit 0; 913 unit tests plus 26 integration-crate tests. Exact compressed log `cargo-test-cli.log`. The opt-in physical-free Hamlib daemon case returns early unless `XLOG_TEST_RIGCTLD` and `XLOG_TEST_ROTCTLD` are staged; this does not establish daemon/hardware acceptance.
- `cargo audit --version`: **BLOCKED / unavailable**, exit 101, `no such command: audit`; no dependencies or audit tools installed. Current Rust advisory verification remains a gap.
- Fake-RPC reproduction: **PASS** through allowed Swift script interface. Custom executable execution was first rejected by the tool allowlist; no tool configuration was changed. The same actual actor source was then run as an allowed interpreter script, with explicit parent direction, and produced the two unowned `main.rx` calls.
- Commands for reproduction, in order:

```sh
/opt/homebrew/bin/lean-ctx -c 'swiftc -emit-module -emit-library -module-name XLogCore /tmp/xlog-review-20261028-4bd554a/native/fldigi_core_stubs.swift -o /tmp/xlog-review-20261028-4bd554a/native/libXLogCore.dylib -emit-module-path /tmp/xlog-review-20261028-4bd554a/native/XLogCore.swiftmodule'
/opt/homebrew/bin/lean-ctx -c 'python3 /tmp/xlog-review-20261028-4bd554a/native/make_fldigi_script.py'
/opt/homebrew/bin/lean-ctx -c 'swift -I /tmp/xlog-review-20261028-4bd554a/native -L /tmp/xlog-review-20261028-4bd554a/native -lXLogCore -Xlinker -rpath -Xlinker /tmp/xlog-review-20261028-4bd554a/native /tmp/xlog-review-20261028-4bd554a/native/fldigi_interpreter_repro.swift' > /tmp/xlog-review-20261028-4bd554a/native/fldigi-repro.log 2>&1
```

The generator concatenates interface stubs, the complete unmodified application actor, and the fake-RPC harness. Stub ADIF parsing is never exercised by this lifecycle reproduction; no parser behavior is being claimed.

## False-positive challenges and gaps

- Rust request/newline limit mismatch rejected: the Swift line reader counts JSON bytes excluding the trailing newline, consistent with Rust request validation.
- fldigi completion workspace-generation drift on ordinary reopen rejected: Python host `workspace_generation` (`host.py:529-534`) is persisted or a deterministic UUID5, not a per-process identity. No finding promoted.
- fldigi stale-context TX-before-recheck remains a **verification question**, not a finding: outer module admissions and initial destination acquisition may rule out a preexisting stale lease; post-TX checks intentionally reject a later switch. Existing tests explicitly exercise late rejection. Further engine-identity/output-lifetime review is needed.
- Most of the approximately 87,000 assigned source lines remain unreviewed or scanned only. `coverage.json` explicitly lists each file; tests passing do not upgrade manual depth.
- No native GUI, installed bundle, actual provider, physical radio, RF, microphone, serial port, or real external-service acceptance was attempted. External xCat/agent and radio behavior remains outside this repository's tested boundary.
- Priority remaining: full native station/selection lifecycle review, complete TCI/FLEX/Remote Agent transport parsing and cancellation, keychain/vault/C helper audit, recorder and group-network code outside root-reviewed findings, all desktop command admission paths and associated failure tests.
