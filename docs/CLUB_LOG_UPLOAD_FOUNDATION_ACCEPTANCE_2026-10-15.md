# Club Log real-time upload source acceptance — 15 October 2026

This checkpoint adds Club Log as a second, independent upload-only provider. It
is disabled by default, never scans the existing log, and made no live Club Log
request during source acceptance.

## Implemented boundary

- Uses only `https://clublog.org/realtime.php` with one URL-encoded ADIF record
  per request. It never uses the batch `putlogs.php` endpoint for automatic
  delivery and never requests clear, replace, delete, download or status work.
- Requires four separately saved values: Club Log account email, Application
  Password, owned log callsign and Club Log API key. They remain in the
  workspace Keychain/vault and never enter Settings JSON, SQLite delivery
  receipts, renderer status or error text. The existing Club Log API key can
  also authorize CTY reference downloads; saving it never enables uploads.
- Adds an **Online logs** Settings section. QRZ and Club Log have independent
  default-off enrollment switches, explicit prospective-only confirmations,
  pending/result summaries and credential removal. Detached Settings exposes
  the same narrowly scoped methods.
- Only genuinely new manual contacts and accepted WSJT-X Logged ADIF contacts
  created after Club Log enrollment are candidates. Existing contacts, ordinary
  ADI/ADX imports, Wavelog pulls, confirmation refreshes, edits, deletes and
  restores are not backfilled.
- Reuses the durable exact-revision/SHA-256 claim and terminal no-replay model.
  A request is claimed in SQLite before I/O; delivery, rejection and uncertainty
  survive restart. An ambiguous transport result is never replayed automatically.
- Treats every known non-200 response as terminal. Receipt rejection, disabling
  Club Log enrollment and cancellation of every remaining Club Log candidate
  commit in one SQLite transaction. HTTP 403 receives the safe local code
  `authentication_rejected`; no provider body or credential is exposed.
- The transport uses a fixed HTTPS endpoint, an ephemeral no-cookie/no-cache
  session, no URL credential store, redirect rejection, a 30-second timeout and
  an 8 KiB response ceiling. QRZ enrollment and candidates remain unaffected by
  a Club Log refusal or disable action.

Club Log distinguishes the developer/product API key from a user Application
Password and warns that repeated bad real-time requests can trigger its firewall.
The implementation follows the official [API key guidance](https://clublog.freshdesk.com/support/solutions/articles/54910-api-keys),
[correct URL and HTTP 403 guidance](https://clublog.freshdesk.com/support/solutions/articles/3000118796-using-the-right-urls-for-club-log),
[blocked-IP guidance](https://clublog.freshdesk.com/support/solutions/articles/3000118794-help-club-log-is-blocking-my-ip-address),
and the official [batch-versus-real-time warning](https://clublog.freshdesk.com/support/solutions/articles/54905).

## Verification

- Online-log core coverage includes exact real-time form fields, byte-accurate
  ADIF encoding, no batch/clear field, provider-specific response URL validation,
  provider-isolated prospective queues and atomic HTTP-refusal shutdown.
- Native Swift suite: **194 tests across 26 suites pass**.
- Portable Swift: **200 XCTest tests pass** with four intentional benchmark
  skips, plus **392 Swift Testing tests across 52 suites**.
- Settings and detached Settings focused checks: **24/24 pass**; the complete
  frontend suite passes **2,391 tests across 159 files**, and the production
  TypeScript/Vite/detached-window bundle gate passes.
- Rust: **433 unit tests and 18 dummy-backend integration tests pass**.
- The ad-hoc macOS development bundle built from exact commit `6df0219` passes
  strict deep signature verification and a fresh **33/33** isolated native run
  with `embeddedUi: true`, `worker: true` and `station_io: false`. Evidence:
  [mac-source.json](evidence/native-ui-6df0219/mac-source.json). The arm64 host
  SHA-256 is `ac5de6224b48ecc7e43424661846b621329102ad7cf94cef5279691221b92301`;
  the universal worker SHA-256 is
  `841db845af6cbdf181655d123f388f0d10d7b8d7aecbc842eee2bf9d35464b25`.

All provider behavior is fixture-backed. No Club Log credential was read or
written and no live Club Log request was made. Live account acceptance remains
required before release use.

## Explicitly open

1. Complete a deliberately bounded live upload with an operator-supplied Club
   Log API key, account email, Application Password and owned callsign.
2. Verify the installed Settings layout and refusal/status wording at compact and
   wide sizes in the next signed/notarized macOS candidate.
3. Implement HRDLOG only after its current official upload contract and failure
   policy can be verified; do not infer that policy from third-party clients.

The Windows Remote Station Agent remained intentionally off. No radio,
amplifier, tuner, rotor, PTT, Tune or CW action was issued. Windows and Linux
builds remain deferred until the operator accepts a macOS candidate.
