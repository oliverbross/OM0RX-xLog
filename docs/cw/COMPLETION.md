# CW completion checklist — W16 / NL-06–NL-10

This is the single completion checklist for the existing programme, resumed on
30 October 2026. The accepted installed baseline remains **1.3.63 / 19508f4f**.
Integration starts from clean canonical **658efc5e**, fetched/fast-forward current,
and retained **3a28134c** (merge base **38295c6b**). The retained branch, worktree,
dependency link and recovery refs remain intact. One integration owner reconciles
the existing implementation; no second radio, decoder or cluster owner is added.

The three-way reconciliation brings 75 unique changed paths forward and preserves
newer main changes in all 15 paths changed by both lines of development. Its sole
textual conflict combines both contest-test cleanup behaviors. Current station
ownership, power/time capture, worker retirement, exports, restore authority,
installer guards and editor recovery remain in place. Historical branch-only
adapters are not substituted for current owners. The original plan's engineering
targets are frozen in [QUALITY_CONTRACT.json](QUALITY_CONTRACT.json), before any
held-out evaluation. AC30/P8/P9 remain outside this Mac launch.

| Owner | Core acceptance | Current evidence / unclosed gate |
| --- | --- | --- |
| NL-06 | AC01–02 native features/model | Pinned model/runtime retained; native feature, silence, 20/30-WPM and generated unseen-sequence checks pass. Transformed candidates stay separate/unqualified. Real RF and exact-package validation remain. |
| NL-06 | AC06–07 channel response/tracking | Contiguous FIR/profiler, phase-preserving drift and timed carrier observations integrated. Scalar/Accelerate, signed tones, delay, neighbours and convergence/recovery pass. Historical-token chirp errors max 0.672855/0.512208 Hz, with final-character RF retained for every completed test ID. Real drift/crossing/cochannel corpus and RF p95 remain. |
| NL-06 | AC20 standard capacity/resource budgets | Strict failure on M1/8-core/16-GB reference Mac: fresh CPU completes 129/288 jobs (159 coalesced), GPU 84/288 (204 coalesced). All 32 tracks serviced in each; no zero-loss qualification. Ledger/latency/RSS and prior static-CoreML evidence are retained in diagnostics. Production remains four CPU workers. No throughput measurement overlaps builds/tests. |
| NL-07 | AC03/05/11–12 Flex parser/RF/one/two spans | Main e5788759 fixes actual per-band settings/RX handling; 14 subscription tests and fresh hardware RX evidence pass. Operator now selected OM0RX-WIN10, panadapter 40000000 / DAX IQ 1. Manufacturer discovery does not reach validated admission over the current VPN; no stream created. One/two actual spans and RF acceptance remain. |
| NL-08 | AC04/05/13–15 TCI/RF/one/two/mixed | Existing shared TCI socket/receiver leases retained. Current SunSDR2 DX endpoint/version and RX1/RX2 handoff unavailable; no hardware result claimed. |
| NL-07/08 | AC16–19 ownership, changes, TX, failure | Independent span Stop/restart uses the same owner, waits on exact-lease cleanup and preserves the other span/child. Stopped spans stay stopped through child recovery; canceled TCI acquisition cannot issue new IQ commands or suppress cleanup. 79 focused Swift, four native role/timeout/isolation and 32 view/projection cases pass; frontend/window budgets pass. Unchanged real-child/wire evidence is 20/20. Actual ownership, sleep/wake, loss and independently intended TX observations remain. |
| NL-09 | AC08–10 text/identity/quality | Two distinct self-IDs gate loading/spots; DE phrase/repetition and overlap counting repaired. Spots require timed RF evidence at the IDs; missing RF and modified queued payloads are refused. All 37 focused session/policy cases pass. Clean generated mono slice passes 150 sequences / 960 characters with zero errors. Consented real IQ, independent held-out splits, precision/recall, 30 negative band-hours, RF p95 and committed/spot latency remain. |
| NL-09 | AC21/24–25 local ingress/loops/replay | Typed direct local_cw ingress, bounded listener and replay exclusion retained. Five actual socket cases pass, including an unread peer disconnected while the healthy client receives all 11,777 lines. Exact-package and useful live accepted-RF exercise remain. |
| NL-10 | AC22 draft/tune/recovery | Current-owner callsign/Tune integrated; RF targets require timed carrier evidence, expire independently of metadata and pin capture clocks. Displayed Contest draft/lane/binding is retained through original-ID recovery; occupied callsigns cannot be replaced. Native 74-case/affected ten, projection/action 55-case and six sole Entry cases pass, including isolated real Python-host B loading with occupied A preserved. Latest unchanged real-child/wire evidence is 20/20 with the 250-ms guard; earlier 279.6405-ms miss remains. Installed action/recovery acceptance remains. |
| NL-10 | AC23 external client | Real installed GNU Telnet 2.2 passes two isolated sessions, live fractional-kHz/slash output, original UTC history and reconnect; both exit 0, listener off. Plain TCP independently passes. Exact packaged/installed app output acceptance remains. |
| NL-10 | AC26–28 package/UI/regression | Current ownership regressions are being validated. Production capability, RF mapping and spot quality stay independently unqualified. No package/version/install promotion before relevant gates. |
| NL-06–10 | AC29 engineering/pilot | Eight elapsed hours and 24 elapsed hours with qualified streams/replays and operating workload remain; short profiles are not soaks. |

