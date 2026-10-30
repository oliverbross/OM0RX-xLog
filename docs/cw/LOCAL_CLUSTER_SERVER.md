# Local CW TCP service

`CWLocalClusterServer` is a separate receive-only output owner. It starts off and
binds only IPv4 loopback; snapshots explicitly show `127.0.0.1`. Its listener,
clients and port errors are independent of IQ capture and the compute process.
The native worker has explicit, revision-bound listener Start/Stop routes;
renderer admission and UI integration are subsequent stages. Publishing accepts
validated native CW observations only.

The streaming protocol accepts a callsign/client name (32 ASCII characters),
`help`/`?`, `bye`/`quit`, and `sh/dx`, `sh/dx/N` or `sh/dx N` for 1–100 reports.
No history is sent on login. Explicit history retains original observed UTC and
goes only to its requesting client; requests are limited to one per two seconds.
There are no radio, shell, upstream-cluster or merged-feed commands.

Each client has one receive of at most 4096 bytes and one active write. The
512-byte command ceiling, three-error budget, 64-option negotiation budget,
256-byte Telnet subnegotiation ceiling and 30-second login deadline bound input.
Fragmented IAC negotiation is handled and unsupported WILL/DO options declined.
Human replies begin with `#` and cannot parse as DX spot lines.

An admission gate reserves at most eight client slots before scheduling actor
work. Output includes the active write in its 256 KiB budget. A five-second
oldest-item watchdog disconnects a slow client without waiting for its socket.
Other clients and the decoder do not share that queue. Counters expose refused,
slow and malformed sessions. A port collision is reported as `occupied`.

History is at most 100 observations, at most 15 minutes old, with a bounded ID
deduplication cache. Stop cancels only this listener and its owned connections.
History retention continues while the endpoint is off; no automatic replay is
performed when the endpoint restarts.

`CWLocalEndpointGuard` admits listener reservations and inbound cluster settings
atomically. It checks resolved local/interface addresses at matching ports and
rejects either direction of a self-loop. The default-off feature adds no DNS
work to ordinary cluster use. Each listener greeting carries its instance UUID;
an inbound connection that returns this worker's own greeting is stopped before
following lines can enter classification. This also fences a hostname that
changes resolution between validation and connection.

Listener controls do not require model resources or change decoder leases.
Loading enabled preferences stays passive. Stop revokes a pending prepared
listener start. Endpoint edits require stopping the listener, and may be saved
while decoding continues when source/spot preferences are unchanged.

Four actual loopback TCP tests cover two simultaneous plain clients, fragmented
login, live output, requested history isolation/rate limiting, duplicate events,
port collision, eight-client admission, malformed-client recovery, shutdown and
history bounds. Six protocol/queue tests cover IAC fragmentation, CR/LF, input
budgets and active-write byte/age ceilings. A real external logger, sustained
slow-socket exercise and production packaging remain acceptance gates.

The completion run adds a real authenticated unread socket and an independently
drained healthy client on an ephemeral, isolated loopback listener. The fixture
paces synthetic overload in 512-line batches, bounded to 60 seconds, to fill OS
buffers before checking the existing queue/watchdog. Initial 15-second attempts
did not force a slow disconnect; their failures are retained. macOS enlarged the
requested 1,024-byte receive buffer to 326,520 bytes, so the requested socket
buffer alone was not proof of backpressure.

All five socket cases pass after exercising that path. The final affected-case
receipt measures **18.597 s**, **11,777 lines / 612,404 bytes**, one slow disconnect,
all 11,777 lines received by the healthy client (including a final post-disconnect
probe), one remaining authenticated client and a clean listener Stop. The prior
full five-case run also passed; the last rerun corrects only byte accounting for
the final probe. These are isolated synthetic server checks, not RF quality,
an external logger, a soak or exact-package acceptance. A real external client
and production package exercise remain open.

## Installed external Telnet client — 31 October 2026

The source-level interoperability gate now passes with the actual installed
**GNU inetutils Telnet 2.2** (`/opt/homebrew/Cellar/inetutils/2.2_1/bin/gtelnet`,
SHA-256 `db366def4edb35d97b659531cd8400865e1a7a70714c4012b4aa63dadfee5bf3`).
`CWExternalTelnetTests` launches that executable directly, with IPv4, user rc and
automatic login disabled. It invokes the existing `CWLocalClusterServer` in a
marked synthetic fixture, binding only ephemeral `127.0.0.1:54050` for this run.
No production app, settings, radio or normal output destination is involved.

Two separate client processes authenticate and quit normally (exit 0/0). They
receive live fixture output at **14025.123 kHz / K1ABC/P**, and request two retained
lines. Original history UTC **0359Z** remains distinct from new output **0400Z**
after reconnect; login does not silently replay history. The listener finishes
off with zero clients. Binary hashes match before and after execution. Actual
receipt: `86230a9a26dc5cca`, one test passed. Existing BSD plain-TCP socket tests
provide the independent plain transport result.

```sh
XLOG_PORTABLE_ONLY=1 XCW_TEST_TELNET=/opt/homebrew/bin/telnet swift test \
  --scratch-path .build/cw-integration-tests-20261030 --jobs 2 \
  --filter CWExternalTelnetTests
```

Without an explicitly selected installed client this optional interoperability
test skips visibly. Telnet is a test tool, not an application dependency. This
closes the external-client protocol slice of AC23; useful live accepted RF spots
through the exact packaged/installed app remain required. No external logging
application or RF-quality result is inferred from this terminal-client result.
