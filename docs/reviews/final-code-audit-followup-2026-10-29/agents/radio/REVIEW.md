# Fresh Phase 6 radio and native lifecycle review

Reviewed canonical `0375a8e1a385252519a99127fe9d8f40d639365a` (application `f3f6e3d`), current source first, with `530de4c4` as origin comparison. No application, test, configuration, Git, native UI, provider, credential or hardware mutation. Findings establish software behavior only; none establishes physical RF state. Prior reports were read only after forming the current source mechanisms.

## Confirmed findings, ranked

### R6-RADIO-003 — High: fldigi emergency Stop can fail on configuration storage before attempting RX

**Location:** `Sources/XLogPrototypeSupport/LiveFldigiBridge.swift:207–209`.

Concrete trigger: a valid xLog `fldigi_send` completes; then the configuration directory becomes unwritable/unavailable, or an atomic configuration write otherwise fails. Explicit `fldigi_stop` retires in-memory generation/receive context, then calls throwing `load`/`save` before calling `returnToReceive(emergency:true)`. The `save` implementation (`364–368`) creates the directory, atomically writes JSON and changes file permissions; any failure returns from `handle` before `main.rx` at 316. For a completed send, no pending-send catch exists to issue its own later release. The retained duty is still present, but repeated Stop hits the same storage error. A deterministic isolated test can rename the configuration parent after send and replace the parent path with a regular file; no permissions assumptions are needed. This test was not executed here.

`load` is cached after a successful send (`358–362`), so the claimed trigger is a subsequent save failure, **not** merely corrupting the JSON file externally. Worker production routing reaches the bridge at `LiveWorker.swift:776–792`; a missing destination does not prevent Stop. The visible operator Stop invokes `serviceRequest("fldigi_stop")` directly (`prototype/src/contesting/Not1MMContestWorkspace.tsx:3797`); digital configuration Stop likewise calls it at 2338. Neither caller adds an RX fallback. Existing shutdown/workspace paths call owned cleanup directly and can still issue RX; that does not repair the explicit emergency action. High ranks the loss of the requested emergency release attempt, not an established physical consequence.

**Impact:** a requested emergency Stop makes no RX attempt because an unrelated settings write failed. Physical receive state remains unknown. Payload `^r` may independently return the engine to receive when used; protocol actions permit `rxAfter=false`, and a completed RPC is not RF proof, so that safeguard is not universal.

**Surviving safeguards:** I/O profile denial still blocks output; generation retirement prevents later bundle actions; ownership-aware ordinary lifecycle cleanup and pending-send final releases remain. This is not a return of CR-003's unowned automatic RX defect.

**Test evidence:** the explicit-emergency test (`LiveFldigiBridgeTests.swift:112–119`) uses a writable fresh temporary path. The owned failed-RX/retry test (`60–87`) also keeps configuration storage healthy. No changed test injects a settings write failure before explicit Stop. The fake RPC's `main.rx` response only proves invocation/acknowledgment; it does not model physical receive state.

**Origin:** save-before-RX ordering is present in `530de4c4` (`LiveFldigiBridge.swift:198–205` there); the current remediation preserves it while explicitly describing Stop as unconditional emergency RX.

**Repair direction:** make the explicit in-memory stop/release attempt independent of configuration persistence, then report storage and release results without losing either error or ownership uncertainty. Keep profile denial and no-unowned-control policy for automatic lifecycle actions. Test completed owned send plus deterministic save failure and verify RX is attempted exactly as intended.

### R6-RADIO-001 — Medium: connect can permanently miss startup power registration

**Location:** `Sources/XLogPrototypeSupport/LiveStationSession.swift:232` and `:315`; caller `Sources/XLogPrototypeWorker/main.swift:106`.

The real worker launches `startBackgroundServices()` in an unawaited Task (`main.swift:103–119`) and immediately accepts concurrent requests. Background startup crosses the reference actor at `LiveWorker.swift:338` before calling `startPowerCapture` at 342. Capture registration itself crosses two agent actors sequentially (`LiveStationMethods.swift:53–55`). There is no registration/admission barrier.

Concrete legal schedule: a production Normal Logging direct-agent connection enters `station_connect` before its slot's capture registration. At `LiveStationSession.swift:315`, `let capture = powerCapture` snapshots nil. The newly created client's `onState` and `onObservedSnapshot` closures permanently retain that nil (`318–335`), and the source attach at `343–344` is skipped. Late `installPowerCapture` only assigns a field (`232–235`); it does not attach an existing `powerEvents` source or replace the already-created closures. `recordState` does consult the live field (`954–959`), but `NativeDraftPowerGate.connection:103–104` rejects an unregistered source. `station_reconnect:375–387` reuses the same client and closures, so it does not repair the session. Explicit disconnect and new connect after registration does.

