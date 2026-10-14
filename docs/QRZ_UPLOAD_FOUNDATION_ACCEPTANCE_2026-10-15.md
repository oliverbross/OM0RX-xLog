# QRZ upload foundation source acceptance — 15 October 2026

This checkpoint implements the bounded, upload-only core required before an
operator can opt in to sending new contacts to QRZ. It does not enable the
feature, add settings controls, enroll an existing log, or contact QRZ.

## Implemented boundary

- Uses QRZ's documented HTTPS Logbook endpoint with one `ACTION=INSERT` and one
  headerless ADIF record per request. It never sends `OPTION=REPLACE`, deletion,
  fetch or status operations.
- Encodes the POST body with byte-accurate `application/x-www-form-urlencoded`
  rules. In particular, an ADIF `+` is preserved as `%2B` rather than being
  silently decoded as a space.
- Reserves a separate `qrz-logbook-key` Keychain/vault account. The upload key is
  not the existing QRZ XML lookup password and is never stored in preferences,
  SQLite receipts or error text.
- Freezes the exact local contact revision and SHA-256 payload, then commits a
  durable SQLite claim before network I/O. Concurrent claims cannot both send.
- Stores only bounded receipt state, attempt identity/count, timestamps, an
  optional numeric remote ID and a safe local error code.
- Treats transport failure, cancellation, malformed/oversized response,
  redirect and interrupted dispatch as uncertain. An uncertain claim is never
  replayed automatically.
- Retries only an explicit HTTP 429, at most three total attempts, with bounded
  30/60-second exponential floors and a one-hour maximum provider delay.
- Uses an ephemeral URL session with no cookies, cache or credential store,
  rejects redirects, requires the fixed QRZ endpoint, enforces TLS 1.2 or newer
  on Apple platforms and stops reading after 8 KiB.

The provider contract is documented at
[QRZ Logbook API](https://www.qrz.com/docs/logbook/QRZLogbookAPI.html). QRZ states
that API access is subscription-gated; source tests do not establish account
eligibility.

## Verification

- Focused online-delivery suite: **6/6 tests pass**, covering exact request
  fields/no replace, form encoding, durable delivered no-replay, ambiguous
  no-replay, explicit bounded rate-limit retry, stale edited-contact rejection
  and interrupted-dispatch recovery.
- Native Swift: **183 tests across 26 suites pass**.
- Portable Swift: **200 XCTest tests pass** with four intentional benchmark
  skips, plus **387 Swift Testing tests across 51 suites**.
- Portable source compilation and `git diff --check` pass.

All network behavior above is fixture-backed. No provider credential was read or
written and no live QRZ request was made.

## Explicitly open before operator use

1. Add a default-off settings surface with truthful **upload-only** wording,
   Keychain save/delete and clear health/receipt status.
2. Make initial enrollment explicit: **new contacts from now on** must be the
   safe default; any existing-log backfill requires a separately reviewed,
   bounded operator action. Enabling must never silently upload the current
   68k-contact log.
3. Wire the native background owner and recovery call without depending on a
   mounted renderer. Edits and confirmation updates require an explicit provider
   policy; this INSERT-only slice must not pretend to provide two-way sync.
4. Complete live acceptance with an operator-supplied QRZ Logbook API key and a
   deliberately selected test contact before release packaging.
5. Implement and accept Club Log and HRDLOG as independent adapters. Wavelog
   remains the richer two-way reconciliation service.

The Windows Remote Station Agent remained intentionally off. No radio,
amplifier, tuner, rotor, PTT, Tune or CW action was issued. Windows and Linux
builds remain deferred until the operator accepts a macOS candidate.
