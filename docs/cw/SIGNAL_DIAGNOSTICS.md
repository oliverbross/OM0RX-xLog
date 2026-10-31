# CW signal diagnostics and replay load evidence

This development milestone adds estimated speed and signal-to-noise diagnostics;
it does not qualify live reception, callsign quality, track capacity, or soak time.
Production CW acquisition remains disabled by the signed payload manifest.

## Estimates

Speed uses bounded key-down durations at 3,200 samples/s, measured in 40-sample
ticks. At least twelve durations, including three dots and three dashes, must fit
the PARIS one/three-unit model with bounded residual error. The estimate expires
after two seconds without a falling edge. A constant carrier has no speed value.

SNR integrates three Hann peak bins, subtracts their estimated noise, and reports
noise in a 2,500 Hz reference bandwidth. Local spectral median noise is converted
to a mean estimate. A noise estimate determined by the numerical floor produces
no SNR value. These estimates require hardware calibration before acceptance.
Both estimates are copied into each immutable inference job. Missing estimates
remain absent through the strict native wire parser and appear as a dash in UI.
Metadata-only events retain estimates for the same capture and track revision;
they do not renew their two-second lifetime. Ambiguity, changed capture/revision
and a new decode with no measurement clear them. Passive snapshots also expire
old estimates without waiting for another model result. Thirteen focused session
cases pass, including metadata retention, passive expiry and ambiguity clearing.

The channelizer has an Apple Accelerate FIR implementation and a scalar fallback;
tests compare both at 24/48/96/192 ksample/s. Channel creation is limited to one new
channelizer per input block per span. The Mac worker uses four fixed inference
workers. Two spans with sixteen tracks each remain an engineering ceiling.
See Apple's [vDSP_dotpr2 documentation](https://developer.apple.com/documentation/accelerate/vdsp_dotpr2).

## Replay load tool

The shared view now distinguishes requested sample rate from the adapter's
actual rate and reports its usable width. An unqualified RF mapping stays
explicitly unqualified. The native worker's track, pending/in-flight inference,
coalesced-job and dropped-event counts are read at most once per second, with
one outstanding request and a two-second deadline. Missing/old load is unavailable,
never an invented zero. Large counters cross JSON as decimal strings. Every
child has a fresh generation fence, so late events from an earlier child cannot
restore current load or source readiness. Fifteen focused session tests and
sixteen frontend projection/panel cases pass, with TypeScript validation.

The `cw-load-profile` CMake target accepts `model.onnx tracks_per_span seconds
[workers]`. It generates two paced 96 ksample/s spans with synthetic CQ Morse and
5 ms ramps. It neither connects to a radio nor emits spots. The report measures
completed inference tracks, queue pressure, input lateness, decode age, CPU and
resident memory; inferred tracks are not a callsign-accuracy score.

The run stops at more than 250 ms input lateness. A passing result also requires
all requested tracks inferred, no dropped/coalesced work, and P95 decode age at
most two seconds. These limits were not relaxed to obtain a passing result.

On 2026-10-26, development runs shared the Mac with other build/test activity.
Several lean-ctx helper processes were also observed consuming substantial CPU.
These conditions prevent attributing the failures to DSP capacity alone.

| Configuration | Delivered / wall seconds | Inferred tracks | Max input lateness | P95 decode age | Result |
| --- | --- | --- | --- | --- | --- |
| Before FIR/admission changes, 32 tracks, 2 workers | 11.563 / 15.981 | 32 | 260.165 ms | 4,844.4 ms | Failed; 99 coalesced jobs |
| Before changes, 16 tracks, 2 workers | 0.384 / 0.688 | 0 | 261.530 ms | unavailable | Failed |
| Accelerate + bounded admission, 32 tracks, 4 workers | 0.213 / 0.540 | 0 | 283.566 ms | unavailable | Failed |

The final run reached four active tracks before stopping, used 67.188 MiB peak
resident memory and 0.164 CPU seconds, and spent 400.389 ms wall time in DSP.
The wall/CPU difference is an observation, not a diagnosed cause. Cold-start and
scheduling costs need a controlled follow-up before declaring a supported load.

Validation: native CTest 2/2 passed after these changes; Swift process/wire
harness 13/13 passed for the diagnostics wire extension; UI diagnostics and
disabled-build tests 11/11 passed. No live Flex IQ, RF mapping, held-out corpus,
external logger, eight-hour or twenty-four-hour soak acceptance is claimed.

## Prepared DSP attribution instrument

`cw-dsp-profile` is a separate developer-only CMake target. It bounds input to
1–16 tracks per span and 1–128 blocks at 96 ksample/s. It reports construction,
8192-point spectrum analysis and per-channel processing separately, with wall
time, process CPU time, call count and maximum call time. Synthetic generation
is outside those measured regions. It never opens an IQ source, radio, model or
spot output, and always reports `capacity_qualified=false`.

The target compiled successfully on 26 October 2026. Execution was initially
blocked by the local shell allowlist because `cw-dsp-profile` was not allowed.
The policy was not changed, and the command was not rerouted through another
runner. No attribution timings were produced at that stage. Its compilation did
not resolve the failed paced profiles above, and no FIR cache or other speculative
optimization was introduced without a measurement.

## Authorized measurements and contiguous FIR buffers

The human subsequently explicitly authorized adding the single `cw-dsp-profile`
command. `lean-ctx allow cw-dsp-profile` applied it additively to the existing
restricted allowlist; the defaults and other entries were retained. Measurements
then used the Release arm64 build (`-O3 -DNDEBUG`) on the development Mac. Other
release work was active, and the reference hardware/OS and isolated scheduling
conditions are not frozen acceptance evidence.

The fixed 32-channel workload uses two spans, 16 tracks per span, 32 blocks of
4,096 samples at 96 ksample/s: 1.3653 seconds of input per span. Its unchanged
synthetic input produced 1,024 detected-peak observations and 139,840 output
samples before and after the change.

