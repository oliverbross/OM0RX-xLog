# Native two-span replay slice

Development implementation, not package or hardware acceptance. The retained
native slice is integrated into canonical main by f99fc51d. Its original
worktree/branch remain recoverable; application packaging uses canonical source
only. Current qualification is tracked in [COMPLETION.md](COMPLETION.md).

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

The Mac production default uses one shared CPU ONNX session and four inference
workers. Explicit bounded engineering profiles remain separate from production
admission. Each track has at most
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

Parent supervision/IPC, provider lease owners, shared UI and typed local ingress /
server are integrated in main. Actual radio/RF, strict capacity, held-out quality,
exact application package/installed behavior and soaks remain unqualified in the
completion checklist. Automatic spots remain disabled by the production policy.

## Completion replay ingress correction

The integrated real-child supervisor/wire run passed 14 cases and rejected the
continuous-copy case with `discontinuity` when that fixture pushed a 96-kHz file
as fast as its pipe drained. Pipe completion is not child sample consumption.
The fixture now paces every block at its original sample-end deadline and passes
that deadline as its receipt timestamp. Delayed input still fails the unchanged
250-ms freshness gate; no late block is relabelled fresh, skipped or retried.

The affected real-child case then passes in 12.324 seconds, recovering both
expected calls with their signed offsets and stopping/reaping the child. The
other 14 unchanged cases retain their passing receipts. This functional replay
neither qualifies 32-track throughput nor supplies live RF or soak evidence.

## Carrier drift and identity conflict — 31 October 2026

An isolated track now follows its compatible spectral peak using the existing
channelizer. Only the DSP mixer step changes: mixer phase, FIR history, sample
origin/indices and delay remain continuous. The inference job snapshots that
observed signed RF offset with its own audio window, rather than reading a later
mutable track frequency from the model thread. No radio command is involved.

The compatible-peak limit remains 75 Hz. A peak approaching within the existing
250-Hz grouping distance of another track marks both associations ambiguous,
even when their last isolated offsets remain farther apart. A known conflict
requires three fresh observations at the original 300-Hz separation before
clearing. This hysteresis prevents keying-edge/sideband jitter from silently
restoring identity at the grouping boundary. Ambiguity entry and exit carry
actual channel-sample fences; old windows cannot reconstruct pre-conflict IDs.

Independent analytic +8/-8 Hz/s keyed chirps retain one track each and recover
the actual call. Maximum RF errors are **3.94164 / 3.93887 Hz** in this clean
synthetic profile. A converging 400-Hz pair first reproduces unsafe resumed copy,
then withholds copy while unresolved; a separate returning pair resumes **17**
windows containing fresh post-fence calls on two retained tracks. This positive
recovery case prevents a pass obtained by withholding all output. Scalar /
Accelerate parity across the existing rates also proves that repeated mixer-step
updates preserve phase/counts; nonfinite/out-of-band updates fail visibly.

Native CTest passes 2/2 (`74ff0009cb0acc0d`). The real-child IQ copy case first
expires the unchanged 250-ms input deadline during a concurrent CTest run
(`20e721f8d06af25d`), then passes alone in 15.973 s (`6bfd384ae98b4423`). Neither
receipt is a capacity or soak claim. Original failing drift/convergence receipts
are `ae6e9323bf95aa63`, `8a720964109852b2` and `47dd002dc8e80eb2`. Actual real-RF
drift/crossing, frequency p95 and transmitting-station precision remain required.

## Seal corpus inputs before evaluation

`native/cw-worker/corpus_manifest.py` is a development-only stdlib utility,
separate from the decoder and preserved contest Python. It streams IQ SHA-256
with 1-MiB buffers, checks CF32 file size against lossless sample counts, pins
consent/licence and independent annotation provenance, and refuses shared
recording-family/session/operator groups across calibration and held-out splits.
Identical IQ cannot count as independent recordings. Case/outer-space group aliases,
changed inputs, linked artifacts, duplicate JSON keys and unreviewed truth fail.
No radio, decoder, destination, application configuration or quality gate is used.

Keep the manifest, annotations, seals and large IQ outside ordinary Git (the
private completion `.build` directory is suitable for local development). A
manifest uses `schema_version: 1`, the exact frozen `QUALITY_CONTRACT.json`
SHA-256, and `normalization: "trim_outer_whitespace_only_v1"`. It contains
`recordings` with the following required fields:

| Field | Required meaning |
| --- | --- |
| `id`, `recording_family_id`, `capture_session_id`, `operator_id` | Auditable original recording/session/operator identities, retained across snippets; do not invent new IDs to evade split separation. |
| `split` | `calibration` or `held_out`, fixed before evaluating held-out data. |
| `kind`, `provider` | `real_iq` with `flex_dax_iq`/`tci_iq`, or `synthetic_iq` with `synthetic`; never relabel synthetic input as RF. |
| `sample_rate`, `format` | Actual `96000` and `cf32_le_interleaved_iq`; this seal profile does not qualify a 192-kHz profile. |
| `first_sample`, `complex_samples` | Canonical UInt64 decimal strings, nonzero count, valid exclusive end; exact file bytes must equal count × 8. |
| `permission` | Object with `basis` (`operator_consent`, `licence`, or synthetic-only `owned_synthetic`) and an actual nonempty `reference` to the permission/provenance record. |
| `iq_path`, `iq_sha256`, `annotations_path`, `annotations_sha256` | Existing regular files and their exact lowercase SHA-256; relative paths resolve against the manifest directory. |

