# Spot History

Mode: Operate. Precisely specified archive extension of the existing xLog cluster/table surface. Inherit DESIGN.md; no concept tournament, new visual identity or system-token change applies. Work is unattended and uses synthetic verification data only.

## Direction contract

THESIS: Search individually retained cluster reports without changing live grouping or operating the radio.

OWN-WORLD: Existing navy panels, compact system typography, neutral controls, teal callsigns and cyan frequency values. Dense table rows carry the information; compact text summaries carry archive state.

STORY: Choose exact or prefix callsign/spotter filters and an explicit UTC scope, inspect stable pages, then expand an individual report's original source and stored classification. Refresh opens a new archive snapshot.

FIRST VIEWPORT: Compact filter rows sit above recording state and full-scope totals. The paged table fills the remaining workspace; its footer keeps Previous, Next, Details and Refresh reachable. There is no duplicate page heading. Narrow containers retain core columns and expose other values in inline Details.

FORM: Precisely requested extension, no seed. The signature interaction is stable watermark pagination while reports arrive. Late query, statistics and detail responses cannot replace a newer user selection. State changes use existing focus and selection conventions; no decorative motion.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Constraints: local archive observations are not a complete historical server feed. Distinguish empty results, unavailable storage, degraded recording and known gaps. This slice has read-only history authority and no station, export, purge or QSO actions. Root integration owns browser captures and finish review. No shipping raster assets are introduced. DESIGN.md remains unchanged.

## Implementation checkpoint — 2026-10-13

The table uses the existing measured capacity hook with at most 100 rows. Container or inline-detail resize retains the cursor, snapshot watermark and previous-page trail; a compact scope notice names that behavior. If a selected report falls outside the resized page, its full detail stays available and the first visible row remains keyboard reachable. Explicit search, Refresh and page navigation close the previous detail. Statistics are computed for the full filter scope at the query watermark and cached across paging/resize. Refresh discards that cache and starts a new snapshot. Status polls are nonoverlapping and spaced five seconds after completion; browsing does not poll the query.

The initial implementation passed 22 focused synthetic component tests and TypeScript checking. These verified UTC normalization, portable/prefix searches, exact-scope statistics, pinned pagination, asynchronous stale-result and stale-error suppression, resize and detail behavior, empty/error/retry states, escaped source fields, persisted gap visibility and read-only method scope. The final browser review and correction record below supersedes the initial review-pending checkpoint.

## Scoped browser finish — 2026-10-13

Final verdict: **PASS for the production Spot History component in the reviewed synthetic browser fixture.** The fresh Sol medium reviewer `spot_history_finish_review` scored both material P2 findings resolved: nested global definition-list styling no longer overrides expanded statistics, and Close details restores keyboard focus to the Details control. This is a scoped browser/component verdict, not native packaged or live-database acceptance.

### Evidence

The root integration captured the production component with synthetic report data. All captures are verification evidence stored under `/Users/oliver/.agent-browser/tmp/screenshots/`; they are not shipping assets.

| Capture | Browser viewport | Evidence |
| --- | --- | --- |
| [Desktop](/Users/oliver/.agent-browser/tmp/screenshots/screenshot-1791881404458.png) | 1440 × 900 | Dense table, compact filters and summaries, reachable paging controls. |
| [Compact](/Users/oliver/.agent-browser/tmp/screenshots/screenshot-1791881296016.png) | 900 × 700 | Core columns remain visible with secondary fields available through Details. |
| [4K at 200% zoom](/Users/oliver/.agent-browser/tmp/screenshots/screenshot-1791881385049.png) | 3840 × 2160, 200% CSS zoom | Measured page capacity uses the available area. The synthetic fixture adjusts its logical viewport to model native viewport sizing; this remains browser evidence. |
| [Expanded statistics](/Users/oliver/.agent-browser/tmp/screenshots/screenshot-1791881711102.png) | Settled desktop statistics state | Statistics groups use block layout inside the responsive distribution grid after the global-style correction. |

Browser checks confirmed Next remains on Page 2 after closing Details and the resulting capacity change. The measured workspace had width and scrollWidth of 1420 and height and scrollHeight of 668, with no overflow at that inspected state. Closing Details restored focus to Details after resize. Expanded statistics settled with block-layout groups.

Focused verification passes **26 tests: 23 Spot History panel tests and 3 shared-capacity tests**. The final complete frontend rerun passed **579 tests across 79 files**, and TypeScript, Vite and detached-window style/bundle gates passed. One earlier concurrent build/test run timed out in an existing logbook resize assertion; the isolated logbook suite and full rerun passed. Test and browser evidence are separate from native application, packaged release and live retained-database proof, which remain pending. The temporary synthetic fixture has been removed, its browser session closed and its development server stopped.

### Incumbent system agreement

The finished CSS and component preserve the incumbent navy panel/control surfaces, compact system typography, teal callsigns, cyan frequency data, amber recording attention, coral errors and visible keyboard focus. Dense rows and compact summaries carry the information; the detail inspector uses existing inline disclosure conventions. No replacement visual world, new system tokens, decorative motion or shipping raster assets were introduced. **DESIGN.md is unchanged.**

The incumbent DESIGN.md uses its existing section structure without the current reference's canonical token frontmatter, and `.impeccable/design.json` is absent. This pre-existing documentation drift is recorded without repair because the authorized work is an ordinary surface extension. Neither corrected P2 defect is canonized as a design-system rule.
