# DXpedition Map acceptance record

Status for the independent `codex/dxpedition-map` source branch. A packaged/installed application is deliberately not produced from this worktree; canonical-main provenance and release evidence must be recorded after integration.

## Source gates

- TypeScript/Vite production build and detached-window bundle/CSS graph checks: pass.
- Focused DX Map model/component suite: 7 tests pass.
- `OpportunityFeedTests`, including ADXO aliases/QSL/UTC date bounds: pass.
- Portable opportunity owner (10 tests) and bounded-download (5 tests) suites: pass.
- Full portable Swift suite: pass.
- Full native Rust suite: 852 tests pass.
- First sharded full frontend run: 281 files / 4,134 tests pass; one exact supported-window registry assertion failed, was corrected, and its 55 focused window/DX-map tests pass. A final post-rebase frontend rerun remains required before handoff.

## Master-plan acceptance mapping

| Criteria | Source/fixture state | Remaining external gate |
|---|---|---|
| AC-01–14, 45–48 | Typed/bounded catalogue, UTC dates, exact aliases, source health, status/filter/search, cache/single-flight owners, safe URLs and retained identities implemented. | Live-provider parity and sleep/resume session. |
| AC-15–23 | Singleton detached window, passive selection, independent map persistence, details, positions, observations and external links implemented. | Multi-display/DPI and assistive-technology run. |
| AC-24–39, 44, 47 | Pre-filter cluster projection, shared native tokens, exact-Hz explicit actions, draft-only fallback, selected-radio fences, Direct TCI path, no QSO save, and lifecycle cleanup implemented. | Integrated packaged run plus physical Flex/Hamlib/Agent/TCI evidence where applicable. |
| AC-40 | English/Italian, narrow responsive CSS, native keyboard controls, non-colour text status, reduced motion. | Human narrow-window/focus review. |
| AC-41 | ADXO/425DXN routes and truthful per-source health implemented. | Representative production-provider comparison; fixture success is not full parity. |
| AC-42 | Branch source and diff can be recorded at handoff. | Canonical-main version/build/install provenance after integration. |
| AC-43 | Catalogue and observations are capped at 500; detail retains 15 and renders 8. | Measured realistic worst-case/long-session performance. |

No claim is made here for live RF tuning, physical receiver selection/readback, external-account results, packaged installation, notarization, or continuing provider availability.