Annotation JSON must identify `schema_version: 1`, matching `recording_id`, an
`annotator_id`, explicit `independent_of_decoder: true`, and `truth_review` of
`reviewed` or `reviewed_with_uncertainty`. Its actual labels and uncertain truth
remain in that independently hashed file. These are provenance assertions to
review, not proof of correct or complete annotations. This utility deliberately
does not accept decoder guesses as truth or claim to validate label semantics.

From canonical source:

```sh
python3 native/cw-worker/corpus_manifest.py seal /private/corpus/manifest.json /private/corpus/seal.json
python3 native/cw-worker/corpus_manifest.py verify /private/corpus/seal.json
```

The output is exclusive-create, mode 0600, byte-bounded and file-synced. It pins
the validator source hash and exact manifest/annotation/IQ hashes. Reverify just
before evaluation; changed tool/input/receipt content fails. Status is always
`sealed_inputs_not_scored_or_qualified`. Recorded sample seconds are **not**
unique negative band-hours: source gaps, overlap, band coverage and eligible
exposure still require separate accounting. Nothing here establishes CER,
precision, recall, frequency error, latency, actual native output or a soak.
No independently annotated real corpus has yet been sealed for launch qualification.

## Operator 40 m recording — 31 October 2026

The operator supplied a LAN-recorded Flex DAX IQ 1 archive on the separate
`iq-recording-20261031` branch, commit `d5b2f9aab04fd3793a4996d3b794a1e237002ac6`.
The branch is preserved and not merged into main. Archive SHA-256
`d106ec3e3a2ccb8ffb47ff5616a51a97f41c221e0f136b4b2225ec8d8b1b37cc`
and CF32 IQ SHA-256
`3f2b0b66a9d14e486b20cee9189a64a4177c03e8c9f671b67496a73a6f97dac4`
verify. Its 950,400 complex samples are **19.8 seconds at 48 ksample/s**, with
metadata centre 7,050,312 Hz. This is actual RF development input, not a 96-kHz
capacity profile. SmartSDR/DAX 4.3.16.42034 and NAudio WASAPI acquisition are
reported by the Windows capture owner. The referenced original WAV is absent;
conversion, orientation, source gaps and RF mapping are not independently proven.
All samples are finite; 29 I and 24 Q component values reach absolute 0.99999.

The operator confirms audible CW with typical crackly 40 m conditions. That is
not a Morse transcription. This recording/session remains development/calibration
data, excluded from held-out evaluation. Its SigMF annotation labels capture
statistics, not transmitted characters or station identity. The supplied consent
covers this analysis; no general redistribution licence is asserted. Raw IQ,
audio and text diagnostics stay in the private `.build` completion directory.

`CWRecordingReplayTests` offers an explicit, optional recording diagnostic using
the **existing Swift supervisor and native child**. It requires an import manifest
and a fresh output path beneath canonical `.build`; absent environment variables
skip it. It checks bounded files/hashes and one sample-zero CF32 capture, records
actual sample positions and raw provisional output, and stops/reaps the child.
Every input block is drained before the next: elapsed replay time is not a
real-rate or latency measurement. Source mapping stays unknown and every event is
marked replay; no classifier, station, draft, listener or live output is opened.

Set `XCW_REAL_IQ_MANIFEST` to the verified private `IMPORT_RECEIPT.json` and
`XCW_REAL_IQ_OUTPUT` to a fresh private JSON path, together with the existing
`XCW_TEST_NATIVE_DIRECTORY` and `XCW_TEST_RUNTIME`, then run:

```sh
XLOG_PORTABLE_ONLY=1 swift test --package-path native/cw-worker \
  --scratch-path .build/cw-wire-tests --jobs 2 --filter CWRecordingReplayTests
```

The first complete original-recording run delivers all 950,400 frames, emits 126
windows across ten decoded track IDs and drains with zero coalesced/dropped work.
Its 24.331-s flow-controlled replay is functional evidence only. No RF CER,
callsign accuracy, RF frequency accuracy or committed/spot latency is claimed.
Native binary SHA-256 is
`e158eb78a7174447f5e6671efed0bb981f82e612cd0a370053c007e06a893043`;
full replay receipt SHA-256 is
`b61fe8ee21581fc85254b00f4adad4665dce9073bbe18d58f15f0b4e499e412d`.
The earlier invalid descriptor attempt is preserved. Resource/hash-rejection and
unexpected-child-exit regression passes (`88358ab93ab5d4a0`). This does not close
live Flex admission, held-out quality or the two-span standard-load gate.
The final bounded-manifest harness also passes on the original input
(`2cfbf3b7f644839e`): all 950,400 frames, 126 windows, zero coalesced/dropped work
and a drained queue, with 26.708-s flow-controlled elapsed time. No production
DSP/model changes or repeat-run performance improvement are inferred.
