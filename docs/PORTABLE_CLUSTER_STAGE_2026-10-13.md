# Portable live cluster implementation 13 October 2026

The shared worker now routes cluster configuration, connections, console commands,
filters and snapshots on Windows and Linux. Both platforms use the existing
session, parser and classifier with a new Winsock/POSIX socket adapter. macOS
retains its Network.framework transport. This source stage is not an installed
release or a full-parity certificate.

Source commit: `c17cff2c84845e8aea9abeaf6fd139e386eb71c1`, pushed to
`codex/unified-xlog-integration-p2`. All-platform CI run `38302431354` is in
progress, with Mac portable tests running and Windows/Linux toolchains preparing.

## Transport and ownership

Each connection owns its socket on one serial I/O lane. Cancellation never closes
a descriptor under a concurrent syscall. TCP connection attempts have a ten-second
budget after system DNS resolution; receive polling checks cancellation every
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

FLEX spot forwarding still requires the Mac direct-agent path. Unsupported hosts
show that limitation and reject enabling it. A configuration transferred from
macOS remains readable and permits explicitly turning forwarding off before Save.

System `getaddrinfo` runs away from the UI actor but is synchronous. A stalled OS
resolver can outlast the TCP deadline and keep its I/O lane alive after Stop until
resolution returns. Bounded/cancellable DNS, failure-path resource limits and
real dual-stack network acceptance remain open. Cancellation after DNS prevents a
retired connection from sending login or commands.

## Verification

- Six portable transport tests passed using owned ephemeral IPv4/IPv6 loopback
  listeners on macOS. They cover split Telnet input, exact login/command bytes,
  password redaction, remote close, timeout, reconnect and cancellation.
- Full portable-mode Mac suite passed 145 XCTest and 61 Swift Testing cases.
  A later third worker-bridge test for transferred forwarding settings also passed
  in a focused rerun; its non-Mac rejection branch awaits native CI.
- Frontend suite passed 352 tests; the added transferred-preference test then
  passed with all 12 focused cluster/detached tests. TypeScript and Vite build pass.
- Five real worker-process framing/isolation tests passed against the newly built
  debug worker. Both C files passed Clang C11 `-Wall -Wextra -Werror` syntax checks.
- Synthetic browser settings checks at 1280×800 and 1920×1080 confirmed disabled
  password/forwarding controls, readable capability text and available Connect.
  The test fixture has no worker, credential or station access. The existing wide
  full-cluster table still exceeds the laptop viewport; broader responsive-table
  acceptance remains open. No layout or design-token changes were introduced.

Rendered evidence: [laptop settings](evidence/portable-cluster/settings-laptop.png)
and [wide settings](evidence/portable-cluster/settings-wide.png).

The native Windows/Linux build and runtime matrix is the next gate. These Mac
tests exercise the portable adapter directly but do not prove Winsock behavior.
The installed signed alpha.9, original native app, live logbook and station
configuration were not changed. No radio, rotor, serial or RF test was performed.
