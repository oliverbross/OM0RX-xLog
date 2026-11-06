# Contact-page cancellation correction — 6 November 2026

**Development correctness verified; packaged desktop qualification remains pending.** Source fix commit: `f53ab0ed27444d9280485489b70c1656713ee625`, integrated and pushed with matching reviewed file hashes. The reviewed change is based on `ff8a8e388658fe7e822f3ecb3a5b7e13f5db9cee`.

## Reproduction and corrected behavior

A generated 100k worker diagnostic followed the Desk's logical loading pattern: one 20-row page, then four 20-row pages requested together. The signed 1.5.22 baseline failed all 9 nonempty trials with `logbook_refresh_superseded`, despite successful sequential reads. The corrected development worker passed all 9. Each failed baseline trial contained three rejected pages; there were 27 rejected page replies overall. ([Evidence JSON](logbook-page-cancellation-2026-11-06.json), runtimeComparison.)

| Query case | Matching QSOs | Signed baseline trials passed | Corrected development trials passed |
| --- | ---: | ---: | ---: |
| Unfiltered | 100,000 | 0/3 | 3/3 |
| Quarter-population substring | 25,000 | 0/3 | 3/3 |
| Sparse substring | 2,754 | 0/3 | 3/3 |
| No match | 0 | 3/3 | 3/3 |

The no-match case has only an empty first page and does not exercise concurrent pagination. Including it, the development result passed 12/12 framed trials and 8/8 repeated-identical-page controls. All 16 sequential page controls across four query cases matched the signed reference's totals, ordered IDs and full-page hashes. All 76 development request/response pairs were correlated and successful.

## Source change and boundaries

The actor change is 24 lines: 22 additions and 2 deletions in `Sources/XLogPrototypeSupport/LiveLogbookAggregateReads.swift`. Contact requests may wait without cancelling the active request when only offset/limit differ. Distinct pages keep their full result/cache identities; identical pages may still share identical work. All other request fields, including predicates and frozen time, and epoch/database/workspace generation/file identity/revision must match.

Post-await validation, one active operation per kind, cancellation for changed predicates or authority, retirement/termination fences, and the existing bounded retry budget remain. A nil-default internal test observer establishes deterministic waiting; shipping callers do not install it. SQL, count caching, frontend behavior, public protocol and runtime-profile guards are unchanged. ([Evidence JSON](logbook-page-cancellation-2026-11-06.json), sourceChange.)

## Verification and retained failures

The targeted regression first failed with the original cancellation rule: one test, five failed assertions, including the three superseded page replies. The first corrected run passed 32/33 tests: 12/12 low-level reader tests and 20/21 actor tests. Its sole failure was a new terminal-waiter expectation; the existing owner returns retirement for that distinct waiter, while active/future requests report shutdown. Only the expectation changed. The final actor suite passed 21/21. The portable-only development worker build also passed. All failed logs are retained. ([Evidence JSON](logbook-page-cancellation-2026-11-06.json), validationHistory.)

A separate raw Debug-worker attempt correctly refused offline mode before workspace creation because adjacent runtime-profile metadata was absent. Its failure and no-survivor receipt remain recorded. The subsequent supported worker-only fixture uses the byte-identical worker, minimal integration metadata, and both real resource bundles, 15 + 17 files. The binding follows the existing runtime-profile tests; the copy layout follows the existing worker acceptance script. No profile guard was relaxed, and this fixture is not an application/distribution candidate.

## Data and process preservation

Both signed and corrected runs retained exactly 100,000 physical/live/generated-marked QSOs. The source fixture and each private copy before/after the workload have the same ordered, type-tagged hash across all 12 stored columns:

`c890ab242dca96dd196217168a1f05dcc299b1ba6a2e877149abbddeaea59af2`

The original 171,393,024-byte main database and its zero-byte WAL retained their exact hashes. Each run's two private workers exited normally after EOF with exit code 0; final receipts recorded no owned/root process survivors. Both development health replies reported station I/O, credential access, live cluster and network contact false. No production log was used. ([Evidence JSON](logbook-page-cancellation-2026-11-06.json), preservation.)

## Qualification limits and next work

This is a worker-level correctness result using generated data and a portable-only development build. It bypasses Tauri/WebView and ordinary GUI loading. The harness flushes concurrent requests together; the frontend issues independent invocations. Warm controls, hashing, logging overhead and differing build configurations prevent a speedup claim. No CPU/memory improvement, zero internal retry/rework, SQL statement-count reduction, signed-package acceptance or full-desktop qualification is established.

Count-cache optimisation remains pending. The full memory/focus/idle-budget interval is deferred until a paging-corrected packaged candidate can load normally. The historical approximately 7 GB report and broader equipment/platform release gates remain outside this result.

## Source integration and completed original-source gates

The frozen 1.5.25 package remains `ff8a8e388658fe7e822f3ecb3a5b7e13f5db9cee` and excludes this correction. The source integration receipt records clean, pushed `f53ab0ed27444d9280485489b70c1656713ee625`; it does not qualify existing package bytes.

| Gate at exact f53 source | Run | Final result |
| --- | --- | --- |
| CI | [42293138403](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42293138403) | PASS |
| Full macOS beta | [42293138087](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42293138087) | FAIL at complete portable Swift core |
| Filtered three-platform native | [42293280745](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42293280745) | PASS: macOS 33/33, Linux 33/33, Windows 31/31 |

The Windows count differs because two existing Unix-only tests are excluded. The full Mac job `128151448660` reported 628 Swift Testing tests / one issue at `ADIFTransferTests.swift:279:6`: selected-DXCC validation, argument `+291`, uncaught description `invalid`. Its log did not capture the concrete throwing statement/type or historical input timestamp. The ADIF paths were unchanged between ff8 and f53 and use synchronous `LiveLogbookMethods`, so this record does not attribute the failure to paging.

The original failed run is retained. The separate [ADIF fractional-second correction](adif-fractional-second-2026-11-07.md), integrated at `e7fce13b093ccaa8b9c0a6e343aea3d162987f04`, has its own source checks. Its deterministic reproduction does not reconstruct the missing historical timestamp. No corrected signed-desktop acceptance or memory budget follows from these source results.

## Receipt anchors

- Signed baseline result SHA-256: e2856caa5adcc4d74265fbe1a4f4813422e98d920734d73057d0f4514432b302
- Corrected development result SHA-256: c6d7388fbd849a9dabec7aa5bb18e2b9a2d0700e464e2b95ae6bb387f9f84c0a
- Corrected traffic SHA-256: 52f87ecc17a0ede7ea22c531b015fccc89143a8a3b539be14abeeb01dd930414
- Reviewed source/test patch SHA-256: 85d7efa2a8c6802943d2cfe49e56b103eddbc2a998a66c4e201a0671738883f5

The companion JSON records every retained evidence path/hash, exact source/build/layout pins, failed-attempt history and preservation fields. It excludes user paths, process identities, QSO contents and raw traffic.
