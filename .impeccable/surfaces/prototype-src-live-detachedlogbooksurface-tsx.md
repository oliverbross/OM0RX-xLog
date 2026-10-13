# Detached Logbook

Mode: Operate. Extend the existing Logbook and full contact editor into a singleton native window. The user explicitly wants every screen detachable while retaining the old docked layout. Reuse the existing components; no new visual world or concept tournament applies. Work is unattended.

## Direction contract

THESIS: The same local logbook can be used on another display without a second logger or a dependency on the main renderer.

OWN-WORLD: Inherit the existing navy surfaces, compact system type, semantic contact colours, table and editor controls. No new raster assets or decorative motion.

STORY: Undock from the existing toolbar or open Logbook through Window. Search, import/export, edit and recover contact changes in that window. Dock returns to the main Logbook when edits are settled.

FIRST VIEWPORT: The native title names Logbook; the existing table toolbar adds Dock back in the same row. The table fills the remaining window. Editing replaces the table with the existing full editor and its recovery notices; historical edits do not follow or control the radio.

FORM: Precisely requested extension, no seed. One shared backend, separate per-window journals and revision-checked updates prevent silent cross-window overwrites. Close/Dock must not abandon an active edit or pending operation. Existing responsive shortcomings remain explicit WS-08 work, not concealed by clipping.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Acceptance: native singleton/focus/dock, table/editor parity, event-driven cross-window refresh, separate durable recovery, concurrent-contact conflict, scoped native permissions with no station authority, and real packaged OS verification. Native visual review is blocked until a valid capture is available; tests are not a substitute.

## Responsive Logbook refinement — 2026-10-13

Scoped finish verdict: **SHIP for the shared-component browser refinement only.** This extends the existing docked and detached Logbook without changing the established operator-console identity. It does not close the full detached-window feature, native release acceptance, or all WS-08 responsive work.

The shared table no longer requires a fixed 1020px minimum width. At a Logbook container width of 1050px or less, the table keeps four core columns: UTC, Callsign, Band / Mode and Frequency. Wider containers retain the existing ten-column view. Long table values may truncate for scanning; the selected contact's Details panel exposes the full displayed contact values, including callsign, reports, country/name, confirmations and comment. Details wraps text, is limited to half the viewport height, and may scroll for longer content. Scrolling remains a fallback for constrained space; this is not a universal no-scroll guarantee.

Page capacity follows the measured table area, header and rendered row height, including UI zoom, with a settled 120ms resize measurement and a range of 1–100 rows. Worker requests remain bounded to 20 contacts per request. Refresh preserves selection when the selected identifier remains in the returned page. Capacity changes re-anchor the page around the selected contact before fetching, so opening Details for a lower row does not remove that row and collapse the panel. This anchor correction resolved the finish review's sole finding.

### Evidence and review boundary

The reviewed browser captures use 501 synthetic contacts and are stored under `/tmp/xlog-logbook-fit-18G8qM/`:

| Capture | Viewport | Observed result |
| --- | --- | --- |
| `compact.png` | 640 × 480 | Four core columns, wrapped toolbar, nine rows and visible paging controls. |
| `compact-details.png` | 640 × 480 | Full selected-contact values wrap above a two-row table page. |
| `compact-lower-row-details.png` | 640 × 480 | TEST7/P remains selected with Details open after re-anchoring to contacts 7–9. |
| `desktop.png` | 1280 × 800 | Existing ten-column table, 22 rows and paging controls fit the viewport. |
| `wide-4k.png` | 3840 × 2160 | Existing ten-column table uses the wider area and shows 70 rows. |

Source review covered `LogbookPanel.tsx`, `logbook.css` and `logbookCapacity.ts`. The finish handoff reports all 464 frontend tests across 66 files passing, plus TypeScript and Vite builds. These checks and captures establish the browser/shared-component refinement; they do not prove native singleton/focus/dock, cross-window recovery or packaged platform parity.

Native J run `38333151547` passed all three platform builds, but Windows and Linux GUI runs failed before the detached-window test because Delete was unavailable during refresh. The refresh-selection fix is implemented in source; complete new CI verification remains pending at this review boundary. The installed alpha13 application was not replaced.

### System agreement and existing drift

The refinement preserves compact system typography, navy working surfaces, teal callsigns, cyan band/frequency values, semantic confirmation indicators and the existing table/editor controls. The old docked layout remains available. There is no new visual world, decorative motion or shipping raster asset; the PNGs above are verification captures only.

`DESIGN.md` remains the incumbent visual authority and is unchanged. Its existing headings/frontmatter do not follow the current document reference's canonical schema, and `.impeccable/design.json` is absent. Those pre-existing documentation differences are reported without repair; this ordinary extension adds only this surface record.
