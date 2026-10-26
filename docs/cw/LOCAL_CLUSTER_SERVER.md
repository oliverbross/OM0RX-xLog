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
