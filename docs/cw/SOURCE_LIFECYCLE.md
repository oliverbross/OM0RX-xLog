# CW Decode source lifecycle

`CWDecodeSession` is the single native owner above `CWComputeProcess` and the
existing radio owners. Creating it or reading a snapshot does not acquire IQ.
Start binds a saved configuration revision; Stop revokes its intent before any
await and releases exact, preallocated provider lease UUIDs. A late acquire or
model result cannot attach itself to the stopped session.

The compute child must announce ready before sources are acquired. A transient
source failure releases only that source and retries after 1, 2, and 4 seconds,
then blocks until explicit Stop/Start. Unsupported contracts, invalid samples,
occupied/unknown/missing resources, rate conflicts, missing handoffs and missing
manufacturer discovery block immediately with the exact bounded operator reason.
They cannot be repaired by repeating the same acquisition. Child failure releases
all leases, reaps the child and uses bounded recovery; memory faults instead
require deliberate restart as described in `COMPUTE_SUPERVISOR.md`. Retry budgets
do not reset merely because another short-lived connection succeeded.

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

## Specific failure and awaited cleanup

`CWIQSourceFailure` is the shared bounded diagnostic vocabulary. Existing native
Flex/TCI errors are converted at the provider adapter, including errors ending a
stream. Unknown errors become unavailable; arbitrary error text/credentials are
not serialized. The operator projection checks the same code set. Flex handoff
errors retain discovery, ownership and resource distinctions. Discovery timeout
is separate from a stream request receiving no data; unverified RX never grants
receive permission. Protocol parsing/admission and the 30-second handoff remain.

A regression reproduces unsupported TCI being retried four times and reduced to
`iq_unavailable`. It now blocks on the first attempt with its reason while the
other span continues. Another regression reproduces an old failure clearing a
new Start after awaiting scoped compute End. Session intent and exact lease are
now checked again after that await, including monitor invalidation. Cleanup can
release only the old lease; it cannot overwrite the replacement's state.

Focused verification passes 37 session/policy, 13 provider/worker-method and 20
Flex/TCI subscription cases (`15bc200e71a63a8d`), with 30 projection/panel cases
(`d2e37c8c82eb3ee7`) and TypeScript passing. The frontend build and all window
budgets pass (`6e982d274be504ec`); CW Decode's startup graph is 309,070 bytes.
These injected/loopback checks do not establish actual one/two/mixed-radio
acquisition or resource cleanup on hardware.