| Buffer layout | Construction CPU | Spectrum CPU | Channel processing CPU | Maximum channel call wall time |
| --- | ---: | ---: | ---: | ---: |
| Interleaved I/Q, stride 2 | 3.486 ms | 88.786 ms | 1,401.350 ms | 12.7414 ms |
| Split I/Q, stride 1 | 3.616 ms | 82.394 ms | 93.912 ms | 0.1208 ms |

A two-channel baseline with the original layout used 88.627 ms of channel CPU
over 64 calls, consistent with the per-channel cost in the 32-channel case.
Construction was small, so no coefficient cache was added. The measured change
stores real/imaginary FIR history in separate contiguous buffers for the existing
Accelerate dot product. Coefficients, tap counts, output count, rational phase,
frequency translation and group delay are unchanged. This reduced channel CPU
about 15-fold in the attribution fixture; it is not a decoder accuracy or full
application capacity result.

The subsequent four-worker paced replay requested and delivered 15 seconds from
both 96-kHz spans, reached and inferred all 32 tracks, and emitted 240 inference
events. It recorded 18.6574 ms maximum input lateness, 1,781.77 ms P95 decode age,
32 maximum pending jobs, **48 coalesced jobs**, zero dropped events, 3,475 ms DSP
ingress wall time, 39.1668 CPU seconds and 299.031 MiB peak RSS over 15.9899 wall
seconds. `stable_under_this_synthetic_load` remained **false**. The original
zero-coalescing criterion was retained. Real RF quality, end-to-end commit/spot
latency, CPU headroom, logging/UI behavior and 8/24-hour soaks remain unqualified.

Native CTest 2/2 passed, including scalar/accelerated output comparison, gain,
group delay and strong-neighbour rejection at 24/48/96/192/384 ksample/s. The
buffer change does not alter the signed build's disabled CW flag or package an
application candidate.
The real-child Swift supervisor/wire harness also passed all 15 cases after the
buffer change, including actual IQ decoding and source-scoped lifecycle checks.

### Coordinated quiet-CPU repeat

After installed 1.3.34 acceptance released the urgent mode-recovery holds, the
readiness owner granted one approximately 20-second offline CPU window. Its
agents and the mode/install owners held tests and compiles during this run.
The installed application and its background services remained in their normal
state; this was a coordinated build/test pause, not measured system-wide idle.

The same command on pushed source `82776235` requested/delivered 15 seconds,
reached and inferred all 32 tracks, and emitted 252 inference events. Results:

| Measurement | Quiet repeat |
| --- | ---: |
| Wall duration | 15.7163 s |
| Maximum input lateness | 21.6444 ms |
| P95 decode age | 1,508.14 ms |
| Maximum pending jobs | 32 |
| Coalesced jobs | **36** |
| Dropped events | 0 |
| DSP ingress wall time | 3,239.48 ms |
| Process CPU time | 37.1054 s |
| Peak RSS | 312.344 MiB |

The strict synthetic stability result remains **false**. The coalescing is not
explained solely by the other chats' compiles; scheduling/inference capacity
still requires investigation. No inference budget, window length, stride,
admission criterion or pass threshold was relaxed. The CPU window was released
immediately after this single run. No IQ/radio/network/UI action occurred.

## Inference attribution preparation

The paced load profiler now also summarizes observed decode jobs' model Run,
feature extraction, CTC projection and queue wait wall times (count, sum, mean,
P95 and maximum). Queue wait starts when the current job is enqueued; replacement
of a coalesced job starts that replacement's own wait. It therefore measures
serviced jobs, not the age or cost of discarded work. Sums overlap across worker
threads and must not be interpreted as process CPU time. Events retired or
discarded before profiler delivery are absent from these distributions.

These internal clocks leave the existing wire output, inference inputs/windows,
thread count, queue bounds and strict stability predicate unchanged. Native
CTest 2/2 and the real-child Swift supervisor/wire harness 15/15 pass. No new
capacity result is implied by building this instrumentation.

### Attributed paced replay

After the readiness and Cluster owners confirmed no current build/test hold,
the readiness owner paused for a single approximately twenty-second window.
Pushed source `b304bb14` ran the same `16 15 4` profile, with the existing pinned
model and Release build. No radio, network, UI, settings or installed application
action occurred; the CPU window was released immediately afterward. Unrelated
host/background activity was not excluded or measured.

It delivered all 15 seconds, inferred all 32 tracks and produced 275 decode
events in 15.5959 wall seconds. Maximum input lateness was 15.1898 ms; P95 decode
age was 1,387.73 ms. Maximum pending jobs remained 32; **13 jobs coalesced**, with
zero dropped events. CPU time was 36.8237 s, DSP ingress wall time 3,272.01 ms,
signal generation 211.095 ms and peak RSS 321.125 MiB. Strict stability remains
**false**. The lower coalescing count than previous runs does not establish a
capacity improvement from instrumentation.

| Serviced-job wall timing (275 jobs) | Sum | Mean | P95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Model Run | 33,695.2 ms | 122.528 ms | 159.645 ms | 208.740 ms |
| Feature extraction | 678.021 ms | 2.466 ms | 3.775 ms | 6.263 ms |
| CTC projection | 7.442 ms | 0.027 ms | 0.053 ms | 0.128 ms |
| Queue wait | 128,479 ms | 467.196 ms | 992.745 ms | 1,245.790 ms |

Model execution dominates measured serviced-job processing time. These overlapping
wall clocks do not measure per-component CPU or prove why a specific job was
coalesced. The data does not justify changing the model, thread budget, windows,
stride or qualification threshold without a separately measured and validated
change. Full application responsiveness, source/RF quality and soaks remain open.

## Completion measurements — 30 October 2026

Reference host is MacBookPro17,1 / Apple M1 (4 performance + 4 efficiency cores),
16 GB. Retained FIR/profile work is integrated by main f99fc51d. Fresh four-,
six- and eight-worker CPU trials, a shared two-thread ORT pool, and independent
two-window batches all fail the unchanged strict standard-load predicate.
The unsuccessful batching patch is retained privately under the completion
evidence root and removed from active source. No windows, stride, admission
count, coalescing meaning or pass threshold was relaxed.

