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
| 28 | uint64 | input sequence / metrics request ID |
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

All 64-bit identities/counters/sample indices use decimal strings in JSON.
Events are at most 667 tokens for a ten-second window; consumers must impose a
128-KiB line limit. The worker's derived-event queue is capped at 64 entries /
1 MiB with superseded-copy coalescing and visible drop counters. The writer is
independent of IQ ingress. A supervisor must drain stdout/stderr independently,
bound its own queues and kill/reap a stalled child on its shutdown deadline.
This process boundary is not an OS sandbox.

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
