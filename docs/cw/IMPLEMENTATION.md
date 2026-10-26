# CW receive implementation

The requested programme is the supplied **OM0RX-xLog CW Skimmer Implementation
Plan v1 (19 October 2026)**. Its historic source/package descriptions are not
current acceptance. Core launch remains two IQ spans and 32 independent tracks,
native offline model execution, local spots/server, both real radios and exact
package/soak acceptance. No reduced launch scope has been agreed.

## Ownership and baseline

Kickoff: canonical `main` at `311478d3`, fetched and pulled fast-forward-only.
Installed 1.3.24 provenance is recorded in
`docs/MACOS_1_3_24_RELEASE_2026-10-26.md`; this task has not operated or replaced
the installed app. Radio-settings thread `01a17558-1219-7b22-915d-be3c2eb9cced`
owns its existing dirty changes, shared radio UI and 1.3.25 packaging. Not1mm
thread `01a152fc-b8d0-7603-9625-31febec3bd92` confirmed no conflicting work.

Existing owners remain authoritative: `FlexRadioClient` / `LiveFlexSession`,
`TCIReadOnlyWebSocketSession` / `LiveTCISession`, `StationRadioSlots` and the
station session, `ClusterSessionService` / `LiveClusterMethods`, `LiveWorker`.
CW receive never acquires transmit authority. The compute child has no radio,
logbook, credential or public-cluster methods. The Swift worker will be its sole
supervisor. Main and detached views will share that owner.

## Evidence ledger

| Work | Evidence | Remaining gate |
| --- | --- | --- |
| CW-001/002 baseline/ownership | Current Git graph, task ownership above | Installed provenance not independently retested by CW work |
| CW-004 model manifest | Exact pinned upstream model, metadata and full AGPL license in `vendor/deepcw-engine` | Runtime/source/notices and exact release package |
| CW-005 fixture generator | Seeded original synthetic mono/IQ generator, annotations and hashes | Consented real IQ, independent whole-call evaluation corpus |
| CW-006 native features | NumPy oracle, silence/random/edge impulse, tolerance 2e-6 | Broader gain/edge/rate corpus |
| CW-007 native inference spike | Native arm64 CPU; silence empty, 20/30 WPM CQ OM0RX | Full logits parity, package and held-out quality |
| CW-008 protocol spike | Finite binary framing, token/epoch/sample identity, fatal malformed input | Parent supervision, bounded nonblocking queue and restart |
| CW-003/026/028/029 contracts/policy | Fixture-tested RF/epoch/sample fences, aligned transcript agreement, distinct self-ID occurrence counting, production quality gate | G4 whole-call calibration; live orchestration and destinations |
| CW-012/017 IQ parsers | Fixture-tested strict VITA and TCI 1.8/2.0/2.1 float32 contracts | Captured production packets and real RF orientation |
| CW-016/018 TCI receive leases | Existing owner, DDS/IF coverage, rig-wide TX, quarantine, startup/stall/overflow bounds, per-receiver stop | Worker-facing orchestration, sleep/wake/reconnect and real Sun acceptance |
| CW-021/022 DSP primitives | Native signed carrier detection; independent Kaiser FIR/mixer and rational 3.2-kHz conversion; 24/48/96/192-kHz gain/delay and 30-dB stronger neighbour at 300 Hz checks | Temporal keyed-carrier/tracking, real corpus, full response/alias tests and measured capacity |

This ledger distinguishes implementation from qualification. Automatic local
spots must remain disabled until G4 quality and RF mapping are qualified. The
native spike is not a finished receiver or a promise of 32-track throughput.

### Current source milestones, 26 October 2026

The earlier table records kickoff evidence. Subsequent pushed source through
`53049081` implements the following milestones; linked records supersede the
earlier remaining-source descriptions where applicable.