ORT operator attribution of 170 serviced jobs records 14.000 s MatMul and
7.555 s Conv wall time; model execution remains the dominant measured cost.
Overlapping per-job/operator clocks are not process CPU or discarded-work age.
CoreML MLProgram fails execution-plan creation. CoreML NeuralNetwork passes
the silence/20/30-WPM text/alignment comparison, but its same 16/15/4 load fails:
6.064 s engine preparation, 12.928 s delivered input, 32 serviced tracks,
157 coalesced jobs, four dropped events, 257.031 ms maximum input lateness,
7216.11 ms p95 decode age and 1166.53 MiB peak RSS. This is no qualified backend.
The shipped child still selects the existing CPU profile by default.

The profiler accepts explicit, bounded execution-provider, ORT intra-op and
macOS scheduling choices; the production child exposes none of these switches.
On the same `16 15 4` workload, user-initiated QoS (observed class 25) delivered
15 s, serviced 32 tracks/182 jobs, coalesced 106, dropped zero, and measured
76.0454 ms maximum input lateness, 2530.76 ms p95 decode age, 274.266 MiB peak
RSS and 28.9389 CPU seconds/16.7389 wall seconds. Inherited QoS (observed class
33) also failed: 140 serviced jobs, 148 coalesced, zero dropped, 181.933 ms maximum
lateness and 3616.17 ms p95 decode age. The runs were sequential with no task
build/test competing; ordinary applications and background services remained
running. Priority alone is not a capacity correction. These isolated-child
measurements do not establish whole-application headroom or responsiveness.

The allocator experiment keeps one shared session and the same model/workload.
Disabling ORT's CPU arena passes silence/20/30-WPM text, sample-range and score
parity, but its `16 15 4` load fails: 32 tracks, 152 serviced jobs, 136 coalesced,
zero dropped, 178.585 ms maximum lateness, 3062.21 ms p95 age and 433.844 MiB peak
RSS. The sequential same-binary arena control also fails: 176 jobs, 112 coalesced,
zero dropped, 141.118 ms maximum lateness, 2484.01 ms p95 age and 285.172 MiB peak
RSS. No build/test overlapped either run. The arena stays enabled by default;
system allocation did not establish a throughput or memory improvement.

A bounded two-second native stack sample (534 observations per thread) shows
matrix kernels and softmax dominating inference, rather than evidence of a
dominant mutex wait. The sampler's run is explicitly diagnostic, never a capacity
qualification. Carrier search also repeatedly allocated a local-neighbour vector.
It now reuses that bounded scratch vector and skips only peaks which must fail
the unchanged minimum-noise predicate before the median calculation.

On the same `cw-dsp-profile 16 32` inputs, spectrum process CPU falls from 99.567
to 17.881 ms (wall 117.557 to 21.543 ms); both runs detect a peak sum of 1,024
and output 139,840 channel samples. Scalar/Accelerate, signed frequencies, SNR,
weak carriers on both sides of the numerical-floor threshold and native process
checks pass (CTest 2/2). This focused improvement does not fix model throughput:
the subsequent unchanged 32-track run services 125 jobs, coalesces 163, drops
zero, and measures 137.299 ms maximum lateness / 3377.49 ms p95 age. Strict
capacity remains false. No build/test overlapped these measurements.

### Clean mono-copy profile

`native/cw-worker/quality_profile.py` freezes and writes its generated corpus
manifest before invoking the actual native child. It uses the original fixture
keying generator, seed 83100630, 150 unique sequences at 15/20/25/30/35 WPM,
amplitudes 0.03/0.2/0.6, and a 10-second/3200-Hz mono window at 800 Hz. Complete
messages must fit the window including the original lead/tail. Slash calls and
random letter/digit/punctuation sequences are included. Only outer ASCII spaces
are stripped; internal repetition and slash/punctuation errors count.

The pinned original model/runtime produced **0 errors / 960 reference
characters**, all 150 exact sequences, with zero errors in each of the 15
speed/amplitude groups. Original samples/annotations, binary/model/input hashes,
exact Ready contract and outcomes are retained in the private corpus/result
receipt. Two independent edit-distance tests cover deletion, insertion,
substitution, repeated words and slash loss. This establishes the declared clean
mono-copy slice. RF spot precision/recall, negative band-hours and committed-text
latency are explicitly unknown in the receipt; this run cannot close G4 or the
complete AC02/exact-package gate.

### Reproducible int8 engineering candidates

`native/cw-worker/transform_model.py` preserves the original pinned model,
metadata, source manifest and AGPL licence. It records the exact original and
output hashes, transformation/tool source hashes and pinned ORT/ONNX/NumPy tool
versions. Outputs remain outside ordinary Git and outside the payload manifest.
The quality runner requires the corresponding bounded transformation manifest;
it cannot silently evaluate a replacement as the pinned original.

Dynamic per-channel QInt8 constant-weight MatMul conversion produced model SHA-256
`74f9e7f87e51925c21db868c8b7806edca38c32ea83e3a36a27e3ab17be03e3e`.
Seed 83100631, excluding the original corpus texts, passed 150/150 sequences,
0/960 character errors. Its unchanged capacity load failed: 174 serviced jobs,
114 coalesced, zero dropped, 215.26 ms maximum lateness and 1770.75 ms p95 age.
The separately declared all-MatMul variant produced SHA-256
`fd06b9761e73aa2be479005aed77215bda103744841e22121e61b12bae78f1e5`.
Seed 83100632 also passed 150/150 sequences, 0/960 errors, but capacity failed:
191 serviced jobs, 97 coalesced, zero dropped, 248.202 ms maximum lateness and
3237.86 ms p95 age. All 32 tracks were serviced in both runs. No metric or job
cadence changed. Three scoring/provenance tests pass.

These generated mono results are not real-RF held-out evaluation or a deployment
approval. Neither candidate closes capacity, RF quality or release admission;
the original model and production support gates remain unchanged.

### Bounded execution-plan experiment — 31 October 2026

