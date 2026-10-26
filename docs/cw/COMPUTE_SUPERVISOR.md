# Swift compute supervisor

`XCWCore.CWComputeProcess` owns one native child on behalf of the existing Swift
application worker. No Tauri or renderer process creates a competing compute
child. This is an implementation component; it is not yet exposed as a live
radio feature or included in an application candidate.

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
  top-level decode session still needs to implement the bounded 1/2/4-second
  automatic recovery policy, manage provider leases and reset track evidence.

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
