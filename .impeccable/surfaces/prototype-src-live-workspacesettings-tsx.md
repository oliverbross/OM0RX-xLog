# Workspace settings

Mode: Operate. Narrow extension of the incumbent Settings tabs, using the existing shared layout service. Unattended implementation follows the user's explicit named/configurable-workspace request; no visual-world change or concept tournament applies.

## Direction contract

THESIS: Manage named operating arrangements without changing radio connections or losing another window's layout changes.

OWN-WORLD: Inherit the navy settings surface, system typography, compact neutral inputs and teal primary action. Layout controls are a sibling of service settings, not nested in their Save form.

STORY: Inspect a saved arrangement, use it, or duplicate it into an editable copy. Explicit Save stores names, panel visibility and arrange/snap options; conflict recovery retains the unsaved intention.

FIRST VIEWPORT: A compact saved-layout selector and Use/Duplicate/Edit/Delete actions precede the selected layout summary. An inline editor replaces that summary when requested, with a name, layout options and grouped panel choices; Save and Cancel stay adjacent. No duplicate page heading or decorative preview.

FORM: Precisely specified settings extension, code-led; no seed. Keyboard navigation and revision-bound edits are the signature interaction. Unsupported panel/window placements remain visible and preserved, not silently enabled or deleted. Native fully-windowed restoration is not claimed.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Design system unchanged. No shipping raster assets. Final browser/review evidence is recorded below; native installed acceptance is separate.

## Current bounded extension — saved native placements

Extend the existing inline choices with a labelled Hidden / Operator Desk / Separate window selector only for roles supported by the native runtime. Monitor offers Hidden / Separate window only. Keep unsupported roles intact and the incomplete built-in Windowed preset unavailable. The saved layout and the native apply outcome are separate: show native errors with Apply saved windows recovery, never imply that a successful database save proves window creation. Switching to a layout hides only its previously managed windows and keeps their drafts alive; manually opened unrelated windows remain untouched. Native geometry remains machine-local. No new design system, page heading, raster or animation is needed. Browser and fresh finish-review evidence for this extension are recorded below.

### Native placement extension finish review — 2026-10-13

Verdict: ship for this bounded Settings extension after correction of the one finish-review finding. The new placement selector now uses the same canvas bounds normalization as the existing visibility control. Returning a valid separate-window rectangle to Operator Desk clamps its origin and expands the preset where needed; it no longer creates an invalid layout that fails Save. The regression test exercises an out-of-bounds window rectangle and confirms a durable layout save with valid canvas bounds. The focused production-component suite passed all 13 tests after this fix.

Fresh browser evidence for the native placement editor:

- `.impeccable/review/workspace-native-desktop.png` — 1440 × 900.
- `.impeccable/review/workspace-native-compact.png` — 720 × 900.
- `.impeccable/review/workspace-native-4k.png` — 1920 × 1080 at device scale 2.

The reviewer inspected all three captures and the production component, styles and tests. Placement controls have explicit accessible names, Monitor has no Operator Desk option, unsupported roles remain retained, keyboard focus is visible, and the compact grid and adjacent Save/Cancel actions remain readable without clipping. The native outcome copy confirms application only when generation, revision and active preset match the saved layout; a save or queued retry alone does not establish native completion. Apply saved windows is a separate recovery action and does not save the editor draft.

These captures use the synthetic browser fixture, not actual native window execution. They are review evidence rather than shipping raster assets. Installed native window behavior remains outside this visual verdict. The incumbent DESIGN.md and existing design-context drift were preserved.

The root also exercised Save followed by Use layout in that fixture and inspected `.impeccable/review/workspace-native-applied.png`; this uses a mock native status, not actual window creation. Final local validation: 641 frontend tests, 174 Rust/helper tests, TypeScript/Vite and detached-window size/style gates passed. The main-bundle warning remains open. Browser session and Vite fixture server were closed after inspection.

## Finished extension and evidence — 2026-10-13

Later request-outcome hardening: Apply saved windows now displays pending until its acknowledged native attempt completes, instead of reusing an older matching applied result. The layout, tokens and controls are unchanged; no new visual capture is claimed. Fresh source review found and corrected a recovery race where an old ticket could clear a replacement request. Focused tests cover delayed acknowledgement, rejected recovery, read uncertainty and the pending Settings copy. Actual native lifecycle acceptance remains separate from these simulated/component checks.

Outcome: ship for the bounded Workspace settings extension after fresh finish review and resolution of its two listed fixes. This dated outcome supersedes the pending browser/review status above. Native installed verification remains pending; full windowed restoration is not supported yet.

The finished surface inherits the existing settings tabs, navy canvas and raised controls, system typography, restrained separators, neutral secondary actions and teal Save action. The saved-layout selector leads directly to Use, Duplicate, Edit and Delete. The inline editor keeps naming, arrange/snap options, grouped panel visibility and adjacent Save/Cancel actions together. At compact width the existing tabs wrap and panel choices become two columns; desktop and 4K keep the choice grid bounded instead of stretching it across the display. Visible focus and disabled controls retain the incumbent interaction language. This is a code-led ordinary extension, with no new visual world or system change.

The disabled-control test now checks the disabled fieldset governing the retained draft. Save feedback distinguishes an active preset ("Layout saved.") from an inactive saved arrangement ("Layout saved. Use layout to switch arrangements."). Workspace controls remain outside the service settings Save form, and service-field drafts remain mounted while changing tabs. Unsupported and separate-window placements are retained rather than silently changed.

Visual evidence uses the production `ServiceSettings` and `WorkspaceSettings` components through `prototype/tests/workspace-settings.tsx`, with a synthetic layout service and no worker, account or station connection. The six required captures show the saved-layout view and focused inline editor:

- `.impeccable/review/workspace-settings-desktop.png`
- `.impeccable/review/workspace-settings-compact.png`
- `.impeccable/review/workspace-settings-4k.png`
- `.impeccable/review/workspace-settings-editor-desktop.png`
- `.impeccable/review/workspace-settings-editor-compact.png`
- `.impeccable/review/workspace-settings-editor-4k.png`

These PNGs are review evidence, not shipping raster assets. No raster provenance entry is required for this code-only surface. Browser fixture evidence does not establish installed native behavior, native window restoration or hardware acceptance.

Capture sizes: compact 720 × 900; desktop 1440 × 900; 4K 1920 × 1080 at device scale 2 (3840 × 2160 output). The fresh finish reviewer returned `ship` after checking both fixes in source; root and reviewer inspected all six captures. Implementation verification reported 609 frontend tests across 83 files and a successful build before the final copy assertion, followed by 13 passing focused helper/component tests. Final broader revalidation is recorded separately by the implementing agent.

Existing design-context drift was reported without repair: `DESIGN.md` retains its incumbent prose structure rather than the current canonical token/frontmatter format, and `.impeccable/design.json` is absent. `DESIGN.md` and the sidecar state are preserved. Surface-specific outcomes stay here and do not become global design rules.

Final implementing-agent validation: 612 frontend tests across 84 files, TypeScript/Vite and detached bundle/style gates passed; 155 Rust tests passed. Rebuilt portable Swift passed 124 prototype XCTest cases (two skipped), 56 cluster and 17 station XCTest cases, plus 138 Swift Testing cases across 23 suites. The isolated native suite now requires a Settings preset save/activate/rename/remount/readback check; its actual-component harness passes locally, but packaged execution remains pending. The browser fixture session and development server were closed after verification.
