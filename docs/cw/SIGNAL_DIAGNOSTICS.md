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

The channelizer has an Apple Accelerate FIR implementation and a scalar fallback;
tests compare both at 24/48/96/192 ksample/s. Channel creation is limited to one new
channelizer per input block per span. The Mac worker uses four fixed inference
workers. Two spans with sixteen tracks each remain an engineering ceiling.
See Apple's [vDSP_dotpr2 documentation](https://developer.apple.com/documentation/accelerate/vdsp_dotpr2).

## Replay load tool

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
