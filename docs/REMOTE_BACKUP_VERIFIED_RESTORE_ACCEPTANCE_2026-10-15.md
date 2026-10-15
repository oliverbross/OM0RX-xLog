# Remote backup verified-restore source acceptance — 15 October 2026

## Outcome

Exact source `6888b74d034467f8eafb343f5ff41e6f4e28c1c5` completes the
Dropbox restore path at the source and isolated-package boundary. A verified
upload receipt can now authorize one exact revision-pinned download. The native
owner independently checks provider account, object ID, revision, filename,
byte count and SHA-256 before materializing a normal local `.xlogbackup`
package. Downloading never installs the database: the operator must inspect the
package under Local backups and use the existing explicit restore confirmation.

This is not live-provider or installed acceptance. No Dropbox credential,
account mutation, network request, Keychain mutation or operator database was
used. The installed alpha.29 remains unchanged.

## Safety and recovery properties

- Restore download requires a persisted, verified app-owned upload receipt and
  the currently registered Dropbox account.
- Dropbox retrieval is pinned to the exact recorded revision rather than the
  mutable path or a directory listing.
- Provider metadata must match the pinned object ID, revision, filename and
  byte count; the downloaded bytes must independently match the stored SHA-256.
- Workspace, destination, account, registration, authorization, generation and
  backup-owner state are checked before and after network access and while
  staging the package.
- Renderer input cannot provide provider identity, credentials, package bytes,
  hashes or vault identity.
- A lost acknowledgement or crash can retry the deterministic staging path.
  An existing package is accepted only when its complete envelope identity is
  identical; mismatched content is rejected.
- Staging does not replace the live database, change settings or bypass the
  existing explicit restore confirmation and generation rotation.

## Verification

- Native backup-envelope and Dropbox transport focus: **20 tests passed**.
- Portable backup/restore focus: **28 tests across three suites passed**,
  including create, verified revision-pinned download, local staging and the
  existing explicit restore returning the log to the staged snapshot.
- Remote Backup renderer focus: **6/6 passed**.
- Full native Swift: **198 tests across 26 suites passed** with warnings as
  errors.
- Full portable Swift: XStation **17/17**, XLogPrototype XCTest **209** with
  four intentional benchmark skips, XCluster **56/56**, and Swift Testing
  **399/399 across 52 suites**.
- Full frontend: **2,402/2,402 passed**; TypeScript, Vite production build and
  detached-window bundle checks passed.
- Rust/Tauri: **445 unit + 21 integration tests passed**.
- The ad-hoc macOS bundle embeds source
  `6888b74d034467f8eafb343f5ff41e6f4e28c1c5`, passes strict deep code-sign
  verification and isolated **33/33** integrated-local-UI acceptance with the
  embedded renderer, staged worker and `station_io: false`.
- Host SHA-256:
  `117d61701098109fd7eb0c66a794180aeda694558d4093be1d82462c8e2bc678`.
- Worker SHA-256:
  `18a8262be087fc27995ea8e4ad840af5d845231f8737694b6070f44eee82cc06`.

## Remaining dependency gates

1. Register the production Dropbox application and implement its trusted
   native OAuth callback/refresh authority.
2. With explicit authorization, prove live account registration, upload,
   revision-pinned download, local staging and an operator-selected restore in
   a disposable acceptance workspace.
3. Install and visually accept the production presentation only after the live
   provider boundary is proven.
4. Implement Google Drive, OneDrive and FTP-family adapters against their own
   identity, revision, authentication and conditional-write contracts; they
   must not be thin aliases for Dropbox behavior.

