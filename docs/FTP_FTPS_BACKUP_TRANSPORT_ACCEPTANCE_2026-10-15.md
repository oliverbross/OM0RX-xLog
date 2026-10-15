# FTP and FTPS backup transport and presentation acceptance — 15 October 2026

## Outcome

Transport source `edd3182e7b95c2dc3cc41f98fff4a11507bec544` adds the native
FTP and implicit-FTPS transport foundation for BACKUP-01. One frozen backup
first reserves a plan-derived unique directory with `MKD`, writes exactly one
object inside it, independently downloads the object, and computes xLog's own
SHA-256 before a verified receipt can exist. Restore accepts only the exact
provider/account/backup/hash tuple retained by that receipt and rechecks the
downloaded bytes again.

Exact presentation source `41a7854890c858bc051b2711e7f67f1d73d4e28f`
connects that transport to native Settings, a dedicated macOS Keychain password,
and the shared immutable backup lifecycle. The renderer supplies only operator
intent. Native code derives account and destination identities from workspace,
Keychain service, provider, endpoint, user name and directory; it freezes the
backup, checks credential presence locally, requires explicit approval, and
only then permits Start. Settings or password changes retire prior preparation
and approval.

This is source and isolated-package acceptance, not live FTP-server,
installed-app or operator-workspace acceptance. No real server connection,
credential or Keychain mutation, upload, download, deletion or restore was
performed.

## Transport contract

- Plain `ftp://` is accepted only with a separate, explicit insecure-transport
  confirmation. FTPS cannot carry that confirmation. Saving a destination or
  password does not start a backup.
- `ftps://` means implicit FTPS. libcurl requires TLS on both control and data
  channels and keeps peer-certificate and hostname verification enabled. The
  implementation follows curl's [FTP/FTPS URL and option contract](https://curl.se/docs/manpage.html)
  and its [TLS certificate-verification guidance](https://curl.se/docs/sslcerts.html).
- Proxy environment settings, `.netrc`, redirects and credential-bearing URLs
  are disabled. User name/password values remain ephemeral non-Codable values
  with redacted descriptions and bounded input.
- Network operations have connection, total and low-speed deadlines; downloads
  are bounded to the planned package size and the adapter's 150 MiB ceiling.
- A successful upload acknowledgement is insufficient. Only an independent
  read whose byte count and SHA-256 match the immutable envelope can produce a
  verified receipt.
- `MKD` is issued before `STOR`. A server `550` is deliberately recorded only
  as **not created**, because FTP servers use that code for an existing path,
  permission failures and other permanent refusals. Other failures may follow
  a completed or partial write and therefore remain **uncertain**. Neither case
  is replayed automatically.
- Generic FTP does not offer the conditional-delete proof required by xLog's
  retention owner, so retention-count destinations fail closed.
- SFTP is not treated as FTPS. The macOS system curl used here has no SFTP
  protocol support, and a separate backend must enforce pinned SSH host-key
  verification before SFTP can be enabled.

## Presentation and authority contract

- Passive snapshots read only non-secret Settings and existing local receipts.
  They do not read Keychain, contact a server, create metadata, or authorize a
  backup.
- The password has a dedicated native Keychain account and is never returned to
  the renderer. Endpoint, directory and username remain validated non-secret
  Settings values.
- Prepare freezes an immutable envelope; Check account performs only the local
  credential-presence gate; Approve records explicit one-shot authorization;
  Start is the first operation allowed to contact the configured server.
- Account identity binds the workspace generation, Keychain service, protocol,
  endpoint and username. Destination identity additionally binds the directory.
  A settings or credential revision cannot inherit an older approval.
- Unknown outcomes preserve the durable journal and are never replayed
  automatically. Restore remains a separately staged and confirmed action.
- The scheduler carries a valid interval because its shared state machine
  requires one, while the authorization is explicitly non-recurring; no
  recurring FTP/FTPS execution is enabled by this presentation.

## Verification

- Focused native FTP/FTPS contract: **7 test functions in 1 suite** pass,
  including both schemes, exact absolute paths, TLS selection, independent
  hash verification, corrupt-download rejection, durable no-replay, account
  fencing, retention rejection and cross-provider receipt namespaces.
- Focused native FTP/FTPS presentation: **5/5 tests** pass, covering passive
  no-Keychain/no-network snapshots, exact-byte FTPS execution, explicit plain-
  FTP consent, missing credentials, retirement and production-worker wiring.
- Full native Swift: **225/225 tests across 30 suites** pass with warnings as
  errors.
- Portable/full shared gate: XStation **17/17**, XLogPrototype **209** with four
  explicit skips, XCluster **56/56**, and Swift Testing **410/410 across 55
  suites** pass with warnings as errors.
- Full frontend: **2,411/2,411 tests across 163 files** pass; the production
  frontend build also passes.
- The C bridge passes `clang -std=c11 -Wall -Wextra -Werror -fsyntax-only`.
- The exact-source uninstalled macOS bundle passes strict deep signature
  verification. Embedded distribution metadata reports
  `41a7854890c858bc051b2711e7f67f1d73d4e28f`.
- Host binary: arm64, SHA-256
  `2721176ac4ac5376bb06a49a10e6c6b736bca993e58d6f0cd78c27f0dfff9688`.
- Swift worker: universal x86_64/arm64, SHA-256
  `0c715fa3df62103b0d79dff17801da453b15489cd72b1117687b4fe906aefa55`.
- Isolated report `dist/ftp-presentation-41a7854-native-acceptance.json` passes
  **33/33** with `status: passed`, `scope: integrated-local-ui`, `embeddedUi:
  true`, `worker: true` and `station_io: false`. The candidate process exited;
  the separate installed alpha.29 processes were not stopped or replaced. The
  report SHA-256 is
  `a90f2edad0e28f9d7e7d4cfb7f918556a0a0a4741498208ded3f3a73b0d3e576`.

## Remaining gates

- Live tests against disposable plain-FTP and trusted-certificate implicit-FTPS
  servers, including refusal, lost-acknowledgement, size, timeout and restore
  cases. No operator log may be used for that acceptance.
- Installed macOS acceptance after operator approval.
- A separately designed, host-key-pinned SFTP transport.
- Windows and Linux implementation/package evidence remains deferred until the
  macOS programme is accepted.
