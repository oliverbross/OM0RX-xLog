# Google Drive backup transport acceptance — 15 October 2026

## Outcome

Exact source `473c5ac1581452d939193ae1ae8ff09d63293871` adds a native,
provider-specific Google Drive v3 transport foundation for BACKUP-01. It can
reserve one exact Drive file ID, upload one frozen backup envelope, verify the
returned immutable identity and checksum, download the exact pinned head
revision independently, and restore only the receipt-pinned revision after
rechecking its byte count and SHA-256.

This is source and isolated-package acceptance, not a live Google-account or
installed-app acceptance. No OAuth flow was started, no credential or Keychain
entry was changed, no provider request was sent, and no operator log was
uploaded, downloaded or restored.

## Provider contract used

The implementation is based on Google's current Drive v3 contract:

- [`files.generateIds`](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/generateIds)
  pre-generates the exact object ID used for idempotent create attempts.
- [`files.create`](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/create)
  performs the multipart upload with `keepRevisionForever=true` and the exact
  configured parent.
- The [file resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)
  supplies the ID, size, SHA-256 checksum, head revision, parents, capabilities
  and app-owned properties checked before a receipt is accepted.
- [`revisions.get`](https://developers.google.com/workspace/drive/api/reference/rest/v3/revisions/get)
  with `alt=media` downloads the exact receipt-pinned revision rather than the
  mutable current filename.
- [`about.get`](https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get)
  supplies the stable account permission ID used to fence the transport to the
  reviewed account.

The transport does not infer identity from listing order or a mutable filename.
Its durable coordinator preserves the existing non-replay rule after a
completed or ambiguous attempt. Retention-count destinations fail closed because
revision-conditional Google Drive deletion has not yet been implemented.

## Verification

- Native Swift: **206 tests in 27 suites**, including **8 focused Google Drive
  transport tests**, passed with warnings treated as errors.
- Portable Swift: XStation **17/17**, XLogPrototype **209** with four explicit
  skips, XCluster **56/56**, and Swift Testing **402/402 in 53 suites** passed;
  the focused Google Drive portable set is **3/3**.
- The exact-source uninstalled macOS bundle passed strict deep signature
  verification.
- Embedded distribution metadata reports
  `473c5ac1581452d939193ae1ae8ff09d63293871`.
- The host binary is arm64 with SHA-256
  `2ce7a44d63860a3c9cfb76deac33bd8b57135a3ce82d1798823dcb829bfcfab6`.
- The Swift worker is universal arm64/x86_64 with SHA-256
  `328714b8d3ed011ac770f874ef6212ae0dbdc642d9be0d400787d65f870698ba`.
- Isolated native acceptance passed **33/33** with `scope:
  integrated-local-ui`, `embeddedUi: true`, `worker: true` and `station_io:
  false`. The candidate process exited after the run.

## Remaining gates

- Trusted native Google OAuth callback, refresh and vault ownership.
- Native presentation and explicit operator authorization for Google Drive.
- Provider-safe conditional retention deletion.
- Live authenticated upload, lost-ack recovery, exact-revision download and
  disposable-workspace restore evidence.
- Installed macOS acceptance after operator approval.
- Independent OneDrive and FTP-family transports. Plain FTP must remain an
  explicit insecure opt-in; FTPS and SFTP are separate protocols.