| Milestone | Implemented evidence | Remaining acceptance |
| --- | --- | --- |
| Compute supervision | One bounded native child, binary IQ ingress, hash checks, bounded output, failure/restart and Stop cancellation; [supervisor](COMPUTE_SUPERVISOR.md) | Exact-package crash/recovery and long soaks |
| DSP and track orchestration | Independent signed-frequency carriers, FIR channelization/resampling, bounded track history and inference workers; [replay](NATIVE_REPLAY.md), [diagnostics](SIGNAL_DIAGNOSTICS.md) | Standard 32-track timing profile failed; controlled profiling and real corpus required |
| Shared receive lifecycle | Source epochs, provider readback, freshness/TX quarantine, reconnect bounds; [lifecycle](SOURCE_LIFECYCLE.md) | Real sleep/wake, network loss and both-radio qualification |
| Flex acquisition | Existing radio owner, physical discovery binding, Station/pan/channel inventory, explicit expiring resource handoff and owned VITA subscription; [Flex IQ](FLEX_IQ.md) | Live 8400 one/two spans, LAN/VPN discovery and packet continuity, RF orientation and usable bandwidth |
| TCI acquisition | Existing socket/receiver leases, negotiated binary parser and DDS/source-width fences | Real SunSDR2 DX one/two local-radio spans, RF mapping, reconnect/sleep/wake |
| Local spots | Typed local_cw history/classification, bounded single consumer and fresh-source rechecks; [spot output](SPOT_OUTPUT.md) | Production quality remains false; independent corpus calibration and real frequency mapping |
| Loopback cluster | Bounded clients, queue/command/history limits, collision and loop guards; [server](LOCAL_CLUSTER_SERVER.md) | Real external logger and exact-package soak |
| Main/detached view | Shared passive owner, source/server configuration, signal copy/diagnostics and partial/committed distinction; [UI](DECODE_UI.md) | Explicit Tune/Use-callsign routes and final installed functional acceptance |
| Offline packaging | Pinned ORT 1.24.3 arm64, model, source archive/notices, loader relocation, nested signing and offline probe; [packaging](PACKAGING.md) | Public release/notarization, supported-architecture and full CW package qualification |

The human authorized shipping contest updates with CW disabled. The signed
1.3.28 candidate from `cc5d387f70ed0a2f7c9a98ab6b2d2666c062b570` passed
packaging/provenance/signature checks with `experimentalEnabled: false` and
`fixtureOnly: false`; [release record](../MACOS_1_3_28_RELEASE_2026-10-26.md).
Native admission blocks capture, Flex handoff and listener startup, and disabled
snapshots do not probe IQ capabilities. This is an interim contest release,
not completion or reduced acceptance scope for the CW programme.

For later hardware qualification the human identified a Flex 8400 with spare
DAX IQ resources and offered VPN access to 192.168.0.199 in Slovakia. VPN
availability, the SmartSDR Station name, bound discovery and usable IQ remain
unverified. The current installed radio route uses the Remote Station Agent;
it does not establish native IQ readiness. This CW task has not acquired live IQ
or issued radio, RF, PTT, rotor, audio or recording test actions.

## Isolated follow-up source and integration evidence

Follow-up commits on `codex/cw-skimmer` add retained callsign/control references,
Normal Logging and contest callsign-only loading through their existing owners,
committed-text Copy, evidence details, native per-track Mute, expiring signal
estimates, fresh worker-load counts and requested/actual source coverage. The
contest menu opens a context-bound CW Decode window sharing the receive service.
Details and open recovery gates: [track actions](TRACK_SELECTION.md),
[UI](DECODE_UI.md), [signal/load evidence](SIGNAL_DIAGNOSTICS.md).

The developer-only [passive Flex inspector](../../tools/CWFlexInspect/README.md)
was built and passed its no-network parser self-test and real-loopback metadata
command allowlist test. The human expects Station **Red-Dingo** and offered the
optional VPN route to **192.168.0.199**. This is not verified inventory. Both
installed-mode acceptance owners released their live test hold; the human's
VPN-ready indication remains required before the first twelve-second passive
inspection. No live IQ or radio-control action has been taken by this CW chat.

Merge `a462bc84` incorporates accepted canonical `main` through `cbc6a1f9` into
the isolated branch, including the 1.3.32 playback and mode-switch corrections.
Combined validation passed: **899 native tests**, **232 focused frontend tests**,
TypeScript/Vite and all configured window-bundle checks. The CW Decode startup
graph is **298,414 bytes**. The subsequent focused Swift run passed 25 XCTest
cases plus 17 Swift Testing activation/reservation cases (42 total).

This source remains isolated and unpackaged. Installed 1.3.32 remains the other
chats' accepted contest build with CW disabled. Explicit Tune, opportunity
annotations, selected-track scheduling, complete restart recovery, real source
and RF mapping, held-out quality, measured standard capacity, external-client
and 8/24-hour soak gates remain open. No reduced launch scope or completed CW
release is claimed.

## Native compute contract v1

One C++17 host using ONNX Runtime's C API via its RAII headers. One shared
environment/session, one intra/inter-op thread, CPU execution baseline.
The metadata compiler checks original resource hashes and rejects unsupported
feature contracts rather than silently changing preprocessing.

Input prefix: ASCII `XCW1`, little-endian uint32 body size. Body:

