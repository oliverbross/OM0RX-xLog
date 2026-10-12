# Portable live cluster implementation 13 October 2026

The shared worker now routes cluster configuration, connections, console commands,
filters and snapshots on Windows and Linux. Both platforms use the existing
session, parser and classifier with a new Winsock/POSIX socket adapter. macOS
retains its Network.framework transport. This source stage is not an installed
release or a full-parity certificate.

Initial transport source: `c17cff2c84845e8aea9abeaf6fd139e386eb71c1`, pushed to
`codex/unified-xlog-integration-p2`. All-platform CI run `38302431354` passed
Mac, Windows and Linux builds plus Windows fresh-runner and Linux runtime-only
container acceptance. The DNS follow-up is pushed as
`6e7ea391bd765cceb2cb70b7cc6aa1ff41252a71`; its exact-source matrix
`38304045236` has passed all three portable core suites and the Mac job, while
remaining packaging/runtime stages are in progress.

## Transport and ownership

Each connection owns its socket on one serial I/O lane. Cancellation never closes
a descriptor under a concurrent syscall. DNS and TCP now share one ten-second
connection deadline; receive polling checks cancellation every
100 ms. Writes handle partial sends with a five-second deadline. Pending commands
are capped at 64, discarded when the connection fails and never replayed after
reconnect. Login and Skimmer requests retain the native sequence. Received Telnet
framing and password redaction use the shared behavior.

The worker owns its cluster projection and logbook reference. Disposable workers
store cluster configuration under their own workspace, not the operator profile.
Chaser consumes that same worker's spots. Terminal shutdown retires the session
and rejects late connects; ordinary operator Disconnect remains reconnectable.
Local packaged acceptance continues to reject live cluster requests before
dispatch, reporting `live_cluster: false`.

## Capability boundaries

macOS keeps the existing Keychain service. Windows/Linux secure cluster password
storage is not implemented yet: saves/removals fail explicitly, the UI disables
password entry and no plaintext fallback exists. Callsign-only servers can connect.
Portable credential storage remains a required parity gate, not a removed feature.

Later source follow-up: Windows now has a Credential Manager adapter wired into
this path, awaiting its exact-source native CI fixture. The unsupported paragraph
above describes the initial transport stage; Linux remains unsupported. See
[`WINDOWS_VAULT_STAGE_2026-10-13.md`](WINDOWS_VAULT_STAGE_2026-10-13.md).

FLEX spot forwarding still requires the Mac direct-agent path. Unsupported hosts
show that limitation and reject enabling it. A configuration transferred from
macOS remains readable and permits explicitly turning forwarding off before Save.

System `getaddrinfo` is synchronous, so a bounded shared resolver runs it away
from both UI and connection lanes. Stop releases the connection without waiting
for DNS. Each abandoned lookup retains its permit until the OS returns; at most
16 resolver jobs can remain outstanding across the worker. Additional attempts
fail promptly instead of creating more DNS jobs. Late results are freed without
opening sockets. Queued jobs abandoned before execution skip the lookup.

This is cancellation of the application's wait, not forced termination of an OS
resolver call. If all 16 OS calls remain stuck, new hostname resolution remains
unavailable until one returns. OS-specific resolver interruption and real
dual-stack network acceptance remain open; the application connection deadline
and resolver resource bounds now have deterministic regression coverage.

## Verification

- Six portable transport tests passed using owned ephemeral IPv4/IPv6 loopback
  listeners on macOS. They cover split Telnet input, exact login/command bytes,
  password redaction, remote close, timeout, reconnect and cancellation.
- Full portable-mode Mac suite after the DNS follow-up passed 151 XCTest and
  62 Swift Testing cases, including the transferred-forwarding worker test.
- Frontend suite passed 352 tests; the added transferred-preference test then
  passed with all 12 focused cluster/detached tests. TypeScript and Vite build pass.
- Five real worker-process framing/isolation tests passed against the newly built
  debug worker. Both C files passed Clang C11 `-Wall -Wextra -Werror` syntax checks.
- DNS follow-up: six tests cover expired/cancelled requests, lookup failure,
  deadline including stalled DNS, connection release before lookup completion,
  rejection of late answers and a 64-caller retry storm against two permits.
  All six DNS and six socket tests passed under AddressSanitizer with no reported
  address-safety violations on Mac. This is not a physical network or leak audit.
- Synthetic browser settings checks at 1280×800 and 1920×1080 confirmed disabled
  password/forwarding controls, readable capability text and available Connect.
  The test fixture has no worker, credential or station access. The existing wide
  full-cluster table still exceeds the laptop viewport; broader responsive-table
  acceptance remains open. No layout or design-token changes were introduced.

Rendered evidence: [laptop settings](evidence/portable-cluster/settings-laptop.png)
and [wide settings](evidence/portable-cluster/settings-wide.png).

The exact DNS follow-up Windows/Linux build and runtime matrix is the next gate.
The initial transport passed native Windows/Linux core tests, but those results
do not cover the later resolver implementation.
The installed signed alpha.9, original native app, live logbook and station
configuration were not changed. No radio, rotor, serial or RF test was performed.

## Platform API basis

Each Windows address list and socket holds its own balanced Winsock lifetime,
following Microsoft's [startup](https://learn.microsoft.com/en-us/windows/win32/api/winsock/nf-winsock-wsastartup)
and [cleanup](https://learn.microsoft.com/en-us/windows/win32/api/winsock/nf-winsock-wsacleanup)
contract. Resolver allocations are freed through the matching API described by
the [getaddrinfo documentation](https://man7.org/linux/man-pages/man3/getaddrinfo.3.html).