The original tracker first submits roughly six seconds and grows each window
to ten seconds; the inputs are not fixed six-second blocks. A proposed static
six-second plan rejected every job (zero inferred tracks), so that failed patch
is retained privately with SHA-256
`2762aef782658f8cd3fa8a06c5370c2944c1dc97b0a2b996f6b648145a525f96`.
The profiler now counts inference faults and reports missing age/timing statistics
as null. Faults independently fail its existing strict predicate.

The explicit engineering `steady-ten-second` profile uses at most two shared
sessions of the unchanged pinned model: dynamic CPU for the original startup
lengths, and a static batch-one / 667-feature-frame plan for full windows. No
samples are padded/truncated and no job/stride is removed. CPU and static CoreML
silence, 20/30-WPM, full-window text and sample-alignment parity pass. CoreML
assigns 425/444 graph nodes to seven partitions. A separate single-batch,
dynamic-time experiment still fails MLProgram plan construction (error -14);
its patch remains private, SHA-256
`3644fd652e42007b5ed8a77448c24ff39ba2cd7b318809316afe1a5548062468`.
Provider settings follow the [official ORT CoreML contract](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html).

The same `16 15 4` CoreML steady-window run delivered 15 seconds, serviced all
32 tracks / 235 jobs (102 startup, 133 steady), coalesced **53**, dropped zero,
and recorded zero faults, 61.1294 ms maximum input lateness, 1192.10 ms p95 decode
age and 362.844 MiB peak RSS: **FAIL**. The sequential dynamic CPU control also
failed: 13.9947 seconds delivered, 164 jobs, 92 coalesced, zero drops/faults,
407.645 ms maximum lateness and 3542.25 ms p95 age. Host load averages during the
first run were 10.57/10.15/11.14; no thermal/performance warning was recorded.
No task build or test competed with either profile; operator applications and
background services remained running.

After adding per-plan timing, a further identical requested run failed during
startup: 8.576 seconds delivered, 63 jobs, 32 coalesced / one dropped event,
266.410 ms maximum lateness and 3051.13 ms p95 age. Its steady-plan sample count
is zero, so its steady timing percentiles are explicitly null. Startup model
Run p95 is 459.039 ms. Preparation and workload CPU intervals are now separate;
their scope is this profiler process, not CoreML services or the complete app
process tree. No application CPU-headroom or responsiveness pass is inferred.

This profile remains accessible only to native engineering tools. The production
child still uses its original single dynamic CPU session; capacity, model/backend
quality, production admission and installed qualification remain open. Lossless
receipts: `7aea3c8d947ff847` (CoreML parity), `86767527253e1e13` (first load),
`d22094181e5d24e2` (CPU control), `48fcba7fee0240eb` (per-plan load).

### Submitted/model/invalidated work ledger

The native profiler also reports submitted jobs, started/completed model jobs
and invalidated work/results. A model can complete before its result becomes
stale, so completed and invalidated counters are not additive. Coalesced pending
jobs and dropped derived events retain their existing meanings. Standard-load
success now additionally requires every submitted job to start and complete,
with zero invalidated jobs; no original loss/latency limit is relaxed. These
internal counters do not change the bundled v1 status or renderer authority.

Native CTest passes 2/2 (`d483c1b4f9ff66d4`). The isolated drift fixtures complete
every submitted job. Injected unread-output overload records six submitted /
six completed, five dropped events; injected inference overload records 18
submitted / three completed, 15 coalesced and two invalidated results. Timing
distributions describe emitted decode events, not unobserved timing of discarded
work. Process CPU includes actual execution even when a result is invalidated.

The fresh unchanged `16 15 4 cpu 1 - inherited arena dynamic` workload delivers
15 seconds and services all 32 tracks, but completes only **129 of 288** submitted
jobs, with **159 coalesced**, zero dropped/invalidated/fault events. Maximum input
lateness is 122.431 ms, p95 decode age **3102.10 ms**, peak RSS 286.547 MiB and
workload process CPU 22.9126 s / 17.3103 wall seconds: **FAIL**. All 129 model
jobs have timing observations in this run; model Run mean/p95 are
340.965 / 592.737 ms. The same model, generated IQ, input rate, windows and stride
remain in use. No build/test overlapped the profile. Host load averages were
12.20/11.80/12.15, with ordinary applications/background services retained and
no recorded thermal/performance warning. Whole-app budgets remain unmeasured.
Exact receipt: `240c58fc03992059`.

### Bounded GPU-target comparison

The pinned runtime's MLProgram / CPUAndGPU configuration also fails model-plan
construction, error -14, before any inference. Its failed patch is preserved
privately with SHA-256
`240cf4022b4b70c5e686154bbce21885b726316f7e4076567d4f40870c922f77`
and receipt `bf0e7e8d5f1c5262`; that configuration is not retained as an active
profile. The existing NeuralNetwork format with CPUAndGPU passes the same
silence, 20/30-WPM and full-window text/token-alignment parity (`19d8241e31fb581e`).
The engineering flag is `coreml-neural-gpu`; it requests that compute-unit policy,
not a claim that every operator executes on the GPU. CoreML takes 282/503 nodes
in 103 partitions. The production child remains single-session CPU.

Its identical `16 15 4` load completes **84 of 288** submitted jobs, all 32 tracks,
with **204 coalesced**, zero dropped/invalidated/fault events, 30.277 ms maximum
input lateness, **7682.47 ms p95 decode age** and **1284.31 MiB** peak process RSS:
**FAIL**. Workload process CPU is 25.1509 seconds / 21.8906 wall seconds. Model
Run mean/p95 are 747.348 / 1188.00 ms. The host load averages were
7.68/10.59/11.74; no task build/test overlapped and no thermal/performance warning
was recorded. CoreML emitted CoreAnalytics diagnostic messages; these alone do
not establish a measured memory leak. Receipt: `fc4c95f70350a0b7`.

The profiler now checks its own peak RSS after engine construction, each input
block and final drain, and aborts above the original **1536 MiB** protective
ceiling. This is a profiler-process guard, not whole-application memory
qualification. All current process-tree/headroom/responsiveness and exact-package
gates remain open. Neither GPU experiment justifies changing the production
backend, model, workload, windows or qualification limits.

