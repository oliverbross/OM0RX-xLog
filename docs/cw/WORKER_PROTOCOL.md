# Native CW worker protocol v1

Internal binary sample transport; no radio, credentials, QSO, shell or publishing
operations. The Swift worker will be the sole supervisor. A renderer must never
receive raw samples or obtain this file descriptor.

Prefix: `XCW1` then little-endian uint32 body length, **52–131124 bytes**. All
numeric header fields are little-endian. Shared 52-byte header:

| Offset | Type | Meaning |
| ---: | --- | --- |
| 0 | uint16 | protocol version 1 |
| 2 | uint16 | message type below |
| 4 | 16 bytes | opaque stream token; new UUID for every capture identity |
| 20 | uint64 | capture epoch |
| 28 | uint64 | input sequence / metrics request ID / FocusTrack revision |
| 36 | uint64 | first absolute delivered source sample (IQ) or channel sample (mono) |
| 44 | uint32 | sample rate |
| 48 | uint32 | count: complex pairs for IQ, scalar samples for mono |

| Type | Body size | Payload / behavior |
| ---: | --- | --- |
| 1 StreamOpen | 72 | count/sequence/first zero; float64 lower offset, float64 upper offset, uint32 flags (bit 0 replay, all others rejected) |
| 2 MonoWindow | 52 + count×4 | 16000–32000 little-endian finite floats at 3200 Hz; original development spike |
| 3 EpochEnd | 52 | no payload; retire only this token |
| 4 Stop | 52 | no payload; invalidate all sources and exit |
| 5 IQ | 52 + count×8 | interleaved float32 I,Q; 1–16384 pairs and no more than 125 ms at the opened rate |
| 6 Gap | 52 | no payload; retire this token; a new StreamOpen is required |
| 7 Metrics | 52 | no payload; reply echoes request sequence; does not start sources |
| 8 MuteTrack | 68 | sequence/first/rate/count zero; 16-byte track UUID; suppress only this token/epoch/track until retirement |
| 9 FocusTrack | 68 | sequence carries track revision; first/rate/count zero; 16-byte track UUID; bounded preference for this token/epoch/track/revision |
| 10 ClearFocus | 52 | token, epoch, sequence, first, rate and count zero; restore ordinary ready-job order |

StreamOpen is mandatory before IQ. No conversion or guessing repairs a wrong
epoch, sequence, sample position, sample rate or nonfinite block. Such a fault
retires that source and leaves other sources alive. Framing errors terminate the
compute process, leaving recovery to its supervisor. Sources are capped at two,
tracks at 16 per source, inference at a fixed shared pool (four threads on Mac,
two on other platforms). These ceilings do not establish qualified capacity.

Output is NDJSON on stdout; bounded human diagnostics use stderr. `ready` reports
actual runtime version, ABI and resource ceilings. Events are `stream`, `track`,
`decode`, `retired`, `fault` and `status`. Decode events retain stream token,
epoch, UUID track, track revision, signed offset, replay flag, absolute channel
sample range, source sample origin and FIR delay. Token boundaries are approximate
CTC alignments. Log scores are uncalibrated; copy is provisional. The parent must
recheck the current radio capture and apply transcript/identity/quality policy.

An IQ token may also carry the complete pair `rf_offset_hz` (finite numeric
measured offset) and `rf_sample` (decimal-string channel index). Both are absent
when unknown. The observation must precede or equal the token end and be no more
than 1600 channel samples old; partial pairs, future/stale samples, booleans and
out-of-contract offsets fail parsing. Reflected zero-duration edge tokens still
cannot become aligned evidence. Mono inference does not invent RF metadata.
This additive unshipped v1 extension is validated at both bundled endpoints.
An old child without observations cannot supply accepted-spot RF evidence.

An IQ **decode event** can carry the same optional pair at its top level, bound
to the most recent actual carrier observation preceding its window end (at most
1600 samples old). The diagnostic `offset_hz` alone does not authorize RF actions.
Unknown current carrier evidence remains absent. The parent also accounts for
received-IQ/sample backlog, elapsed local time and FIR delay before admitting an
RF target. Metadata-only track notifications cannot renew that measurement.
A retained UUID cannot change capture descriptor, source sample origin or FIR
delay: the parent retires its evidence if any changes. The event queue reserves
384 bytes per event plus its bounded text/token estimate within the same 1 MiB.

All 64-bit identities/counters/sample indices use decimal strings in JSON.
Events are at most 667 tokens for a ten-second window; consumers must impose a
128-KiB line limit. The worker's derived-event queue is capped at 64 entries /
1 MiB with superseded-copy coalescing and visible drop counters. The writer is
independent of IQ ingress. A supervisor must drain stdout/stderr independently,
bound its own queues and kill/reap a stalled child on its shutdown deadline.
This process boundary is not an OS sandbox.

