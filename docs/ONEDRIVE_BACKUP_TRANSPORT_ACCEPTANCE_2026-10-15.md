# OneDrive backup transport acceptance — 15 October 2026

## Outcome

Exact source `3fa11ac6d5f6512d6d364ea74483eb7a56bf61e1` adds a native,
provider-specific Microsoft Graph v1.0 transport foundation for BACKUP-01. It
creates one conflict-failing upload session for the immutable backup name,
uploads sequential 10 MiB chunks, verifies the returned drive/item/parent/size
and content tags, independently downloads the item, computes xLog's own SHA-256,
and brackets that read with matching eTag/cTag metadata observations.

This is source and isolated-package acceptance, not a live Microsoft-account or
installed-app acceptance. No OAuth flow was started, no credential or Keychain
entry was changed, no Graph or OneDrive request was sent, and no operator log
was uploaded, downloaded or restored.

## Provider contract used

The implementation follows Microsoft's stable Graph v1.0 contract:

- [`GET /me/drive`](https://learn.microsoft.com/en-us/graph/api/drive-get?view=graph-rest-1.0)
  supplies the signed-in user's stable drive ID for account fencing.
- [`createUploadSession`](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0)
  supports `conflictBehavior: fail`, sequential fragments, sub-60-MiB requests
  and fragment sizes divisible by 320 KiB. xLog uses 10 MiB fragments.
- The [driveItem resource](https://learn.microsoft.com/en-us/graph/api/resources/driveitem?view=graph-rest-1.0)
  supplies the item ID, size, parent reference, eTag and content cTag checked by
  the transport.
- [`GET .../content`](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0)
  and the short-lived preauthenticated download URL provide the independent byte
  read. Bearer credentials are never forwarded to upload or download capability
  URLs.
- Graph's [hashes resource](https://learn.microsoft.com/en-us/graph/api/resources/hashes?view=graph-rest-1.0)
  does not support SHA-256 and does not guarantee every other hash across both
  personal and business OneDrive. xLog therefore computes and compares its own
  SHA-256 over the downloaded bytes.
- Conditional future retention can use DriveItem
  [`DELETE` with `If-Match`](https://learn.microsoft.com/en-us/graph/api/driveitem-delete?view=graph-rest-1.0),
  which fails with 412 when the observed tag is stale.

OneDrive version history can be finite and tenant-configurable, so this adapter
does not pretend that a revision is permanently pinned. Each backup is a unique
item that xLog never updates; its receipt retains the opaque item ID and eTag.
A changed tag before or after download fails closed. Retention-count
destinations remain rejected until the conditional delete owner is implemented.

## Security and replay boundary

- Bearer credentials are accepted only on the exact Microsoft Graph routes.
- Provider-returned upload/download capability URLs must be public HTTPS URLs,
  receive no Authorization header, reject redirects and are never persisted.
- Completed, conflicting and ambiguous attempts keep the existing durable
  no-replay behavior; a restart cannot silently create another object.
- Provider account, destination revision, workspace generation, package size and
  SHA-256, parent folder, item ID and eTag are independently fenced.

## Verification

- Native Swift: **214 tests in 28 suites**, including **8 focused OneDrive
  transport tests**, passed with warnings treated as errors.
- Portable Swift: XStation **17/17**, XLogPrototype **209** with four explicit
  skips, XCluster **56/56**, and Swift Testing **405/405 in 54 suites** passed;
  the focused OneDrive portable set is **3/3**.
- The exact-source uninstalled macOS bundle passed strict deep signature
  verification.
- Embedded distribution metadata reports
  `3fa11ac6d5f6512d6d364ea74483eb7a56bf61e1`.
- The host binary is arm64 with SHA-256
  `19253d9d74ecffd3605429dca670309e6bb63992238b7acefc4617778723570c`.
- The Swift worker is universal arm64/x86_64 with SHA-256
  `a705b9219c2747666532cbcd10d34576a2fb4f6a47499e0739e4920b39955e5e`.
- Isolated native acceptance passed **33/33** with `scope:
  integrated-local-ui`, `embeddedUi: true`, `worker: true` and `station_io:
  false`. The candidate process exited after the run.

## Remaining gates

- Trusted native Microsoft OAuth callback, refresh and vault ownership.
- Native OneDrive presentation and explicit operator authorization.
- eTag-conditional retention deletion.
- Live authenticated personal and business OneDrive upload, lost-ack recovery,
  stable download and disposable-workspace restore evidence.
- Installed macOS acceptance after operator approval.
- Independent FTP-family transports. Plain FTP must remain an explicit insecure
  opt-in; FTPS and SFTP are separate protocols.
