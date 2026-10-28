# DXpedition Map acceptance record

Current repair evidence: [28 October 2026 parity repair acceptance](REPAIR_ACCEPTANCE_2026-10-28.md). It supersedes the older missing-enrichment/location/history statements below; packaged and physical-radio gates remain explicitly separate.

The historical gates below describe archived feature source `ef32793f` from the
independent `codex/dxpedition-map` branch. They are not test results for the current
canonical integration. No packaged/installed acceptance is inferred from that
branch. The current integration record follows at the end.

## Source gates

- TypeScript/Vite production build and detached-window bundle/CSS graph checks: pass.
- Focused DX Map model/component/style suite: 13 tests pass; the shared Map/MapSpot regression set brings the focused frontend pass to 46 tests.
- `OpportunityFeedTests`, including ADXO aliases/QSL/UTC date bounds and a valid empty out-of-horizon catalogue: 6 tests pass.
- Portable opportunity owner (11 tests), including the two-provider DX refresh boundary, and bounded-download (5 tests) suites: pass.
- Full native Swift suite: 311 tests pass.
- Full portable Swift suite: pass. One TCI websocket timing case failed while native and portable SwiftPM runs competed for the same build directory; that exact case and the complete portable suite then passed sequentially.
- Full native Rust suite: 852 tests pass.
- Full sharded frontend suite after rebasing onto Not1mm source head `0d3209e4`: 283 files / 4,156 tests pass.
- Rendered browser QA at 1440×900 and 480×800: full-width root layout, visible source/filter controls, readable empty/error states, and complete EN/IT surface navigation verified; browser mode cannot establish native-service behaviour.

## Master-plan acceptance mapping

| Criteria | Source/fixture state | Remaining external gate |
|---|---|---|
| AC-01–14, 45–48 | Typed/bounded catalogue, UTC dates, exact aliases, source health, status/filter/search, cache/single-flight owners, safe URLs and retained identities implemented. | Live-provider parity and sleep/resume session. |
| AC-15–23 | Singleton detached window, passive selection, independent map persistence, details, positions, observations and external links implemented. | Multi-display/DPI and assistive-technology run. |
| AC-24–39, 44, 47 | Pre-filter cluster projection, shared native tokens, exact-Hz explicit actions, draft-only fallback, selected-radio fences, Direct TCI path, no QSO save, and lifecycle cleanup implemented. | Integrated packaged run plus physical Flex/Hamlib/Agent/TCI evidence where applicable. |
| AC-40 | English/Italian, rendered narrow layout, native keyboard controls, detail focus entry/Escape restoration, non-colour text status, reduced motion. | Native-window assistive-technology and multi-display/DPI run. |
| AC-41 | ADXO/425DXN routes and truthful per-source health implemented. | Representative production-provider comparison; fixture success is not full parity. |
| AC-42 | Branch source and diff can be recorded at handoff. | Canonical-main version/build/install provenance after integration. |
| AC-43 | Catalogue and observations are capped at 500; detail retains 15 and renders 8. | Measured realistic worst-case/long-session performance. |

No claim is made here for live RF tuning, physical receiver selection/readback, external-account results, packaged installation, notarization, or continuing provider availability.

## Canonical integration — 25 October 2026, in progress

Integrated onto canonical `main` baseline `ea7b1c41c72e1ecdccceea22befe136a49aaf91c`
by restoring feature-specific files and porting shared changes individually.
Newer Contest Analytics, logging, map and native station ownership are preserved;
archived versions of shared files were not substituted wholesale.

Frontend integration checks:

- TypeScript passes.
- DXpedition model, surface, CSS, shared Map/MapSpots and workspace status tests:
  97 passed, including native/frontend registry equality, immediate cached data
  during a held refresh, focus-read/refresh coexistence and stale-read rejection.
  Evidence: `/tmp/xlog-dxmap-integration-tests.log`.
