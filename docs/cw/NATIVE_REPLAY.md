# Native two-span replay slice

Development implementation, not package or hardware acceptance. Continues the
canonical foundation in an isolated development worktree while the separate
radio-settings release keeps canonical source frozen. No application is built,
signed, packaged or installed from this worktree.

## Implemented path

`Skimmer` accepts explicitly opened complex-IQ sources and pins all work to the
opaque stream token, epoch, sequence and absolute source sample. It admits two
total spans and at most 16 active tracks per span. This is an enforced resource
ceiling, **not** a measured 32-track support claim.

An 8192-point spectrum with 4096-sample hop estimates carrier offsets and local
noise. Acquisition requires repeated frequency-compatible observations. A bounded
one-second IQ ring supplies pre-roll to each new channel. Independent mixer/FIR
instances produce each track's 3200-Hz mono audio; at most ten seconds is retained
per track, with a six-second first inference and one-second subsequent stride.

Keying-envelope transitions are required before inference; a constant carrier
does not automatically become a decoded CW station. Peaks within the initial
250-Hz grouping interval are treated as potential keying sidebands; comparable
nearby peaks mark an unresolved group ambiguous. Ambiguous tracks do not submit
inference. This profile needs closer-spacing, varied-keying and real-RF
characterization before qualification. It is not source separation.

One shared ONNX session uses a fixed two-thread executor. Each track has at most
one job in flight and one pending latest window. Superseded pending work is
coalesced with counters; queue order gives other admitted tracks a turn. The
event queue is capped at 64 entries / 1 MiB, coalesces superseded track copy and
reports drops. No renderer or network client participates in the compute path.

The explicit Prioritize track action adds a single shared preference, bound to
the current capture, track UUID and revision. One preferred dispatch alternates
with oldest-ready work. A busy preferred track cannot block another ready track;
changing focus does not reset its quota. This bounds priority to at most one
extra turn between ordinary FIFO turns and preserves service for all 32 admitted
tracks. It does not add workers, backlog or track capacity. Retirement and mute
remove that track's preference; Stop clears the scheduler.

The Swift owner rechecks current provider/lease and 250-ms IQ freshness before
writing the exact XCW1 kind-9 control. Clear uses a payload-free kind-10 frame.
Concurrent focus controls are serialized across views, and Stop/child replacement
fences delayed provider readback. Opening/selecting/closing a view does not alter
priority; the operator chooses Prioritize track or Clear priority explicitly.
The UI says Priority requested because successful enqueue is not a child
acknowledgement or measured latency improvement. No radio or logging action is
part of this control. Live fairness/capacity and latency qualification remain open.

Focused-scheduling source validation: two native CTests, 26 Swift session/method
cases, 15 real-child/wire cases, 19 frontend cases, the native window-authority
case and TypeScript passed. The deterministic queue fixture services all 32 IDs
within 63 dispatches with one continuously pending preferred track; the real
two-span native fixture also exercises focus identity/revision refusal and
decoding alongside mute. These fixtures do not establish real-time capacity.
The integrated frontend build and all configured window graph checks also
passed; CW Decode startup measured 303,329 bytes.

Retirement invalidates the track before removing pending jobs. A decode is
checked against the track revision after inference and again when events are
drained. Epoch/sequence/sample/rate faults retire only their input span. Other
spans continue. Stop invalidates every source. Tokens use absolute channel sample
indices; source sample origin and FIR group delay are retained for the parent to
derive source time. The capture timebase remains host/source evidence, not an
invented hardware timestamp.

Output is provisional native copy. The parent must still apply the shared
transcript reconciler, current capture check and qualified spot policy. The
compute library has no radio, draft, logbook, public-cluster or local-server
publishing API.

## Reproduce

The exact model and feature hashes remain in `vendor/deepcw-engine/manifest.json`.
This slice is tested against Microsoft's official **ONNX Runtime 1.24.3 arm64**
archive, rather than the Homebrew library used for the original spike:

```sh
cmake -S native/cw-worker -B .build/cw-native \
  -DONNXRUNTIME_INCLUDE_DIR=/private/tmp/onnxruntime-osx-arm64-1.24.3/include \
  -DONNXRUNTIME_LIBRARY=/private/tmp/onnxruntime-osx-arm64-1.24.3/lib/libonnxruntime.1.24.3.dylib \
  -DCMAKE_BUILD_TYPE=Release
cmake --build .build/cw-native -j 2
ctest --test-dir .build/cw-native --output-on-failure
```

Official archive:
https://github.com/microsoft/onnxruntime/releases/download/v1.24.3/onnxruntime-osx-arm64-1.24.3.tgz

| Resource | SHA-256 |
| --- | --- |
| Runtime archive | `c255663d40755f84b1b86373bdb9870bb65f3a2c3d779b3d7ae31aaa00cebb4f` |
| Runtime dylib | `81b90223e770bfaea12783cb99370258387bae7ed70ff7e99f2717382800d217` |
| MIT LICENSE | `2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c` |
| ThirdPartyNotices.txt | `0e07b95f3a8d6230037707c5c4a2b554d12c4cb67369669ac255635528ffcee2` |

Upstream runtime source: `3a728b75062256951b6e19ce718907cf1a1d4cf0`.
Its dynamic dependencies were inspected: system frameworks/libraries only. The
final application must still stage the runtime/notices, remove development
loader paths, sign nested code, verify model/runtime hashes offline and preserve
the existing accepted application architectures.

## Evidence and remaining work

The native test generates two independently keyed carriers at +6200 and -4100 Hz
in one 96-kHz span, with seeded complex noise, and an independent 48-kHz second
span. Native channelization and inference must recover the expected calls under
the original stream/epoch identities. It also checks the two-span ceiling and
that a source discontinuity leaves the other source alive and cannot deliver
late copy for the retired input.

Offline tests explicitly drain the inference queue between input blocks. They
prove functional separation and bounded ownership, **not real-time throughput**.
Benchmarking with paced input, 1/4/16/32 independent tracks, queue age, CPU,
memory, latency distributions and thermal state remains G1/G3 work.

Parent supervision/IPC, live Flex resource acquisition, worker-facing TCI leases,
shared UI, direct local cluster ingestion/server and release/hardware/corpus/soak
acceptance remain outstanding. Automatic spots remain disabled by the production
quality gate.
