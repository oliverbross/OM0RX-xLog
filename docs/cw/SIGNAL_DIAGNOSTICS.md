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
