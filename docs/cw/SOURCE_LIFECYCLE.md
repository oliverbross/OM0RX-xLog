# CW Decode source lifecycle

`CWDecodeSession` is the single native owner above `CWComputeProcess` and the
existing radio owners. Creating it or reading a snapshot does not acquire IQ.
Start binds a saved configuration revision; Stop revokes its intent before any
await and releases exact, preallocated provider lease UUIDs. A late acquire or
model result cannot attach itself to the stopped session.

The compute child must announce ready before sources are acquired. A source
failure releases only that source and retries after 1, 2, and 4 seconds, then
blocks until an explicit Stop/Start. Child failure releases all leases, reaps
the child, and uses the same bounded backoff. The retry budgets do not reset
merely because another short-lived connection succeeded.

Every block and model result is checked against the provider's current capture
descriptor, including session/source/radio/receiver, token, epoch and replay
identity. TX or retune invalidation ends the old native span and removes its
tracks. A 100 ms passive monitor also removes copy while no fresh IQ has arrived
for 250 ms. A temporary delivery pause keeps the native sample sequence intact;
it does not reopen the same epoch at a nonzero sample index. The provider still
owns no-data/stall deadlines and capture rollover.

Transcript state belongs to a track revision within one capture epoch. Retired
tracks and revisions cannot regain earlier copy. The parent drops model output
more than two seconds behind the latest input sample position. UI snapshots
contain bounded text/track metadata, no raw IQ.

`LiveCWIQProvider` delegates TCI acquisition to the already-connected, per-radio
`LiveTCISession`. The adapter converts bounded packets to compute frames while
retaining source sample positions. It creates no radio control connection.
TCI spectral orientation remains unqualified, so RF frequency/tune authority is
not exposed. Live quality qualification and automatic spots remain disabled.

The lifecycle tests use isolated injected providers and compute owners. They
cover passive snapshots, pending acquire cancellation, two-source isolation,
TX/retune late-copy rejection, stale-copy removal without sequence reset, and
both retry ceilings. They are software evidence, not live hardware acceptance.
