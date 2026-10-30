# Swift compute supervisor

`XCWCore.CWComputeProcess` owns one native child on behalf of the existing Swift
application worker. No Tauri or renderer process creates a competing compute
child. The shared receive UI uses this owner through the gated engineering path;
production qualification and exact application-candidate acceptance remain open.

## Boundaries

- Validate the exact executable, model, metadata and runtime hashes before spawn.
  The runtime's reported version must also match. Release resources must supply
  the **post-signing** executable/runtime hashes from their provenance manifest;
  upstream archive hashes remain separately recorded.
- Use `CCWProcess` with explicit standard-stream inheritance and fixed non-secret
  environment. A broken input pipe returns EPIPE without SIGPIPE killing xLog.
- Drain stdout and stderr independently with DispatchIO. Raw chunk retention is
  eight 4096-byte chunks; machine-readable lines are capped at 128 KiB. Stderr
  retains at most 8192 bytes. Unknown fields, invalid types, lossy counters and
  malformed native events fail closed.
- Admit two immutable source descriptors. Source token, epoch and replay flag
  are checked again before delivering derived copy. End removes source admission
  immediately; a late callback from an older child cannot become current.
- Bound input to 16 queued frames / 1 MiB, plus a 250-ms per-source queued sample
  budget. Frames over 125 ms, stale receipt times and continuity failures retire
  that source. The shared child is retired if its pipe remains blocked for one
  second. These are parent admission budgets, not a measurement of full radio to
  compute latency; the cross-process clock/queue-age gate remains open.
- Startup must produce the validated Ready contract within five seconds. Exit,
  malformed output, output overflow and runtime mismatch isolate failure to the
  decoder. Stop closes its descriptors, terminates/reaps only the known PID and
  escalates to SIGKILL after the bounded grace interval. Reaping runs independently
  of cancellation of the reader/monitor that detected the failure.
- Retry waits for old-child cleanup. A newer Stop cancels a queued retry. The
  shared decode session applies bounded 1/2/4-second recovery, releases its own
  provider leases and resets track evidence before a new child generation.
- The existing 50-ms child monitor reads current child RSS with Darwin
  `proc_pidinfo(PROC_PIDTASKINFO)`. Above **1536 MiB**, or when an alive child's
  memory measurement stays unavailable/zero across two monitor samples, it
  retires and reaps the owned child. One 50-ms retry lets a concurrently exiting
  child retain crash classification and its existing bounded recovery behavior.
  The shared session releases its receive leases, clears evidence and stays
  blocked until explicit Stop/Start; memory faults do not automatically reacquire
  radio resources. The UI distinguishes the limit and unknown-measurement cases.
  Unknown current RSS is nil, never zero; the largest sampled RSS is retained
  for diagnostics. The fixed ceiling has no renderer setter. This sampled
  child-only guard is separate from the under-1-GiB target and complete decoder
  process-tree/headroom/responsiveness qualification; it does not measure them.

The sidecar API has no QSO, credential, public cluster, PTT, CW-send, tuning or
rotor operation. It is a reliability/interface boundary, not an OS sandbox.

## Executed harness

Build the native executables with the official runtime as described in
`NATIVE_REPLAY.md`, then:

```sh
python3 Tests/fixtures/cw/generate.py .build/cw-fixtures
XLOG_PORTABLE_ONLY=1 swift test --package-path native/cw-worker \
  --scratch-path .build/cw-wire-tests --jobs 2
```

All **12 harness tests executed and passed** with native child and model assets
present. Missing developer assets cause an explicit skip, never a fake pass.
The executed set covers wire endianness/shape, strict event parsing, padding
tokens excluded from committed evidence, 64-bit sample math, real Ready/metrics,
two sources and scoped End, stale-source isolation, stop during preparation,
restart with old streams retained, resource mismatch, unexpected child exit and
synthetic IQ copied through the actual Swift → child → Swift path. The startup
watchdog fixture intentionally ignores SIGTERM; the test verifies timeout,
SIGKILL/reap and successful creation of a fresh child afterward.

The harness has no live radio, cluster listener or QSO writer. Its generated IQ
is explicitly replay. This evidence does not close live-provider, automatic-spot,
32-track, packaging, installed-UI or soak acceptance.

The memory regression first fails without the monitor hook (`7c9d9e1fc7bbd3f4`).
The session regression also reproduces automatic reacquisition after a memory
failure (`25a2b3b942e8276f`). After correction, all 23 session cases pass
(`e8b9b0a113aaa5b1`). A deterministic internal sampler tests the exact ceiling,
one byte above it, unavailable/zero values, cleanup and explicit restart without
allocating 1.5 GiB. Native process tests verify positive actual RSS and error
results that leave prior output untouched. The real-child handshake verifies
actual child RSS. Twelve panel cases pass with specific failure messages and
passive capture behavior. Installed cleanup and resource measurements remain.
The three affected real-child cases, including a SIGKILL racing a memory read,
pass after the bounded telemetry retry (`ee2a9707a668aa9c`); crash classification
and explicit restart are preserved. That fixture signals only its own isolated
child, never an application or station process.

The complete 16-case harness has 15 passes and one continuous-replay failure
(`e6c3f40c1db5bee3`). A single isolated diagnostic rerun also fails at sample
851968 / sequence 104, with 255.208 ms deadline lateness and no child failure
(`b08d12779e7182b8`). This exceeds the unchanged 250-ms input limit. Host load
was 77.28/73.73/47.21 after the build; no competing task build/test ran during
the replay. It is not an all-green harness result or installed performance pass.
The diagnostic now records the failed deadline instead of hiding that loss.

Later RF-metadata source passes all **18** real-child/wire cases
(`487a51b6e07ef65e`), including memory/crash handling and continuous replay.
The strengthened replay assertion requires measured RF on each decoded call's
final character. Its first attempt misses the unchanged deadline at 266.651 ms
(`f804cc086b9a2646`). A separate producer benchmark checks all 16,384 Float32 bit
patterns of a 65,536-byte packet over 20 iterations: median/max per-sample-loop
conversion 1.26104/10.5097 ms versus 0.023542/0.038708 ms for native LE byte copy
(`8c23a3b523623505`). The fixture now uses that byte-identical copy, with an
explicit endian guard; data, pacing, source timestamps and the 250-ms limit
remain unchanged. The affected actual Swift → child → Swift case then passes
in 12.284 seconds (`a496e38c7869dc7c`), with final-character RF for both calls.
This is a two-signal transport/function check, not 32-track throughput or a soak.
