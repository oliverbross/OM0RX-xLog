# Traditional Desk Map / Logbook — source acceptance

This is UI-39's traditional Desk extension, not a new all-window preset. The
installed testing baseline remains Integration alpha.21. This stage has not
been packaged or accepted in the native installed app.

## Behavior

- Choose Map, Logbook, Logbook above map, or Logbook below map in the existing
  left-hand pane. Cluster/Band Maps and their horizontal divider are unchanged.
- Map is the default and does not mount or fetch a Logbook. Once needed, panes
  remain mounted, hidden and inert when unused, preserving map/table state.
- Drag or use the keyboard to resize the vertical split. Minimum pane heights
  preserve usability; a short container scrolls instead of crushing either pane.
- Desk columns have separate preferences. The 16 October follow-up makes the
  initial Desk table match the normal Logbook's ten columns: UTC, Callsign,
  Band / Mode, Frequency, RST, Country, QSL, LoTW, Club Log and Comment.
  Existing docked and detached preferences retain their defaults and storage
  keys. A Desk-only v2 presentation key promotes the untouched legacy
  five-column default while preserving legacy customized visibility and widths.
- Reuse the existing Logbook and mutation session, not another data owner.
  Local Import/Export/Delete/Undo work blocks navigation, close, layout changes
  and spot activation until it finishes. Presentation changes do not clear the
  current QSO or upgrade a reviewed deletion revision.
- A late file-picker selection rechecks current admission before reading the
  file. Rejected selections clear the picker so an explicit same-file retry
  works after unlock; unlocking alone never retries an import.

## Review and evidence

- Independent source review found the late-picker admission and same-file retry
  issues; both were corrected and the final retry finding was scored resolved.
- Focused actual-table tests preserve Delete consent through hide, reorder and
  measured resizing. Intervening contact edits conflict; confirmation uses the
  original reviewed revision and applies at most once.
- Main-app tests retain invalid QSO input across all four views and enforce
  editor/operation guards. Column tests cover independent Desk preferences.
- Impeccable finish review: **ship at visual-component scope**. Settled synthetic
  captures at 800×700, 1440×900 and 3840×2160 show Logbook-above-map. They use the
  actual table/component with memory-only contacts and a labelled placeholder
  map; they do not prove native lifecycle, hardware or live map behavior.
- The compact table retains keyboard-focusable horizontal scrolling; later
  columns are not hidden merely to fit. Detector returned no findings.
- The 16 October follow-up keeps the Desk table out of the standalone responsive
  card query, verifies the normal ten-column rendered structure, and exercises a
  persisted keyboard width change across above/below ordering and route remount.
  Its scoped preference, shared-column, full/compact/detached Logbook, Desk,
  rendered-acceptance and responsive-structure gate passes **59/59**, with the
  production build and diff checks also passing.
  This follow-up is source-only and has not replaced the installed alpha.31.
- Documentation review classified this as an ordinary extension of the existing
  navy Operate system. DESIGN.md is unchanged. Preexisting token-format/sidecar
  drift was noted, not repaired as a side effect.

## Final source gate

- Full frontend: **1,033/1,033**, 126 files, 265.29 seconds. The final run used
  one worker and 15-second runner deadlines; application deadlines were unchanged.
- An earlier run overlapped test/browser work and passed 1,032 tests with one
  simulated rotor timeout. All 23 tests in that file passed in isolation, then
  the complete suite passed without source or timeout changes. An earlier
  superseded pre-fix full run was stopped, not counted as passing.
- Final TypeScript/Vite build and detached bundle/CSS gates pass. Existing
  large-chunk warnings remain. Native and Swift source are unchanged in this
  stage; their alpha.21 results were not rerun and are not new UI39 acceptance.
- Independent code-review findings are resolved, and the diff check is clean.

Native packaged acceptance remains a separate gate. Fully independent Settings,
Rotor, Station Control, Chaser and CW migrations remain open.