| Offset in body | Type | Meaning |
| ---: | --- | --- |
| 0 | uint16 | version 1 |
| 2 | uint16 | type 2 mono inference; type 4 stop |
| 4 | 16 bytes | opaque stream UUID bytes |
| 20 | uint64 | capture epoch |
| 28 | uint64 | job sequence |
| 36 | uint64 | absolute first 3200-Hz channel sample |
| 44 | uint32 | sample rate: 3200 for mono, observed source rate for IQ |
| 48 | uint32 | sample count |
| 52 | typed payload | mono samples or complex IQ, exactly the message-specific size |

Maximum body 131124 bytes; mono inference 5–10 seconds. StreamOpen, IQ, Gap,
EpochEnd, Stop and bounded metrics messages extend the same framing; see
`docs/cw/WORKER_PROTOCOL.md`. EOF closes the child. Invalid
length/version/rate/count/nonfinite samples fail closed. JSON output is bounded
by the 667-frame maximum; counters use decimal strings. Events contain the
unchanged source token/epoch/job and approximate CTC sample alignment. Diagnostics
use stderr only. CTC scores are uncalibrated log scores, never probabilities.
This first ABI carries channel audio; raw IQ stays outside renderer/NDJSON.

## Reproduce the development spike

```sh
python3 prototype/scripts/cw-macos.py prepare --fixture-only
cmake -S native/cw-worker -B .build/cw-native \
  -DONNXRUNTIME_INCLUDE_DIR="$PWD/.build/cw-package/runtime/include" \
  -DONNXRUNTIME_LIBRARY="$PWD/.build/cw-package/runtime/lib/libonnxruntime.1.24.3.dylib" \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_BUILD_WITH_INSTALL_RPATH=FALSE
cmake --build .build/cw-native -j 2
ctest --test-dir .build/cw-native --output-on-failure
python3 Tests/fixtures/cw/generate.py .build/cw-fixtures
python3 -m venv .build/cw-python
.build/cw-python/bin/pip install numpy==2.0.2
.build/cw-python/bin/python native/cw-worker/verify_features.py .build/cw-native/xlog-cw-worker
python3 native/cw-worker/verify_protocol.py .build/cw-native/xlog-cw-worker \
  vendor/deepcw-engine/model.onnx .build/cw-fixtures
```

Development tools are not installed-product dependencies. The earlier spike
used Homebrew ORT 1.30.0; current engineering and Mac packaging use pinned official
ORT 1.24.3 arm64. Fixture-only payloads cannot be staged into a real app and
cannot enable production CW. The packager copies/hashes runtime and notices,
fixes loader paths, signs nested code and verifies offline loading. Every app
candidate advances its version through the coordinated canonical build owner.

## Current TCI ownership and qualification boundary

The same `TCIReadOnlyWebSocketSession` owns CAT and IQ. Explicit `startIQ` requires
READY, an advertised receiver, a known DDS centre, an enabled receiver, accepted
protocol version and a common per-connection rate. It never enables RX2, changes
VFO/DDS, sends TX audio or changes operating-radio selection. Receiving IQ does
not manufacture a CAT readiness or TX permission receipt.

Each capture has a fresh token and epoch on DDS/IF coverage/device/version
changes or return from rig-wide TX/unknown state. VFO-only changes preserve the
span centre. A 500-ms transition quarantine is an **unqualified engineering
default**, not measured sample-boundary proof. Capture RF qualification remains
false. The current IQ path intentionally stays unavailable if either announced
receiver lacks explicit settled RX/tune-off evidence.

At most two queued blocks, each at most 125 ms, bound pending IQ to 250 ms.
Overflow retires that receiver's lease and sends its owned IQ_STOP; another
receiver and CAT remain alive. Unattributable malformed IQ retires all selected
IQ leases. Startup with no IQ fails after five seconds; an established input
stalls after two seconds. Neither failure reconnects the shared socket or
replays radio controls. Stop is idempotent and scoped to the lease UUID.

The historical TCI close failure did not reproduce in the current regression
suite, including dropping the last session reference during receive. No
speculative close rewrite was made. Real Sun server close/sleep/wake evidence
remains part of G2T.

Focused source validation (26 October 2026): 8 parser, 95 TCI protocol, 58
existing TCI session, 5 new IQ lease and 7 CW contract/policy tests passed: **173
executed tests**, zero failures. Tests of other suites filtered to zero are not
counted. Native CTest also passes its synthetic decode, carrier and filter
checks. These counts establish source/fixture evidence only.
