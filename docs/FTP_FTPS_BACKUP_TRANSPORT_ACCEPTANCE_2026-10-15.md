# FTP and FTPS backup transport acceptance — 15 October 2026

## Outcome

Exact source `edd3182e7b95c2dc3cc41f98fff4a11507bec544` adds the native
FTP and implicit-FTPS transport foundation for BACKUP-01. One frozen backup
first reserves a plan-derived unique directory with `MKD`, writes exactly one
object inside it, independently downloads the object, and computes xLog's own
SHA-256 before a verified receipt can exist. Restore accepts only the exact
provider/account/backup/hash tuple retained by that receipt and rechecks the
downloaded bytes again.

This is source and isolated-package acceptance, not a live FTP-server,
installed-app or operator-workspace acceptance. No real server connection,
credential or Keychain mutation, upload, download, deletion or restore was
performed.

## Transport contract

- Plain `ftp://` is accepted only with the existing explicit insecure opt-in.
  The UI/presentation layer is not connected in this stage, so no destination
  can become active merely because this adapter exists.
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

## Verification

- Focused native FTP/FTPS contract: **7 test functions in 1 suite** pass,
  including both schemes, exact absolute paths, TLS selection, independent
  hash verification, corrupt-download rejection, durable no-replay, account
  fencing, retention rejection and cross-provider receipt namespaces.
- Full native Swift: **224/224 tests across 30 suites** pass with warnings as
  errors.
- Portable/full shared gate: XStation **17/17**, XLogPrototype **209** with four
  explicit skips, XCluster **56/56**, and Swift Testing **405/405 across 54
  suites** pass with warnings as errors.
- The C bridge passes `clang -std=c11 -Wall -Wextra -Werror -fsyntax-only`.
- The exact-source uninstalled macOS bundle passes strict deep signature
  verification. Embedded distribution metadata reports
  `edd3182e7b95c2dc3cc41f98fff4a11507bec544`.
- Host binary: arm64, SHA-256
  `8f7ec0052103b1d00404f27b79437b09f62298c4887fe02abd413144bbba929e`.
- Swift worker: universal x86_64/arm64, SHA-256
  `f573efc18fbe5b3afe073d132c0f24f3c44bb52133bcb71086fd66f4e4776809`.
- Isolated report `prototype/dist/ftp-edd3182-native-acceptance.json` passes
  **33/33** with `status: passed`, `scope: integrated-local-ui`, `embeddedUi:
  true`, `worker: true` and `station_io: false`. The candidate process exited;
  the separate installed alpha.29 process was not stopped or replaced.

## Remaining gates

- Native credential-vault/presentation ownership and explicit operator
  authorization for FTP and FTPS destinations.
- Live tests against disposable plain-FTP and trusted-certificate implicit-FTPS
  servers, including refusal, lost-acknowledgement, size, timeout and restore
  cases. No operator log may be used for that acceptance.
- Installed macOS acceptance after operator approval.
- A separately designed, host-key-pinned SFTP transport.
- Windows and Linux implementation/package evidence remains deferred until the
  macOS programme is accepted.
