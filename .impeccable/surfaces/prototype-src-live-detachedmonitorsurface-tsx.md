# Independent Station Monitor

Mode: Operate. Extract the existing station monitor into its own frontend, preserving the Desk's navy/cyan/teal console and existing measurements rather than redesigning the station.

THESIS: Keep selected-radio and independent-rotor observations useful when the Desk renderer is absent, without creating another provider or device owner.

OWN-WORLD: Reuse Monitor, its frequency/measurement typography and semantic states. Add only a compact status/Refresh toolbar and scoped responsive containment. No new raster assets or decorative motion.

STORY: Open Station Monitor from Window. Read retained native observations; use only already-supported station actions and rotor bearing/Stop, fenced to the observed native selection or owner. Configure and connect in the main station controls.

FIRST VIEWPORT: Station observations and rotor stay visible; optional map loading cannot block telemetry or Stop. Unset, unavailable and stale sources are explicit independently. Narrow windows stack the existing panels.

FORM: Cheap retained core context and optional map metadata are separate streams. Passive reads never choose/default/connect a radio. Native radio-action admission checks captured selection generation and identity atomically; rotor commands retain owner/generation readbacks. Isolated acceptance is clearly synthetic and read-only.

FINISH: Root approved the default-size captures as scoped synthetic evidence. The default 780×600 normal and stale captures now keep Stop fully visible (y=562–592); the optional map shrinks first. Desktop 1000×760 and compact 390×680 captures retain the existing console hierarchy and natural compact scrolling. No shipping raster was added, and the shared design system is unchanged. Native runtime acceptance remains open.

Validation: The full frontend suite passed 914/914 tests across 112 files with one worker and an explicitly extended 15-second runner budget, not a performance acceptance claim. The existing LiveApp file separately passed 33/33 with unchanged default five-second limits, and the previously timed-out rotor workflow passed alone unchanged. The obsolete Desk-projection tests now exercise the real independent core follower and action helpers, preserving pending-turn/Stop, older-revision/late-reply, scoped-action, stale-Stop and no-device-polling coverage with a controlled clock. TypeScript, Vite, detached dependency and CSS budgets passed. Focused native filters passed 81 test executions (overlapping filters, not 81 unique tests), including selection identity/freshness admission, isolation, and serialized pending-Goto→Stop ordering. Independent narrow Stop/Linux-context source review found no blocker. No detector findings remained in the scoped frontend review.

Captures: `.impeccable/review/monitor/default.png`, `default-stale.png`, `desktop.png`, `mobile.png`, and `mobile-rotor.png`. These render the actual surface with injected memory-only observations, commands and optional-map placeholder; they do not prove native webview lifecycle, map tiles or hardware behavior.

Residual: An outstanding driver Goto reply can still delay Stop because the existing coordinator preserves driver ordering. This stage removes the Monitor's preceding snapshot wait; it does not claim urgent physical Stop timing. Native main-absent lifecycle and hardware acceptance remain open, and the full windowed preset stays disabled.

Evidence boundary: source, injected-transport tests and synthetic component captures only. No live/native launch or hardware acceptance; all-window mode remains disabled until actual native acceptance.
