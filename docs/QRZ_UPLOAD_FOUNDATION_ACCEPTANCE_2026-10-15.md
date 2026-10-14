# QRZ upload foundation source acceptance — 15 October 2026

This checkpoint implements the bounded, upload-only core and its explicit
operator enrollment surface. It remains disabled by default, never enrolls an
existing log, and did not contact QRZ during source acceptance.

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
- A native worker-owned serial loop runs without a mounted renderer. It reads the
  separate QRZ key only when enrollment is active and candidates exist, fences
  workspace replacement and shutdown, retains candidates only for bounded 429
  retries, and atomically retires delivered, rejected, or uncertain outcomes.
  Interrupted dispatch recovery marks the durable receipt uncertain and removes
  its candidate, so process restart cannot replay an ambiguous INSERT.
- Settings now exposes a separate, prospective-only enrollment control. Enabling
  requires a saved QRZ Logbook key and a second explicit acknowledgement that
  only new contacts saved from that point forward are enrolled. Disabling is
  immediate and cancels unsent candidates without backfilling when re-enabled.
- Removing the QRZ Logbook key disables enrollment before deleting the Keychain
  secret, so a failed or interrupted removal cannot leave uploads armed.
- Settings health is an aggregate local-only view: enabled state, pending count,
  per-state receipt counts and the latest safe state/time/error code. It never
  exposes a callsign, contact identity, ADIF payload or secret to the renderer.
- A semantically new contact received through the explicit, receive-only WSJT-X
  Logged ADIF integration joins prospective enrollment atomically with its local
  save. Duplicate WSJT-X packets remain suppressed. Generic ADI/ADX imports,
  Wavelog reconciliation and existing contacts remain excluded.
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

- Focused online-delivery/enrollment suite: **13/13 tests pass**, covering exact request
  fields/no replace, form encoding, durable delivered no-replay, ambiguous
  no-replay, explicit bounded rate-limit retry, stale edited-contact rejection
  and interrupted-dispatch recovery, prospective-only enrollment, disable/re-enable,
  deletion cancellation, candidate terminal/deferred lifecycle and atomic
  operator-draft Save capture. The native owner suite passes **4/4** tests,
  including aggregate-only status and disable-cancels-pending behavior.
- Settings credential and enrollment coverage: **20/20 focused tests pass**; the complete
  frontend suite passes **2,390 tests across 159 files** and the production
  TypeScript/Vite/detached-window bundle gate passes.
- Native Swift: **190 tests across 26 suites pass**.
- Portable Swift: **200 XCTest tests pass** with four intentional benchmark
  skips, plus **391 Swift Testing tests across 52 suites**.
- Rust: **433 unit tests and 18 integration tests pass**.
- Portable source compilation and `git diff --check` pass.

All network behavior above is fixture-backed. No provider credential was read or
written and no live QRZ request was made.

## Explicitly open before operator use

1. Complete live acceptance with an operator-supplied QRZ Logbook API key and a
   deliberately selected test contact before release packaging.
2. Add an explicit operator review/re-arm workflow for rejected or uncertain
   receipts if product policy requires it. Neither state replays automatically.
3. Implement and accept Club Log and HRDLOG as independent adapters. Wavelog
   remains the richer two-way reconciliation service.

**New contacts from now on** is the only implemented scope. Nothing can silently
upload the existing 68k-contact log. Edits and confirmation updates require an
explicit provider policy; this INSERT-only slice does not claim two-way sync.

The Windows Remote Station Agent remained intentionally off. No radio,
amplifier, tuner, rotor, PTT, Tune or CW action was issued. Windows and Linux
builds remain deferred until the operator accepts a macOS candidate.