## Qualification records

- Native CTest: 2/2 pass on the merged FIR/tracker implementation.
- Integrated source f2fb7686: full native suite 954/954 and frontend production
  build/all window budgets pass. The payload fixture passes offline relocation,
  provenance/tamper and loader-path checks; it is not an application package.
  The real-child harness passed 14 unchanged cases; its unpaced continuous-copy
  fixture failed continuity, then passes with honest 96-kHz sample deadlines.
- Focused native CW/ownership: 64/64 pass; full native unit suite 949/949 pass;
  real-child/wire harness 15/15 pass; focused frontend and TypeScript pass;
  selected Swift CW/provider/draft/power/cluster/shutdown tests complete exit 0.
  final merged frontend build and all existing window graph budgets pass.
- Reference Mac: MacBookPro17,1, Apple M1 (4 performance + 4 efficiency cores),
  16 GB. `pmset -g therm` reports no recorded thermal/performance warnings;
  this is not a sustained thermal measurement or a full process-tree budget pass.
- Four-worker 15-second replay: delivered 11.0933 s, 32 inferred tracks,
  54 coalesced / 2 dropped events, max input lateness 326.343 ms,
  p95 decode age 4497.15 ms, peak RSS 280.625 MiB: **FAIL**.
- Six-worker same requested workload: delivered 15 s, 32 inferred tracks,
  91 coalesced / 0 dropped events, max lateness 243.332 ms,
  p95 decode age 2347.03 ms, peak RSS 373.641 MiB: **FAIL**.
  Both runs use unchanged audio generation, windows, stride, model and strict
  predicate; host background load is recorded separately, not excluded.
- One 12-second passive attempt at the initially supplied 192.168.4.85:4992
  established no TCP session. No handoff or IQ acquisition occurred. Operator
  corrected the radio endpoint to 192.168.0.199 and confirmed its path ready.
- Fresh corrected-endpoint reads identified and repaired per-band configuration
  erasing preceding READY. Current selected Station OM0RX-WIN10, panadapter
  40000000 / DAX IQ 1, ANT1, 24.915 MHz and RX state verify. The subsequent
  handoff-only receipt fails specifically at physical discovery, before stream
  creation. AetherSDR separately connects over VPN from 10.8.0.6; that connection
  does not establish xLog's discovery admission. No further blind retries occur.
  After AetherSDR started, a separate raw BSD UDP socket successfully bound
  0.0.0.0:4992 for 5.046 seconds and received zero datagrams of any kind; that
  result is independent of VITA parsing. No stream or station command was sent.
- After the operator's discovery-ready handoff, one fresh bounded acquisition
  passes Station/panadapter/DAX IQ 1/RX preflight but again stops at
  `discoveryUnavailable`, before stream creation, with zero IQ bytes. Native
  receipt `c0cab581b48017fb`; independent raw UDP 4992 observation successfully
  binds and receives zero datagrams from any peer over 5.0426 seconds
  (`fd5c8d191722a047`). Forwarder device/rule/destination details are requested;
  no blind radio retries follow. Evidence is retained in
  `flex-discovery-ready-capture-01` and `raw-discovery-after-ready-01`.
- Shared ORT thread tuning and independent-window batching did not pass the same
  strict workload. The unsuccessful batching patch is retained privately with
  SHA-256 dc5c011a4a1b3f7a37ce6e751df07db62374a18cd0e2b4059202a569fae76bd1;
  it was removed from active source. An engineering CoreML MLProgram attempt
  through the bundled runtime fails model-plan construction; CPU remains the
  production default. These experiments do not qualify a new profile or model.