IQ encoding builds the final bounded frame directly. Little-endian hosts copy
the interleaved Float32 payload once; other hosts retain explicit per-value LE
conversion. Header lengths, sample/sequence counters, float bits, I/Q order and
the 125-ms frame budget are unchanged. Bit-pattern fixtures cover signed zero,
subnormals, finite extrema, near-UInt64-limit positions and the maximum frame.

Queue accounting allows 192 bytes per derived token, including the RF pair;
the 128-KiB line and 1-MiB derived-event limits are unchanged. Each track retains
at most five candidate measurements and 256 historical observations, at most
25 recorded points per channel second. Jobs copy that bounded history, not IQ
into JSON. The parent projects strings/track state to the UI, not raw tokens/IQ.

Pending-job replacement and derived-event loss both advance the affected track's
revision. A pending replacement also emits `track / overloaded`, with a nonzero
new revision and equal first/end channel indices marking the lost job's end.
The coalesced/dropped counters retain their existing meanings; neither event is
a qualified standard-load result. Old in-flight/queued revisions cannot escape
the native result fence.
Ambiguity entry and recovery also use equal first/end indices at the actual
current channel position, so an ambiguity before first inference still fences
the historical audio. A later decode retains its own observed RF offset.

The parent resets text, selection and queued-publication proof on revision loss.
It rejects tokens preceding the continuity fence even when later overlapping
model windows still contain them. If the explicit overload marker is lost, the
first new-revision decode's end is the conservative fence instead. Fresh distinct
self-IDs can establish evidence again; old occurrences cannot be counted again.
This extends the unshipped v1 track-state vocabulary; both bundled endpoints
validate the exact contract and an older parser fails visibly on `overloaded`.

The macOS spawn primitive in `Sources/CCWProcess` uses
`POSIX_SPAWN_CLOEXEC_DEFAULT`, explicit stdin/stdout/stderr dup actions and a
fixed PATH/LANG/LC_ALL environment. All original pipe descriptors are
close-on-exec and closed in the child. A native probe deliberately opens an
unrelated inheritable parent FD and a test environment value; it verifies neither
crosses the spawn boundary and checks separate output/error pipes, reap, spawn
failure cleanup and invalid-PID guards. The parent input FD also sets
`F_SETNOSIGPIPE`; writing after the probe exits returns EPIPE without terminating
the parent. The Swift lifecycle owner still needs to
use this primitive with its bounded transport and shutdown watchdog.

The ABI does not yet carry a cross-process monotonic timestamp. The supervisor
must retain producer receipt/source-sample mapping and enforce the 250-ms input
queue budget before transport. Measuring full queue age and adding a negotiated
clock contract remain required before live acceptance.

## Executed subprocess checks

```sh
python3 Tests/fixtures/cw/generate.py .build/cw-fixtures
python3 native/cw-worker/verify_protocol.py .build/cw-native/xlog-cw-worker \
  vendor/deepcw-engine/model.onnx .build/cw-fixtures
python3 native/cw-worker/verify_iq_protocol.py .build/cw-native/xlog-cw-worker \
  vendor/deepcw-engine/model.onnx .build/cw-fixtures
```

The IQ test runs the real native child with Microsoft's hash-pinned runtime
1.24.3. It checks both decoded identities and signed offsets from generated IQ,
replay/epoch/track provenance, pool bounds, malformed epoch/rate/gap/nonfinite
faults and IQ-before-open rejection. The original mono ABI and its six framing
rejections still pass. This is replay/process evidence; no radio, live spot
destination, application package, or hardware is exercised.

For a separately built component, the real-child Swift harness accepts the
test-only `XCW_TEST_NATIVE_DIRECTORY` and pinned `XCW_TEST_RUNTIME` paths. These
are harness inputs, never production or renderer configuration.

31 October source regressions first reproduce the defects: seven parent
assertions fail across two overload cases, and the real native unread-output
case fails its continuity-revision assertion. After repair, 25 focused Swift
session/wire cases, 51 renderer projection/callsign/Tune/panel cases and TypeScript
pass; all 15 real-child/wire cases also pass against the explicitly selected
current component. Native CTest passes 2/2. Its injected unread-output run records
zero coalesced / five dropped events, and accelerated inference overload records
15 coalesced / zero dropped events; both retain a bounded queue and require a
new revision. These are deliberately unqualified overload fixtures, not normal
capacity or elapsed-time soak evidence. Parent fixtures reject old overlapping
self-IDs and queued spots, then accept fresh post-fence distinct self-IDs.

Lossless receipts: `3be53f2248d58d15` / `0373216b9fab4752` (failing parent/native),
`518a21b2d0da6c6e` (Swift), `27e38ff9e2578223` (renderer),
`2faf007ae7be3733` (CTest), `1a53ad9d49935ec8` (real child).