**Impact:** otherwise eligible measured TX power is never delivered for that session. Automatic capture remains unavailable/fallback rather than storing a wrong-radio value. This is a lasting session gap, not only an early sample dropped before arming. It needs automatic measured-power enabled and a usable connected agent; no real provider was operated here.

**Surviving safeguards:** capture remains fail closed; gate source/session/selection/epoch/freshness/contact/transaction fences remain. The corrected registry now targets the actual routed owners and correctly retires both slots. Source ownership repair is present.

**Test evidence:** `StationRadioRegistryTests.swift:14` explicitly awaits `startPowerCapture()` before any operation and only checks assigned identity, so it cannot expose this schedule. `NativeDraftPowerCaptureTests` manually attaches synthetic sources after awaiting startup. No changed test connects before or during registration. `startAutomaticChecks` merely schedules a task (`LiveReferenceMethods.swift:38–45`); the race does not require a slow download, only normal actor scheduling or startup restoration. Native worker restoration starts saved agent connections separately at `worker.rs:927–947`.

**Origin:** the immutable optional capture, assignment-only install, unawaited startup and startup-before-IPC assumption are unchanged since `530de4c4`. CR-002's registry repair makes the correct registration reachable but does not eliminate this adjacent pre-existing ordering defect. Do not call the whole CR-002 capture behavior unconditionally verified.

**Repair direction:** register the capture gate before station connection admission, using a small startup barrier independent of slow background services; or give an existing connection a safe attach/rebind mechanism that does not leave callbacks retaining nil. Test the real lifecycle with connect deliberately held before registration, then fresh eligible observation, reconnect control, and both slots.

### R6-RADIO-002 — Medium: direct-agent failed owned release is still reported as successful station retirement

**Location:** `Sources/XLogPrototypeSupport/LiveStationMethods.swift:59`; unchanged producer `LiveStationSession.swift:988–1008`.

Concrete call chain: ordinary worker EOF calls `shutdownOutcome` (`XLogPrototypeWorker/main.swift:162`), which terminates the actual registry (`LiveWorker.swift:426`). For an agent with owned GUI PTT/CW/Tune duty, `terminate → shutdown → stop` reaches owned release methods. `stop` first resets `guiPTT`, `embeddedCATPTT` and `transmitOwnership` (`991–993`), then uses `try?` for every release (`1001–1003`) and stops the client. `RemoteAgentClient.shutdown*` can throw real errors through the signed command path (`RemoteAgentClient.swift:345–354,533–572`), including disconnected/unsupported command, HTTP failure or timeout. All failures are discarded. Registry aggregation then unconditionally returns `(id, .retired)` for that agent (`LiveStationMethods.swift:59`), so absent another service failure the worker resolves clean and permitsRestart=true (`LiveWorker.swift:429–431`, outcome resolver `38–45`).

**Impact:** the application loses the known cleanup uncertainty and original release duty after an owned agent release fails. A clean retirement receipt cannot distinguish that case from successful release. This is an omitted error/uncertainty propagation claim, not proof the transmitter remains on. Normal passive agent retirement issues no release commands.

**Surviving safeguards and scope:** the correct agent's release is attempted, bounded single-attempt command timeouts remain, and independent agent/watchdog/operator safeguards may apply. Ordinary admitted module switches veto unresolved PTT/Tune/CW/output (`main.rs:2748–2778`), so active output in a normally admitted module switch is not the trigger. Ordinary Quit/EOF is distinct. The new FLEX failure propagation and terminal release-only recovery are real and correct within their provider; they do not cover the agent.

**Test evidence:** registry tests connect only fake FLEX and TCI. The direct-agent test creates passive default owners, then checks terminal rejection (`StationRadioRegistryTests.swift:8–31`). The new withheld-off test (`107–155`) exercises FLEX only. The Rust exit-74 fixture proves native translation of a child which explicitly exits 74; it does not prove an agent release failure produces 74. A scratch extraction of exact `stop` and exact registry aggregate compiled against throwing neighbor fakes, but it was **not executed**. Its initial ownership stub was subsequently corrected in the generator; the earlier `agent-proof` executable is stale and unusable as evidence. The finding is a complete source call-chain result, not a claimed whole-worker runtime reproduction.

**Origin:** the `try?`/reset behavior is unchanged since `530de4c4`; the new registry's unconditional agent-success adapter preserves that existing uncertainty loss. FA-005's specific FLEX root is repaired, while station-wide success semantics remain incomplete for agent failures.

**Repair direction:** return structured agent retirement outcome, retain enough original-client/duty identity to report uncertainty and permit an explicit bounded release-only recovery, and propagate failure through registry/outcome/native exit. Keep passive owners command-free, acquisition sealed and no replay into a replacement provider. Test each release failure separately and pending acquisition overlap using an injected agent client interface.