### Pinned attention graph fusion

Inspection of the retained ORT trace attributes 13.9998 s of accumulated kernel
time to MatMul, 7.55467 s to Conv, 2.93283 s to FusedMatMul and 2.40947 s to
Softmax. These concurrent kernel sums are diagnostic costs, not elapsed time.
The model has six self-attention blocks, each with six 32-element heads.

`fuse_attention_model.py` is a developer-only transformation of the exact pinned
model. It replaces each exported QKV/attention subgraph with the pinned runtime's
[Attention operator](https://github.com/microsoft/onnxruntime/blob/v1.24.3/docs/ContribOperators.md#com.microsoft.Attention),
retaining all original tensors byte-for-byte, preprocessing, complete variable
windows, alphabet and metadata. It prunes unreachable nodes, 504 to 315. The
candidate SHA-256 is
`c3dffa9c85dbef501252c7f43fe6a9c132ea23e4996a5ea499b61742dcf22800`;
original licence/source/metadata copies and an exact transformation manifest
accompany it outside ordinary Git. No payload or production backend selects it.

`verify_fused_model.py` freezes its synthetic profile before inference and checks
all original tensors, numerical outputs and per-frame argmax for 24 cases:
334/401/467/534/601/667 frames, batches 1/2, silence/random log features. All pass;
maximum absolute difference is 0.0000133514, maximum per-case mean difference
0.00000179735, with identical argmax. Native text, signed drift, convergence and
overload checks pass. Four quality scorer/provenance cases pass, including refusal
of altered fusion contracts. An independent generated session, seed 83100634,
excludes original-session messages and passes 150 sequences / 960 characters
with zero errors (`7ef0fa0fce4b683f`). This remains clean synthetic mono evidence;
held-out real RF and spot metrics remain unknown.

The unchanged `16 15 4 cpu 1 - inherited arena dynamic` load **fails**
(`6929e8fe89dd9599`). It services all 32 tracks but aborts at 7.76533 of 15 seconds
when input lateness reaches 314.56 ms. Of 64 submitted jobs, 54 complete and ten
coalesce; zero events drop or invalidate. P95 decode age is 2933.25 ms, model Run
mean/p95 280.521/660.524 ms, peak RSS 100.25 MiB and process workload CPU 7.11693 s
over 9.9733 wall seconds. No task build/test overlapped. Host load before the run
was 10.18/13.92/17.04; AetherSDR and background services, including locate indexing,
remained running. No recorded thermal/performance warning is not a sustained
budget pass. The exact ignored `attention-capacity-01` receipt retains source,
binary/model hashes, arguments and before/after host conditions. This failed,
shortened run does not establish a throughput improvement or qualify capacity.

### Attention fusion plus dynamic integer kernels

The same bounded developer tool has a separate `--dynamic-int8` candidate:
per-channel QInt8 MatMul/Attention quantization using the pinned ORT quantizer.
Its manifest explicitly states that the final learned tensors change; only the
preceding fusion preserves them. It records both hashes, pinned tool versions,
original notices/source/metadata and the exact quantizer source hash. The first
generation fails because generic ONNX inference cannot propagate the contrib
output type. The declared `DefaultTensorType=FLOAT` fallback resolves that known
FLOAT-output contract; no input, window, stride or quality limit changes.
Candidate SHA-256:
`8fb1263d5ec17f7262da33d11f63faebb207af5eb3747a4781c8c5f1b25195cf`.
It contains six QAttention and 32 MatMulInteger nodes, 6,400,279 bytes. Five
scoring/provenance tests pass, including rejection of a false unchanged-tensors
claim or additional undeclared quantized operators.

Native CPU text/tracking/loss regressions pass. A new generated session, seed
83100635, excludes the original session and passes all 150 sequences / 960
characters with zero errors in 19.1266 seconds (`d8001800bed7819e`). RF metrics
remain unknown. The unchanged standard CPU load delivers all 15 seconds and
services 32 tracks, but completes **227/288** jobs with **61 coalesced**: **FAIL**
(`7a9cfef2b61f70eb`). No dropped, invalidated or fault events; maximum input
lateness 147.55 ms, p95 decode age **3637.54 ms**, RSS 167.859 MiB. Model Run
mean/p95 are 200.261/383.240 ms; process workload CPU is 28.6992 s / 17.8458 wall
seconds. Host load before/after is 18.09/20.97/29.24 and 19.71/21.07/29.08.

The existing two-plan CPU-startup / static NeuralNetwork-CoreML configuration
passes native parity (`bb6afbdb48283947`), with 264/408 nodes in 49 CoreML
partitions. Its unchanged standard load **fails** (`7c2e579f7bad57e9`): 288
submitted / 198 completed, 195 emitted events, **90 coalesced / three dropped**,
zero invalidated/fault events. It aborts at 14.5067 seconds for 304.353 ms input
lateness; p95 decode age is 3800.25 ms, RSS 370.891 MiB. Emitted-event model Run
mean/p95 are 218.757/554.297 ms; startup mean is 132.959 ms and steady mean
353.098 ms. Process workload CPU is 24.1236 s / 18.0085 wall seconds, preparation
5535.15 ms. That preparation also exceeds the production child's five-second
Ready deadline; this profile is engineering-only. Host load before/after is
14.39/18.06/25.92 and 17.71/18.50/25.88. Neither profile overlaps a task build/test;
ordinary applications remain running, with no recorded thermal warning.

These results do not select a transformed production model or establish RF
quality, full-app budgets, cold offline startup, strict capacity or stability.
The original bundled model, CPU backend and independent production gates remain.

An explicit two-model startup/steady experiment is rejected **before** capacity
profiling. Integer startup with the original floating CoreML steady model fails
the existing token-alignment check in both NeuralNetwork and MLProgram profiles
(`c64f27556861bbcf`, `86f6aaceb27d9676`). The diagnostic identifies a 23,168-sample
startup window: X starts at 23,792 in both outputs but ends at 23,840 versus
23,888, a 48-channel-sample / 15-ms difference. MLProgram still assigns 425/444
nodes to seven partitions; the mismatch occurs in startup, not that steady plan.
No timing tolerance or qualification target is relaxed. The failed code is
removed from active source, retained privately as a patch with SHA-256
`7cefae6caac4daa6bac4c755ab1985a9acdbfac8f269df613009160cd6ad7acd`.
The useful window/plan/token mismatch diagnostic remains in the native harness.

## Bounded CPU startup batching with the original model

After the two-plan work, a separate bounded experiment retries batches of up to
four already-ready, equal-feature-count CPU windows. It retains the original
model, windows, stride, fair scheduling, RF observations and per-job loss ledger;
the full-window CoreML MLProgram plan stays batch one. It never waits to fill a
batch or pads input. Scalar/batch 2/3/4 text, exact token boundaries, independent
sample origins and scores pass, including silence/noise. Two-span mute/focus/
retirement tests and CPU-startup/CoreML-steady parity also pass. CTest is 2/2.

All three unchanged 16-track/span, 15-second, four-worker profiles **fail**:

| Maximum CPU batch | Delivered seconds | Completed/submitted | Coalesced / dropped | Input lateness ms | P95 decode age ms | RSS MiB |
| --- | --- | --- | --- | --- | --- | --- |
| 4 | 11.2213 | 110/192 | 82 / 3 | 253.403 | 2447.785 | 578.547 |
| 1 control | 5.54667 | 0/0 | 0 / 0 | 347.148 | Unknown | 113.328 |
| 2 | 9.984 | 101/128 | 27 / 4 | 665.791 | 6322.903 | 449.000 |

The batch-four run emits 107 jobs (44/0/3/60 at actual batch sizes 1/2/3/4),
services all 32 tracks and reaches 16 in-flight jobs. Inclusive model Run
mean/p95 are 707.546/1199.884 ms per emitted job; startup mean is 1012.975 ms,
steady mean 215.881 ms. Batch two emits 97 jobs, 92 in pairs, services all 32
tracks and reaches eight in-flight jobs. No profile has inference faults or
invalidated jobs. Run time is not divided by batch size to report latency.
Process workload CPU/wall seconds are 15.3283/13.5841 and 14.9403/15.4111 for
batches four/two. Cold preparation takes 8325.38/6232.14/6479.25 ms respectively,
also exceeding the unchanged five-second child Ready deadline.

No compiler/test overlaps these runs. One-minute host load ranges from 12.45 to
19.28; ordinary applications remain running and no thermal warning is recorded.
The control misses the input deadline **before inference**, so it cannot support
a batching speedup or attribution of all lateness to the decoder. Loss/deadline
and age limits are unchanged. No further identical retries are used as a pass.
Private per-run source patches, hashes, process/thermal records and results are
in `bounded-batch-coreml-{4,1,2}-01` under the completion evidence directory.
The failed implementation is removed from active source and retained as patch
SHA-256 `d77636a3891355882634c8f6f7b9959e75b8ee11ff55daf2ed9fc4d7e89c375b`.
Only the useful observed-in-flight count and explicit emitted-job timing
population remain in the profiler. Production retains its original CPU path.

## Receive-relative age definition

Before further qualification, the profiler and session now both include FIR
group delay when mapping a decoded window end into capture sample time. The
profiler's real-rate generation clock supplies its reference; the session uses
the newest admitted IQ's sample end and local monotonic receipt. It subtracts
integer capture origins before conversion, then adds elapsed local time. The
session also expires measured current RF independently of metadata receipt.
Radio/transport latency, committed-character delay and spot delay still need
their own evidence. Unknown age stays absent, not zero.

Earlier profiler receipts in this document are unchanged historical results;
they excluded the 20-ms filter delay. This correction increases measured age,
preserves the two-second limit and cannot turn any earlier strict failure into
a pass. New receipts identify `decode_age_reference` explicitly. The session
fixture independently expects 188-ms decode age / 198-ms carrier age, then
2088/2098 ms after elapsed time; fresh IQ and track metadata do not renew RF.

## Binary IQ encoding

The timed-RF 19-case wire suite has 18 passes and one real-rate input failure at
sample 1048576 / sequence 128, 279.6405-ms lateness, child failure nil. A separate
64-iteration alternating-order payload benchmark uses the exact original loop
and native-LE copy on the same 16,384 finite Float32 values / 65,536 bytes. All
bits match, SHA-256 `e689238e162613611914ffcfd6c8098065aaaa832acc1a2c962e88fdd45d62a4`.
Original median/p95/max are 1.824916/2.456583/3.179708 ms; native copy is
0.002292/0.007250/0.013625 ms. This is an unoptimized Swift-interpreter **payload
microbenchmark**, not a complete-path or release-throughput measurement, and
does not attribute the entire deadline failure to encoding.

The production binary encoder now builds the final bounded frame directly,
copies native-LE sample bytes once and retains an explicit opposite-endian path.
It removes per-value Data appends and the second whole-payload frame copy. The
following complete real-child/wire run passes **20/20**, including the enhanced
two-call replay in 12.133 seconds with current and self-ID RF observations. No
other task build/test runs during replay. The same 96-kHz samples, pacing and
250-ms input guard remain. This is a component path check; the 32-track native
profiler bypasses Swift framing, so this cannot repair or qualify its capacity.
The earlier deadline failure remains recorded; this is not a soak or installed
application result.

## Shared CPU thread-budget comparison

The same original model and 15-second two-span/32-track workload are compared
with one caller/four ORT intra-op threads and a fresh four-caller/one-thread
control. Both deliver all input and visit all 32 tracks; neither qualifies.
Decode age includes FIR delay under the definition above.

| Callers × intra-op threads | Completed / submitted | Coalesced / dropped / invalidated | Max input lateness ms | P95 decode age ms | Peak RSS MiB | Workload CPU / wall seconds |
| --- | --- | --- | --- | --- | --- | --- |
| 1 × 4 | 101 / 288 | 187 / 0 / 0 | 42.4993 | 3698.35525 | 146.938 | 30.8012 / 17.8865 |
| 4 × 1 | 149 / 288 | 139 / 0 / 0 | 77.1809 | 2761.092292 | 281.641 | 25.1447 / 16.9494 |

Model Run mean/p95 are 113.106/225.827 ms and 284.975/567.069 ms respectively;
the lower single-caller wall time does not imply higher aggregate throughput.
Queue mean/p95 are 947.058/3072.808 ms and 637.120/1946.165 ms. Preparation is
92.0322/62.5398 ms. Neither run has inference faults. No compiler/test overlaps
either run; host one-minute loads are 10.91→14.79 and 8.81→13.70. Ordinary
applications remain running. No thermal warning is recorded; sustained thermal
and complete app responsiveness qualification remain open.

The original model passes strict scalar/token/sample/score parity at four
intra-op threads. The separate integer-attention candidate fails that check:
in the window beginning at sample 23168, token 7 (`X`) starts at sample 23840
instead of the scalar reference's 23792 (both end at 23888). Its four-thread
profile is rejected before load testing; alignment tolerance is unchanged.
The bounded test selector `cpu-intra4` remains for reproducibility. No decoder
default, model, production capability or acceptance predicate changes.
Private exact-source receipts are `thread-budget-original-{1x4,4x1}-01` under
the completion evidence directory; native parity receipt is `e0d3dbd130e69ead`.

## Bounded Accelerate MatMul experiment

The recorded ORT kernel costs justify testing matrix execution next. A native
engineering-only custom MatMul routes the original graph's 44 MatMul nodes to
Apple `cblas_sgemm`; all learned tensors, features, windows, stride and the pinned
ORT runtime remain unchanged. Broadcast ranks 2–4 and tensor sizes are bounded.
macOS 15's per-calling-thread BLAS setting constrains each caller to one BLAS
thread and is restored after each operation. One shared ONNX session and four
existing job workers remain. This is a kernel-routing experiment, not a new
decoder, model-quality qualification or production capability.

The transformed graph SHA-256 is
`b22a4e8b8b077f71546fd5a5756d6274adc445dfdc93861694229dd95f260b3c`.
Original licence/metadata/source provenance and exact transformation are retained
in `model-accelerate-matmul-02`. Against the original model, 24 tensor cases
(batch 1/2, frames 334/401/467/534/601/667, silence/random features) compare
757,008 outputs with maximum absolute error 0.0000152588 and identical every-frame
argmax. Twelve native feature/CTC cases preserve text, token samples and scores,
including origins near UInt64 maximum. Native engine, signed drift, converging
carrier, ownership and overload checks pass on the candidate. Parity receipt:
`cd2793b7ccef659d`; engine/load receipt: `9b275082f7b48a66`.

The unchanged 15-second standard workload **fails**, stopping at 7.59467 seconds
of input with 284.695-ms maximum lateness. It completes 64/64 submitted jobs,
visits all 32 tracks, and reports zero coalesced/dropped/invalidated/fault events;
that shortened population is not a no-loss full-load pass. P95 decode age is
2389.168041 ms; model Run mean/p95 186.302/557.609 ms, queue 646.171/1871.790 ms,
peak RSS 175.062 MiB, preparation 60.1433 ms and workload CPU/wall
7.086/9.40938 seconds. No compiler/test overlaps the load measurement. Host
one-minute load starts at 13.56 and ordinary applications remain running.
No held-out RF quality evaluation or production promotion follows a failed load.

The experiment is removed from active source. Its exact five-file patch is
retained with SHA-256
`08c114bb86aec6c0e7497dc9bb4f70b7476ece4e4524243182b13ac96abd06be`;
the per-run source copies, binary/runtime/model hashes and process/thermal
records remain in `accelerate-matmul-capacity-01`. The default native path and
package configuration are unchanged. API contracts were checked against the
pinned local ORT headers, Apple's SDK `thread_api.h` and the official
[ORT custom operator](https://onnxruntime.ai/docs/reference/operators/add-custom-op.html)
and [Apple SGEMM](https://developer.apple.com/documentation/accelerate/cblas_sgemm(_:_:_:_:_:_:_:_:_:_:_:_:_:_:)) documentation.

## Original dynamic NeuralNetwork / Neural Engine control

The existing `coreml-neural` dynamic profile is separately checked with the
unchanged original model. It requests CPUAndNeuralEngine, not the previously
measured CPUAndGPU policy. Native scalar/text/token/sample, drift, track and
overload checks pass before load; the owned parity process's largest sampled RSS
is 755.984375 MiB (50-ms monitoring; not an exact lifetime peak). CoreML supports
282/503 nodes in 103 partitions. No model, default, windows or cadence changes.

The same `16 15 4` standard workload **fails** after 7.97867 seconds of input:
40/64 jobs complete, 24 coalesce, none drop/invalidate/fault, and all 32 tracks
are visited. Maximum input lateness is 439.385 ms and p95 decode age 6178.386 ms.
Model Run mean/p95 are 707.872/3619.038 ms; queue wait 3352.709/5634.813 ms;
preparation 4265.61 ms; peak process RSS 556.938 MiB. Workload process CPU/wall
are 8.12034/13.1994 seconds. No task compiler/test overlaps load measurement;
host one-minute load is 15.95→17.91 with ordinary applications retained and no
recorded thermal warning. These are process-only metrics, excluding CoreML
service processes and complete app responsiveness. Strict thresholds remain.
Receipt `9b7efec67d0bf4ca`; original hashes, source, parity logs, process and
thermal evidence are retained in `original-dynamic-neural-capacity-01`.

## Bounded eight-caller shared-session experiment

An engineering-only eight-job-worker budget uses the existing shared CPU session,
one intra-op thread, the separate integer-attention candidate and unchanged input,
windows, stride, history and job accounting. Forty concurrent fixture copies
preserve scalar text, token boundaries and scores (`61cb2dac530c32db`). This is
execution parity, not independent RF quality. No per-track runtimes are added.

The eight-worker standard run stops after **2.176 seconds**, before any inference
job is submitted, with **329.292 ms** input lateness. Its zero jobs/coalesces and
unknown decode age cannot establish eight-worker throughput or a speedup. The
paired four-worker control delivers all 15 seconds and services all 32 tracks,
but completes **228/288 jobs with 60 coalesced** (zero dropped/invalidated/faults),
so strict capacity remains false despite **1805.827667 ms p95 decode age** and
79.5146 ms maximum input lateness. Model Run mean/p95 is 161.94043/288.867209 ms;
queue wait 469.471006/1044.952917 ms; features 4.081328/7.995417 ms. Preparation
is 118.93 ms, peak process RSS 166.047 MiB, workload CPU/wall 27.803/15.9941 s.

No task compiler/test overlaps either load. Ordinary applications remain running;
host loads are 8.15→8.06 and 8.06→9.07. These are process-only measurements, not
complete app responsiveness or sustained thermal qualification. Exact receipts
are `int8-shared-workers-{8,4}-01`, archive `d59c710c240c3320`. The three-file
worker-budget experiment is removed and retained privately with SHA-256
`b498181d65cd7f7924d3aae06a4b6f3ffa0d66a8b5eccc4a1dbfdb29d2aeaae6`.
Only the bounded `cpu-shared8` parity selector remains; production keeps four
workers and the original model. No failed-run retry or threshold change follows.

## Original-model CPU fixed steady-window control

The existing two-plan profile is measured with CPU for both plans: dynamic startup
and exact 667-frame steady windows, four job workers and one intra-op thread.
The original model/runtime/features/stride are unchanged. Five scalar versus
dynamic/static text/token/sample/score cases pass via `cpu-steady-parity`; the
selector runs only that bounded comparison. No per-track runtimes are introduced.

Both unchanged 2×96-kHz / 32-track / 15-second runs **fail**:

| CPU plan | Delivered seconds | Completed / submitted | Emitted | Coalesced / dropped | Max input lateness ms | P95 decode age ms | Peak RSS MiB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Dynamic startup + fixed steady | 10.112 | 77 / 160 | 73 | 83 / 4 | 307.536 | 2833.25 | 388.672 |
| Paired dynamic control | 14.464 | 180 / 288 | 176 | 108 / 4 | 355.924 | 3762.576208 | 294.016 |

All 32 tracks are serviced; both have zero invalidated jobs/faults. Neither input
population is the requested full 15 seconds. Static-plan startup/steady emitted
counts are 41/32, with model Run mean/p95 367.232619/706.06675 and
269.835391/353.050041 ms. Overall Run mean/p95 is 324.537944/588.283458 ms;
queue 786.939319/2197.985958 ms; preparation 198.06 ms; workload CPU/wall
12.9941/12.9255 s. Dynamic Run mean/p95 is 239.271419/415.638125 ms; queue
746.333757/2771.206709 ms; preparation 119.406 ms; workload CPU/wall
28.6147/17.9508 s. The unequal delivered populations do not establish a speedup.

No task compiler/test/live capture overlaps these load runs. Ordinary applications
remain running; host one-minute loads are 15.09→15.90 and 22.64→31.17. No thermal
warning is recorded; those are not sustained headroom or whole-app responsiveness
passes. Receipts `8afecefed76226e8` / `083a78bbc93c5d6d`, exact argv/source/model/
runtime hashes and host snapshots remain in `original-cpu-{steady-ten-second,dynamic}-01`.
These are local replay measurements independent of Australia–Slovakia network
latency. No production profile or strict predicate changes.

## Low-level and impulsive-noise development controls

The operator's unannotated 40 m recording is now replayable through the existing
supervisor/child; provenance and limits are in [native replay](NATIVE_REPLAY.md).
Typical QRN remains an operating condition to handle, not a reason to exclude this
recording from development. No decoded calls are promoted to reference truth.

A separately frozen low-amplitude control uses the original model, mono ABI and
existing independent fixture keying: 15/20/25/30/35 WPM, amplitudes
0.0003/0.001/0.003/0.01, three random sequences per condition, seed 83100637 and
texts disjoint from the original clean slice. All **60 sequences / 360 characters
have zero errors** (`971073e7a5695204`). The original 150-sequence/960-character
clean profile is unchanged. This gives no measured reason to add input gain or
replace the model merely because the recording's channel audio is quiet.

An offline, explicitly **noncausal** whole-file impulse-mask prototype preserves
the original recording, sample count and clock. It masks 9,782 complex frames
(1.02925%) using a median-power ×64 / minimum-amplitude 0.1 threshold, runs at
most 0.5 ms and two padded samples per side. Replaying that derivative emits 135
windows across eleven track IDs, compared with 126/ten originally. Changed
tracking, text and readability are not an accuracy improvement without a
transcript. Its derivative SHA-256 is
`261e6fd7daeb15d65d3ae1b46634d70c3ca3df3857836cd290392c48f977cc11`.
No production preprocessing is changed.

The next comparison freezes seed 83100638, 24 six-character messages at
15/25/35 WPM, amplitudes 0.003/0.03, 0/10-dB keyed-on SNR in a declared
2,500-Hz convention and two cases per condition. Analytic 48-kHz complex IQ
places the carrier at −14,013.5 Hz; circular white-noise variance is derived from
that SNR. Added independent impulses have amplitude 0.8, 50 arrivals/s, uniform
1–24-sample widths and random phase. All three variants use the same existing
native channelizer and original-model mono ABI: white noise alone, noise plus
impulses, and the offline mask. **Each recovers 144/144 characters, 24/24 exact
sequences.** Thus this profile demonstrates no benefit from the prototype;
it does not establish RF robustness under the recording's unknown conditions.
Frozen plan SHA-256
`7fdc277be0ce15e7d107f4b901cb9b30c15cd031a6ca95adf77758d355284e72`,
receipt `c412b945b156a314`; deterministic seeds, runner/DSP/model hashes, labels
and per-case output remain in `synthetic-impulse-iq-01`. These are development
controls, not held-out CER, spot precision/recall or throughput qualification.
