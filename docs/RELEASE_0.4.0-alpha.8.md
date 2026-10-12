# Integration 0.4.0-alpha.8

Mac development preview with large-log performance improvements and shared
local-logbook infrastructure. The original native app and its logbook remain
separate. Full feature, hardware and cross-platform acceptance are not complete.

## Changes

- Indexed import identity checks avoid scanning the whole log for each record,
  while preserving duplicate and deleted-record handling.
- A derived SQLite index accelerates statistics, award progress and map totals.
  History and award calculations decode only the fields they need.
- The generated 100,000-contact native test measured first logbook display at
  80 ms, first Awards at 698 ms and repeat Awards at 25 ms. These are individual
  development-Mac observations, not guarantees for every log or machine. Cold
  Awards remains above the near-instant target.
- Shared Windows/Linux local logging now includes SQLite, ADIF, settings,
  bundled CTY/awards resources and backup workflows. Fresh native package
  checks have passed on Windows Server and in an Ubuntu runtime container;
  these do not establish physical desktop, connected-device or full service parity.
- Chaser and DX public-feed parsing, local reference history and cached evidence
  now use a shared backend. Downloads are bounded, cancellable and reject
  redirects; failed refreshes retain validated cached data with a stale status.
  Native Windows/Linux acceptance for this latest feed change is pending.

## Verification and limits

Before the version bump, local tests passed 139 worker XCTest cases, 57 Swift
Testing cases, 73 native core cases and five real worker-process checks.
The native generated large-log workflow passed all 21 functional checks.
Detailed measurements are in `NATIVE_LARGE_LOG_PERFORMANCE_2026-10-13.md`.

No RF transmission, radio tuning, serial-device probing or rotor movement was
tested. Station policy, credentials and transmit permissions are unchanged.
Portable live cluster transport, authenticated services and secure credential
stores remain incomplete. Compact/high-DPI visual acceptance and the remaining
operator-feedback and parity-ledger gates are still open.

Signing, notarization, installation and exact-package checks are recorded
separately in the installed acceptance report; this note alone proves none of them.