## Original findings freshly adjudicated

| Finding | Current verdict | Basis and limit |
|---|---|---|
| CR-002 | Original wrong-owner routing/retirement root repaired; capture acceptance incomplete | Shared registry is used by router, startup and EOF for both slots/providers. Correct owners terminate concurrently. R6-RADIO-001 remains; actual agent release failure propagation has R6-RADIO-002. No physical/packaged-EOF acceptance claimed. |
| CR-003 | Original unowned automatic RX root repaired | Automatic cleanup guards on admitted `transmitDuty`; config alone grants none; emergency is explicit. Pending send/release flags and generation checks preserve late final RX. R6-RADIO-003 is adjacent pre-existing Stop ordering. |
| CR-010 | Source attribution repaired | `QSOEditorCore.tsx:113–115` selects radio/KPA500 from retained sample source. Existing validity gates constrain known source vocabulary. Four source/enabled test combinations use valid retained snapshots and preserve numeric values. This review did not rerun rendered tests. |
| FA-004 | Authority root repaired in source and relevant tests | Per-slot selections/sources plus explicit monotonically fenced active authority. Native `set_active_on` publishes nil before persistence, restores old authority on fence/persist rejection, and republishes same-target authority after lost final reply. Worker validates counters and stale authority. Both ordinary and exact-child bootstrap transports stamp native authority. TX reacquisition shares routing lock/fence. No newly confirmed wrong-meter path found. |
| FA-005 | FLEX root repaired; whole-provider generalization unsupported | FLEX `terminate` returns unconfirmed on failed disconnect, registry collects failed IDs, worker returns 74, native maps error and module retirement propagates it. Only exact terminal FLEX disconnect is admitted for recovery, after profile denial. Tests cover missing off telemetry, later off confirmation, sealed acquisition and repeated retirement. The in-process recovery test does not establish post-process-exit recovery. R6-RADIO-002 remains agent-specific. |

## Rejected or unverified hypotheses

**TCI same-target READY:** current `waitForTuneReadback:664–669` can accept a later global evidence timestamp/sequence with cached matching frequency/mode, while `isConfiguredEvidence:829–833` treats READY as evidence and `process:725` refreshes timestamp. An exact unmodified four-file TCI source copy and injected socket probe compiled successfully. Execution was explicitly blocked by lean-ctx's executable allowlist; no retry, wrapper or allowlist change was made. A repeated READY's real protocol reachability after ready, and a concrete wrong-target consequence rather than an already-satisfied same-target intent, were not established. Reconnect clears state and generations and does not supply that trigger. Keep this as a readback-evidence hypothesis, not a confirmed defect or physical claim.

**Concurrent active-radio final publication:** routing `changing` clears before final IPC, permitting later switch overlap, but strictly increasing authority generations reject stale publications. Existing null fence and TX routing lock close the wrong-meter window. A stale final reply can return an error, without proving an unsafe authority restore. No finding.

**FLEX terminal escape/profile bypass:** recovery is narrow to disconnect with exact keys/radio, adapter terminal branch disallows new acquisition, worker profile check precedes terminal exception, and native profile admission remains ahead of action routing. No bypass found. `localAcceptance` intentionally skips process registry retirement; injected full-lifecycle tests use non-localAcceptance workers.

**FLEX failed release followed by process exit:** in-process owner remains attached for retry, but EOF executable exits 74 and closes resources; explicit IPC recovery does not survive that exit. The native diagnostic calls for station inspection/release. Do not claim persistent original-client recovery across process death.

## Changed-test review and proof limits

Every changed radio/lifecycle test and helper is mapped in `coverage.json`. Registry tests reuse fake providers, often call owners/router directly under a test-profile worker, and do not prove profile permission to open live transport. They do prove the injected retirement policy. Synthetic gate tests prove source/slot/transaction behavior, not actual callback registration ordering. Rust routing tests use real isolated files and injected synchronous publication outcomes; they do not run native IPC. Rust exit fixtures prove error mapping/reaping, not Swift's production path. Fldigi tests use fake RPC/receiver, including controlled TX/text suspension; they do not model network delivery, engine identity or RF. CW primitive tests exercise the direct Foundation fallback on platforms where CoreFoundation normally exists, but this review does not establish a no-CoreFoundation deployment run.

No repository tests were run by this agent. Two scratch proofs compiled; zero proof executables ran. TCI compile is current exact source; agent compiled binary is stale after correcting its neighbor fake and must not be used. `build_proofs.py`, generated source and `proof-source-binding.json` are reproducible preparation artifacts, not runtime acceptance. No shared cache builds were performed. No application was launched.
