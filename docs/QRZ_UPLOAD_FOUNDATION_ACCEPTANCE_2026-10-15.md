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
- Settings can save that separate key and reports only whether it is present.
  The field is masked, clears after a confirmed save, and explicitly states that
  saving the credential does not enable uploads.
- The database now has a default-off, prospective enrollment journal. Enabling
  it never scans existing contacts. Only a genuinely new QSO saved through an
  explicitly eligible logging path joins the candidate list; ordinary imports,
  Wavelog pulls, confirmation refreshes, edits, deletes and restores do not.
  Enrollment state, the new-QSO insert and candidate registration share a SQLite
  write transaction across app connections. Disabling cancels unsent membership;
  re-enabling starts a fresh boundary and never backfills the disabled interval.
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

- Focused online-delivery/enrollment suite: **9/9 tests pass**, covering exact request
  fields/no replace, form encoding, durable delivered no-replay, ambiguous
  no-replay, explicit bounded rate-limit retry, stale edited-contact rejection
  and interrupted-dispatch recovery, prospective-only enrollment, disable/re-enable,
  deletion cancellation and atomic operator-draft Save capture.
- Settings credential coverage: **18/18 focused tests pass**; the complete
  frontend suite passes **2,388 tests across 159 files** and the production
  TypeScript/Vite/detached-window bundle gate passes.
- Native Swift: **186 tests across 26 suites pass**.
- Portable Swift: **200 XCTest tests pass** with four intentional benchmark
  skips, plus **387 Swift Testing tests across 51 suites**.
- Portable source compilation and `git diff --check` pass.

All network behavior above is fixture-backed. No provider credential was read or
written and no live QRZ request was made.

## Explicitly open before operator use

1. Add the default-off upload enrollment control, Keychain deletion, and clear
   health/receipt status. Credential provisioning alone is not enrollment.
2. Expose the tested prospective enrollment through a clear confirmation UI.
   **New contacts from now on** remains the only implemented scope; any existing-log
   backfill would require a separate design and reviewed operator action. Nothing
   can silently upload the current 68k-contact log.
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
