# Configurable Operator Desk — Operate extension

Target: `prototype/src/live/OperatorCanvas.tsx`, shared layout hook and LiveApp integration.
Code-led extension of the current desktop station UI. The user requested autonomous implementation of movable/resizable panels while retaining the traditional arrangement; no new visual identity or concept round is needed.

## Direction contract

THESIS: Arrange the working tools, not a decorative dashboard. Traditional remains the default and a persistent escape route; a custom canvas uses the same real panels and shared operating session.

OWN-WORLD: Inherit navy surfaces, compact system typography, neutral controls, cyan focus and teal selected state. No new raster, ornamental motion or palette.

STORY: Choose Custom, unlock the layout, move/resize with a handle or arrow keys, choose visible panels, then lock it. Changes commit at gesture end. Failed/conflicting saves retain intent and offer explicit recovery; they never reset the desk silently.

FIRST VIEWPORT: One wrapping compact layout toolbar precedes the working area. Traditional keeps its incumbent composition. Custom fills the remaining area with readable panel frames. Handles appear only while editing. Compact windows offer a panel selector and one full-width panel rather than tiny overlapping fields. All command controls remain real, particularly Rotor Stop.

FORM: Precisely requested local extension, no seed. Signature interaction is pointer/keyboard placement with no parent telemetry churn; no animated repositioning or delayed controls. Current usable canvas panels are delivered incrementally; remaining panel/window reconciliation stays explicitly tracked.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Verification

Test saved placement, lock, hide/show, keyboard/pointer commit/cancel, stale updates, load failure/recovery and returning to Traditional without changing draft or station state. Browser fixtures use real QSO/intelligence content with synthetic data and fake layout transport only, at 1280×800, 640×600 and 3840×2160. These are not native hardware/package acceptance. Retain exact-package checks separately. No new shipping raster. Existing DESIGN.md format drift remains outside scope.

## Implementation and documentation verification — 2026-10-13

This is an ordinary extension of the incumbent Operate surface. Documentation checked `PRODUCT.md`, `DESIGN.md`, `OperatorCanvas.tsx`, `OperatorCanvas.css`, `canvasGeometry.ts`, the production `LiveApp.tsx` integration, the shared stylesheet, and the focused canvas regression tests. `DESIGN.md` remains unchanged; its existing format drift and the absent `.impeccable/design.json` sidecar are pre-existing and were not repaired as part of this work.

The extension retains the navy working surfaces, neutral compact controls, system typography, monospaced operational values, cyan focus outlines and teal affirmative states. Canvas frames reuse the real desk panels and existing color variables. The shared stylesheet's secondary-text value differs from the older design prose; this extension inherits the incumbent variable and does not establish a second palette. Editing chrome uses small restrained corners and disappears when locked. No new image asset, decorative motion or visual identity was introduced.

The layout toolbar wraps above the work area and keeps Traditional accessible. Custom placement uses proportional coordinates, bounded move/resize geometry, optional snapping and gesture-end persistence. Hide/show retains the saved rectangle, with bounds correction when shown. Compact work areas (under 1000 pixels wide or 580 pixels high) use a selector and one full-width panel. An owned rotor retains a Stop action in the toolbar outside panel stacking, including when panels overlap in a locked layout; the production action disarms automatic rotor following before requesting Stop and reports acceptance without claiming observed completion.

The current canvas inventory is Active QSO, Callsign intelligence, World map, Band maps, DX Cluster, Logbook and Awards, plus Rotor or Antenna when configured. Traditional retains its existing composition. This does not complete the user's broader Traditional, mixed and fully windowed workspace request: universal undocking and automatic restoration of the saved Windowed preset remain pending. The current UI states that restoration limitation explicitly.

Visual evidence inspected: `.impeccable/review/canvas-desktop.png` (1280×800), `canvas-compact.png` (640×600) and `canvas-4k.png` (3840×2160). The captures show the production QSO, intelligence, world-map and band-map components with synthetic data and no station I/O. Desktop and 4K retain simultaneous working panels; the compact capture retains readable full-width QSO fields and its action row. These are local browser verification artifacts, not shipping raster assets or proof of equipment, native-window restoration or packaged-app acceptance.

The implementation handoff reports 540 frontend tests and 136 Rust tests passing, plus a passing TypeScript/Vite/bundle-budget build after removing the temporary preview entrypoints. Documentation inspected the regression assertions for restored panel position and a Stop action outside overlapping locked frames; it did not rerun those suites. The fresh review's final verdict is **ship for those two corrected findings** (hidden-position reset and overlapping locked Rotor Stop), not approval of the remaining all-window programme. The implementation owner removed `canvas-preview.html` and `src/canvasPreview.tsx`; no shipping raster was added.
