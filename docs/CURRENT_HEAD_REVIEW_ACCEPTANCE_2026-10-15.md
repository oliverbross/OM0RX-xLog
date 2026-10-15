# Current-HEAD review acceptance — 15 October 2026

## Outcome

A follow-up review after the Google Drive and OneDrive transport stages found
five data/online-delivery safety defects and two separate-window recovery defects.
Exact source `bd38acec940cf5af58499e87cc47cf210ceaf8d8` closes those findings and
documents the already-enforced reference-version boundary.

This is source and uninstalled-package acceptance. The installed alpha.29 app
was not replaced or stopped. The Windows Remote Station Agent remained off; no
radio, amplifier, tuner, rotor, PTT, Tune, CW, provider-account or operator-log
action was issued.

## Review corrections

- A restore now revokes restored QRZ/Club Log enrollment and pending candidates
  in a private staged database before that database can replace the live file.
  A crash between replacement and a later callback therefore cannot revive a
  pre-backup upload queue.
- Online-log claims revalidate both active enrollment and exact candidate
  membership inside the SQLite write transaction. Cached Club Log candidates
  stop after an authentication rejection disables the provider.
- Keeping a local contact after a remote deletion detaches the vanished Wavelog
  identity in both conflict-resolution paths, preventing the same conflict from
  recurring forever or targeting the deleted remote record.
- Restoring without settings is rejected before replacement when the retained
  Wavelog destination is incompatible with the backup's remote mappings; a
  rejected restore preserves the live contacts and workspace generation.
- Club Log credential changes participate in the delivery ownership fence, so
  an in-flight batch cannot continue with retired credentials.
- Main and detached Settings use separate recovery journals. A successful write
  in one window cannot erase an unknown outcome retained by the other.
- Genuine draft/contact/settings/layout conflicts and unknown outcomes keep the
  main recovery controls visible in Separate Windows mode, while ordinary
  radio-follow autosaves keep the saved presentation stable. Native presentation
  requests are ordered so an older delayed hide cannot override a later recovery
  show.
- Dataset versions continue to accept only explicit dataset/reference headers or
  validated payload metadata; generic server/proxy `X-Version` and `X-Revision`
  headers remain intentionally ignored.

## Verification

- Frontend: **2,409/2,409 tests across 163 files**.
- Native Swift: **217/217 tests across 29 suites**, with warnings as errors.
- Portable Swift: XStation **17/17**, XLogPrototype **209** with four explicit
  skips, XCluster **56/56**, and Swift Testing **405/405 across 54 suites**, with
  warnings as errors.
- TypeScript, production Vite build, detached-window bundle inventory and Rust
  `cargo check --locked` pass. The existing Vite large-chunk advisory remains a
  performance follow-up rather than a build failure.
- The exact-source uninstalled macOS bundle passes strict deep signature
  verification. Embedded distribution metadata reports
  `bd38acec940cf5af58499e87cc47cf210ceaf8d8`.
- Host binary: arm64, SHA-256
  `4ccbde012a175a7c1b2d5e6e79a2b18f0ee757b33082f03bf2427fc5c6a2f378`.
- Swift worker: universal x86_64/arm64, SHA-256
  `bb02116809358fad40cfeb7a1de0fe2459b13b8cea1182fe1a0631045241cb79`.
- Isolated native acceptance report
  `prototype/dist/review-bd38ace-native-acceptance.json` passes **33/33** with
  `status: passed`, `scope: integrated-local-ui`, `embeddedUi: true`,
  `worker: true` and `station_io: false`.
- The candidate process exited. The separately installed alpha.29 process remains
  `/Applications/OM0RX-xLog.app/Contents/MacOS/xlog-prototype`.

## Remaining gates

- Operator visual acceptance of the recovery behavior across real window sizes,
  multiple displays, mixed DPI and native focus changes.
- Installed acceptance after explicit operator approval.
- Live provider/account acceptance in disposable workspaces.
- A repeated real Windows Agent restart and separately authorized physical
  station/RF acceptance.
- Windows and Linux packaging remains deferred until the macOS candidate is
  accepted.
