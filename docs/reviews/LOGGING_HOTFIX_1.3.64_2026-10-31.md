# macOS logging hotfix 1.3.64 — 31 October 2026

Application source before the version-only release change:
`8eeb0a7deece02b659342f5bc271ec657ab39cab` on canonical `main`.

## Changes

- `fb6c6fd5`: retain a leading `MM` Scottish operating prefix in
  `MM/LY3X/P`; retain ordinary trailing `/MM` suffix behavior. The existing
  enrichment guard now keeps Scotland's DXCC, zones and approximate position
  while using the Lithuanian home profile only for operator details.
- `01633283`: acknowledge durable local saves without waiting for the online-log
  delivery actor. Coalesce delivery scheduling and retire it on shutdown.
  Read the workspace QSO count without recomputing all statistics, and show
  immediate Saving QSO feedback until the verified receipt arrives.
- `8eeb0a7d`: background saved-layout reconciliation leaves visible or minimized
  windows alone and never requests foreground focus. Explicit window/menu/Dock
  presentation retains its existing activation path.

## Source verification

- 184 frontend tests passed across main/detached logging, draft receipts and
  workspace mode; delayed-save feedback is covered with a held receipt.
- Production TypeScript/Vite build and detached-window bundle gates passed.
- 141 native workspace tests passed against the final native change.
- 23 XCTest checks and 39 Swift Testing checks passed across callsign enrichment,
  runtime profiles, local logbook methods, durable drafts, online delivery and
  shutdown. The occupied online credential actor regression acknowledges the
  local save before releasing that actor.
- Eight CTY authority tests passed, including leading Scottish `MM`, trailing
  `/MM`, ordinary portable prefixes, exact exceptions and date rules.

## Build provenance and acceptance boundary

Build only from this clean canonical checkout with
`bash prototype/scripts/package-macos.sh`. The script resolves the exact
post-version commit into `XLOG_SOURCE_COMMIT`; `build.rs` verifies it against
HEAD and embeds it. `Contents/Resources/DistributionMetadata/components.json`
also records the exact source commit. Notarize the resulting bundle with
`prototype/scripts/notarize-macos.sh` without rebuilding it.

Packaged and installed source:
`01e45e7db30447e8949e3796747ce48e064977b9` (the version/provenance commit).
Developer ID signing, strict signature verification, Apple notarization,
stapling and Gatekeeper assessment passed for the candidate and installed app.
This accepts the bounded current-Mac hotfix; all-platform and hardware/quality
qualification remain separate.

Baseline timing evidence is private under `.build/logging-fixes-20261031/`.
A read-only SQLite backup contained 69,550 live QSOs; no test QSO was written
to production. The old worker's steady-state save → workspace status → first
logbook page took 176–433 ms in that isolated test. It excludes real providers
and GUI rendering; its timings do not reproduce the operator's full delay.

## Packaged and installed acceptance

- Installed at `/Applications/OM0RX-xLog.app`, version **1.3.64**. The installed
  app and matching child worker were positively verified at their exact paths
  with normal production launch arguments. The application remains running on
  Operator Desk with the original logbook and station settings.
- Apple submission `6c53e690-a69f-4c1f-b44f-7c0ac257c72f` was **Accepted**.
  Stapler validation and `spctl --assess --type execute` passed, with
  `source=Notarized Developer ID`, including after installation.
- Final archive: `dist/OM0RX-xLog-1.3.64-macOS-arm64.zip`.
  SHA-256: `f61b3671d1932a6d494340781fb4828cf05e6dbd0c030e0952b609600d57fe7a`.
- Installed executable SHA-256:
  `098f3332e29df133d0115ae7d998a15281a3e2e675b012418a2e8bb31af26473`.
  Installed worker SHA-256:
  `04ebe37a04afc3d21679b6c29dd8d57f74f1319c5aa3054d123bcdc5a6639450`.
  These match the canonical candidate; its embedded source receipt and
  DistributionMetadata identify the exact clean source commit above.
- The bundled CW offline payload verifier also passed. RF hardware and decode
  quality acceptance were not part of this logging hotfix.

### Native behavior

The disposable operating module was validated as `normal_logging`. Both live
app and worker PIDs, executable paths and complete matching
`--offline-contest-acceptance=<private-root>` arguments were checked before UI
binding. The main window displayed its unique WebKit-store marker before input.
External services and station I/O were disabled in this fixture.

A marked contact was saved through the native form. **QSO logged** appeared, the
entry cleared, and exactly one `NATIVE-1.3.64-TEST` contact appeared in the native
logbook. The private dataset contained 69,558 contacts: its 69,552-contact
snapshot, five worker benchmark contacts, and the single native test contact.
Ordinary Quit was followed by process-only confirmation that all bundled
candidate processes had stopped; no post-Quit app binding was used.

While another application was foreground, eight process-only samples across
18.6 seconds recorded **zero** foreground activations by the candidate. Both
isolated process coordinates remained valid throughout. This is a bounded
background-refresh check, not an extended desktop soak.

After installation, the independent Settings → Callsign lookup test returned:
**QRZ matched MM/LY3X/P · SCOTLAND.** This exercised the real provider through
the corrected shared lookup without editing or logging a production QSO.
The app was returned to Operator Desk afterward.

### Timing and preservation

Five warm private worker samples measured save → workspace status → first
logbook page:

| Candidate | Snapshot contacts | Range | Median |
| --- | ---: | ---: | ---: |
| Installed 1.3.63 baseline | 69,550 | 176–433 ms | 279.65 ms |
| Signed 1.3.64 candidate | 69,552 | 80–247 ms | 144.26 ms |

These are descriptive worker/first-page measurements under uncontrolled host
load. Provider/WAN waits and GUI rendering were excluded. Cold fixture opening
was noisy (approximately 32–63 seconds) during the build; startup improvement
is not claimed. The blocked online-credential actor test separately proves that
a local save receipt does not wait for that actor to be released.

The operator continued logging during the build. The final pre-install backup
therefore contains **69,553** live QSOs. Its database was verified byte-for-byte
identical to production before the first updated launch; the reopened native
logbook also displayed 69,553 contacts. Production contained zero benchmark
markers and zero native test markers. No production test QSO was created.

- Data, preferences, native session state and WebKit backup:
  `/Users/oliver/Documents/Backups/OM0RX-xLog/Logging-hotfix-1.3.64-before-install-20261031T200901+0930`.
- Pre-launch database SHA-256:
  `6bcd37b967a3c5cb80865f70c84859a8424224bb58c6c545554047b3e9efe46b`.
- Recoverable previous 1.3.63 app:
  `/Applications/OM0RX-xLog-previous-20261031T110511Z-73592.app`.
  Its executable hash matches the original backup manifest.

Private local evidence is retained under `.build/logging-fixes-20261031/`,
including source/signature receipts, timing JSON, process coordinates, focus
samples, backup manifest, marker counts and installed provenance. Tool transport
timeouts were resolved through these saved receipts and direct verification.
