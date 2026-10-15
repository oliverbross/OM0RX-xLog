# Reference source version/revision acceptance — 15 October 2026

## Outcome

Exact source `1794f8f0af2501a559669804699df4765ae1876f` completes the
source-version portion of DATA-09. Reference metadata now retains and displays a
provider's explicit version or revision when one is available. It does not
invent a version from an ETag, Last-Modified date, download date or generic
server/proxy version header.

The uninstalled macOS development bundle is accepted at the isolated package
boundary. Installed behavior and observation of a version from a configured
live source remain open.

## Metadata contract

- Dataset-specific `X-Reference-Version`, `X-Dataset-Version` and
  `X-Data-Version` response headers are accepted.
- A validated top-level JSON `version`, `revision`, `release`,
  `datasetVersion` or `dataVersion` is accepted for JSON sources.
- A `version`, `revision` or `release` attribute on the validated Club Log CTY
  root is accepted.
- Values are trimmed, limited to 80 printable ASCII bytes and rendered through
  React text content. Missing, malformed and overlong values remain **Not
  reported**.
- A successful 304 check preserves the version attached to the validated cached
  representation unless the source supplies a new dataset-specific version
  header. A successful replacement without explicit version metadata clears the
  prior value. Failed checks retain last-good evidence and remain visibly
  failed under the existing contract.
- Legacy state without the new optional field decodes without inventing a
  version.

Independent review found that initially accepted generic `X-Version` and
`X-Revision` headers could describe the API server or a proxy. Those headers
were removed before the source freeze, and a conflicting-header regression now
proves that an explicit Wavelog payload revision wins.

## Current-source observation

Read-only header and bounded-prefix inspection of the configured public POTA,
SOTA, IOTA and WWFF feeds on 15 October found freshness validators/dates but no
explicit dataset version. They therefore continue to report **Not reported**,
which is intentional. The current Wavelog API v2 catalog source at upstream
commit `7f8eef4de94c674f73c6859ed4e0b0247f68dcd9` likewise does not add a catalog
version to its documented response. No configured Wavelog endpoint or token was
used.

## Verification

- Focused ReferenceDataUpdater: **15/15** tests.
- Focused Data Management renderer: **10/10** tests.
- Native Swift: **196/196 across 26 suites**.
- Portable Swift: XStation **17/17**, XLogPrototype XCTest **209** with four
  intentional opt-in skips, XCluster **56/56**, and Swift Testing **396/396
  across 52 suites**.
- Frontend: **2,401/2,401 across 160 files**.
- Swift warnings-as-errors, TypeScript, production Vite/detached-window bundle
  checks and `git diff --check` pass. The existing large-chunk advisory remains.

## Isolated macOS package

- Bundle:
  `prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog.app`.
- Embedded source:
  `1794f8f0af2501a559669804699df4765ae1876f`.
- Strict deep signature verification passes.
- Host SHA-256:
  `8e6092bcf32ce2f14a91ea7d7f32a883aa450abfdfbba8cc485f1d066ff723d0`
  (arm64).
- Worker SHA-256:
  `b050593e14c02e8f19c47b5e844450a51440139bda98a1cf73eb5994b1368ee2`
  (universal x86_64 + arm64).
- `prototype/dist/reference-1794f8f-native-acceptance.json` passes **33/33**
  checks with `status: passed`, `scope: integrated-local-ui`, `embeddedUi:
  true`, `worker: true` and `station_io: false`.

The candidate exited after acceptance and was not installed. The Windows Remote
Station Agent remained off. No radio, amplifier, tuner, antenna, rotor, PTT,
Tune or CW action was issued, and no provider credential or operator logbook was
used. Windows/Linux packaging remains deferred until Mac operator acceptance.