- Vite build passes. Production bundle checks pass with a measured Logbook graph
  of 402,807 bytes, including 337 bytes of additional lazy-route metadata. Its
  bounded allowance is 402,950 bytes. Ordinary window graphs explicitly exclude
  the DXpedition Map UI; this surface retains its independent MapLibre entry.
- `/tmp/xlog-dxmap-tsc.log`, `/tmp/xlog-dxmap-build.log` and
  `/tmp/xlog-dxmap-bundle-gates.log` distinguish compilation, initial measured
  budget adjustment and the final successful graph checks.
- After the cache/refresh race fix, the combined TypeScript, Vite and graph gate
  rerun passed: `/tmp/xlog-dxmap-build-final.log`.

Native registry/admission and pre-filter cluster token projection are integrated.
Catalogue tokens are retained in separate bounded ordinary/DX projection pools;
one view's refresh cannot retire another view's identities. Duplicate/conflicting
cluster IDs fail closed while a valid visible/prefilter overlap shares one token.
Catalogue reads/refreshes have non-retiring worker timeouts; slow public feeds do
not terminate the logging/station process. All 847 native Rust tests passed,
including token-pool isolation and actual late-reply timeout routing regressions
(`/tmp/xlog-dxmap-native-tests.log`, exit status zero).
The Swift integration reviewer reports eight parser and sixteen projection/download
tests passed. An additional held-feed LiveWorker regression passed (archive
`0e7066098aead5d7`): while ADXO's response was held, a logbook stats request completed
through the same worker before release, with zero disposable QSOs unchanged.
Final combined test evidence, canonical
version/source provenance and installed native menu/provider/radio acceptance
must be recorded separately. No production data, app installation or radio action
was performed by this frontend integration.

## Canonical Swift and provider checks — 1.3.14 candidate

Checks on 25 October 2026 used the canonical working integration. Fixture state
remained disposable; no production worker, production-state change, packaging
or installation was involved.
The final release commit and installed 1.3.14 provenance remain separate gates.

- `swift test --filter OpportunityFeedTests`: 8 passed. Coverage includes ADXO
  aliases/QSL, valid empty catalogues, malformed months, reversed/invalid dates
  and UTC year-boundary inference. Evidence archive: `c89f723e7b1fa29d`.
- `XLOG_PORTABLE_ONLY=1 swift test --filter
  'LiveOpportunitiesMethodsTests|OpportunityDownloadTests'`: 16 passed.
  Coverage includes the two-provider refresh boundary, exact-alias enrichment,
  primary announced callsign preservation, exclusion of unrelated cluster
  programme rows and the real worker DX snapshot route.
  Evidence archive: `9b10b6c88b6d8639`.
- `DXpeditionConcurrencyTests`: passed. A fixture URLProtocol holds an ADXO
  response body open while the same real `LiveWorker` successfully answers
  `logbook_stats`, before the feed is released. The disposable log remains empty.
  This proves worker request concurrency without contacting a publisher or radio.
  Evidence archive: `0e7066098aead5d7`.
- The actual downloaded provider responses were parsed in a temporary diagnostic
  harness at **2026-10-24 23:24:31 UTC** (25 October in Darwin): ADXO, 22,918 bytes,
  produced 43 DXpeditions; 425DXN, 5,493 bytes, produced 70 calendar rows, including
  37 DXpeditions and 33 special events. All parsed rows were unexpired at that
  instant. DXpedition IDs were unique and their maximum UTF-8 lengths were 24
  and 87 bytes respectively, within native admission's 128-byte bound.
  Evidence archives: `0e7066098aead5d7`, `c7cd04d6fb611221`. The temporary harness
  was removed; these counts describe those downloaded responses and time only.

Independent integration review identified an initial cached-snapshot/refresh
sequencing race in the frontend. Independent read/refresh sequencing now preserves
cached display during network refresh; the 97-test frontend run above includes
the correction's deferred-response regressions. No additional native integration blocker was identified
in the reviewed admission, identity-pool and explicit-activation changes.
