# Remote backup frozen-plan source acceptance — 15 October 2026

## Outcome

Commit `8ddab69` closes the one-shot preparation drift in BACKUP-01. The native
presentation owner now retains the validated immutable `XLogBackupEnvelope` that
created the reviewed plan. Approve and Start therefore refer to one exact backup
ID, SHA-256 identity, byte count and byte sequence. The executor no longer replaces
that reviewed plan with a newly captured package.

This is source acceptance only. Production provisioning remains unavailable, the
installed alpha.29 does not contain this change, and no Dropbox account, credential,
provider request, upload, retention deletion or restore was used.

## Safety properties

- Renderer input still cannot provide a plan, account proof, package identity,
  package bytes, credential or vault identity.
- Native preparation rejects an envelope that does not match its plan before an
  offer becomes reviewable.
- The due boundary rechecks the durable account registration, workspace generation,
  destination and authorization before returning the retained bytes.
- Prepared one-shot mode claims the exact reviewed plan rather than issuing a fresh
  backup ID.
- Prepared mode rejects recurring consent before enabling a schedule. Existing
  recurring execution keeps the separate fresh-snapshot-per-interval path.
- Stop, cancellation, workspace rotation, account replacement and consent revocation
  keep their existing fail-closed behavior.

## Verification

- `swift test`: **173 tests across 25 suites passed**.
- `XLOG_PORTABLE_ONLY=1 swift test --scratch-path .build/backup-stage`:
  **200 XCTest tests passed** with four intentional benchmark skips, plus
  **379 Swift Testing tests across 51 suites passed**.
- Focused native owner suite: **12/12 passed**.
- Focused live remote-backup service suite: **21/21 passed**, including exact
  approved backup ID/bytes and recurring rejection.
- Remote Backup and Settings frontend suites: **22/22 passed**.
- TypeScript, Vite production build and detached-window bundle checks passed.
- `git diff --check` passed.

## Remaining dependency gates

1. Add a trusted production-native Dropbox provisioning flow and credential write
   path; do not accept account proofs or secrets from renderer state.
2. Verify the authenticated account ID against Dropbox and install the production
   presentation environment only after that authority exists.
3. Exercise an explicitly authorized live upload and independent download/hash
   receipt before calling provider capability accepted.
4. Add separately confirmed, revision-conditional retention deletion and restore
   acceptance. Google Drive, OneDrive and FTP-family transports remain later
   provider-specific work rather than aliases for Dropbox behavior.