- Retrying bounded CPU-startup batches with the original model and static CoreML
  steady plan passes scalar/token/ownership parity, then fails strict load at
  batches four and two (82/27 coalesced, 3/4 dropped). The one-item control misses
  the input deadline before inference. The experiment is preserved and removed;
  no batching speedup or production promotion is claimed. Exact runs and hashes
  are recorded in `SIGNAL_DIAGNOSTICS.md`; further identical retries are avoided.
- Original-model shared CPU thread comparison also fails: 1 caller × 4 threads
  completes 101/288 with 187 coalesced, p95 age 3698.355 ms; fresh 4 × 1 control
  completes 149/288 with 139 coalesced, p95 age 2761.092 ms. Both deliver all
  input and service all 32 tracks. The integer candidate's four-thread token
  alignment fails parity and is rejected before profiling. NL-06 capacity stays
  open; defaults and thresholds are unchanged. Exact conditions are recorded in
  `SIGNAL_DIAGNOSTICS.md`.
- A bounded same-weight native Accelerate MatMul experiment preserves tensor and
  token/sample parity but also fails the unchanged load: input stops at 7.59467 s
  with 284.695-ms lateness and 2389.168-ms p95 age. Its 64 completed jobs / zero
  coalesced work are an incomplete input population. Failed code is preserved
  privately and removed; production defaults remain unchanged. NL-06 stays open.
- Existing original-model dynamic NeuralNetwork/CPUAndNeuralEngine parity passes,
  then strict load fails at 7.97867 s: 40/64 completed, 24 coalesced, 439.385-ms
  input lateness and 6178.386-ms p95 decode age. This separate provider control
  and its exact conditions are retained in `SIGNAL_DIAGNOSTICS.md`.
- Eight shared CPU callers preserve 40 fixture copies, but their load run misses
  the input deadline before inference. The paired four-worker integer-candidate
  control completes 228/288 jobs with 60 coalesced, despite 1805.828-ms p95 age.
  Neither qualifies capacity. The worker-budget experiment is preserved and
  removed; only its bounded parity selector remains. See `SIGNAL_DIAGNOSTICS.md`.
- Read-only authorized router/client inspection identifies TP-Link EC120-F5 v1
  and the current Mac VPN address **10.8.0.10** (previous .6 is historical).
  Inspected stock OpenVPN controls provide no bridge/discovery relay. Windows
  DAX is stopped with panadapter IQ 1 retained. No router/VPN settings change;
  actual discovery forwarding remains required. See `FLEX_IQ.md`.
- The operator offers Codex on Windows 10 / 192.168.0.117 to prepare the missing
  transport. [The bounded Windows handoff](WINDOWS_DISCOVERY_TRANSPORT_HANDOFF.md)
  owns only genuine discovery forwarding, with original source/payload retained,
  no IQ/radio controls and no persistent networking. New privileged driver use
  needs concrete operator approval. No helper implementation, driver installation
  or verified forwarding is yet claimed; Mac integration ownership remains here.
- Later Windows forwarding uses pre-existing signed Npcap, as reported by the
  Windows owner. Mac independently receives five genuine discovery frames from
  the radio peer. Native admission exposes a real parser defect: two terminal
  alignment NULs were rejected. The private received frame first fails, then
  parses after a bounded 0–3-byte padding fix; all 25 Flex checks pass. The
  inspector also pins the independently supplied serial. Fresh patched native
  admission/IQ/cleanup remain pending; this is discovery evidence, not AC03 IQ,
  RF mapping, source support or two-radio qualification. See `FLEX_IQ.md`.
- NL-09 corpus preparation now has a bounded sealing/reverification tool: actual
  IQ hashes/counts, permission provenance, independent annotation hashes and
  recording-family/session/operator split separation. It has no decode/output or
  qualification authority. Fixture tests do not provide real RF, held-out scores
  or negative band-hours. Fifteen corpus/provenance and existing scoring-fixture
  tests pass; an outer-space operator alias first reproduced split leakage, then
  is rejected. Input format and limits are in `NATIVE_REPLAY.md`.

Private raw tool receipts and reference copies are retained under
`.build/cw-completion-20261030` and lossless lean-ctx archives. No production
settings, drafts, QSOs, recordings or installed bundle are changed by these checks.
