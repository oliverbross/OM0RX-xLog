# DXpedition Map acceptance record

Status for the independent `codex/dxpedition-map` source branch. A packaged/installed application is deliberately not produced from this worktree; canonical-main provenance and release evidence must be recorded after integration.

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
