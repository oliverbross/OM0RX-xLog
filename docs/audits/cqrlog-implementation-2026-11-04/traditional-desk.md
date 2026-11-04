# Expanded message controls in Traditional layout

The standalone controls fixture passed its bounded review, but native 1.5.12
acceptance found an integration defect: expanding the voice library in the
fixed-height Traditional Active QSO card shrank the form out of sight and clipped
the lower library controls. Wheel input over the Library scrolled the outer page,
not the hidden card content. Native routes, editing, Save and Import remained
unreachable. Source review found the same constraint for an expanded CW workbench.
Custom layout and detached CW have different existing scroll containers; those
paths did not complete the default Traditional workflow.

The fix changes only Traditional's direct Active QSO card: vertical overflow
scrolls, horizontal containment stays intact, and the form/CW/voice flex items
retain their intrinsic height. Existing outer dimensions/breakpoints, Custom and
detached surfaces, drafts, output admission and Stop ownership are unchanged.
No backend, schema or protocol source changes are part of this fix.

The new `prototype/tests/visual/cqrlog-desk-preview.{html,tsx}` fixture mounts the
actual DeskQSO, CWDesk and VoiceDesk inside the actual OperatorDesk layout, with
inert native snapshots and rejected output/settings mutations. It supplements
the standalone controls fixture. Focused existing component tests passed 40 in
four files and TypeScript exited zero. Browser geometry/wheel/focus results and
the final signed native recheck are recorded with the final candidate evidence;
this note alone is not a native acceptance pass.

The Chromium pointer-wheel/focus check passed at 1920×1080, 1360×900, 760×900 and
420×900. Card heights stayed exactly 292/292/377/726 px. Expanded scroll heights
were 1,348/1,348/1,550/2,577 px, with no horizontal overflow. Pointer wheel reached
the final voice controls without moving the outer page; draft fields, QSO footer
and CW Send/Stop remained reachable. At closed desktop scroll position zero,
Callsign and Log QSO were simultaneously visible. Collapsing a lower detail
preserves focus/scroll; the operator scrolls back up rather than having the page
move automatically.

Both Stop handlers were clicked once in the inert fixture; no Send, QSO save,
Clear or settings mutation occurred and the draft was unchanged. There were zero
page runtime errors; an initial favicon 404 is unrelated to the product layout.
Accepted geometry and 20 screenshots are retained under
`.build/cqrlog-desk-layout-20261105/`, including `geometry-accepted.json`.
The reproducible browser driver is
`prototype/tests/visual/cqrlog-desk-layout.playwright.js`, used against Vite on
`127.0.0.1:1421`; no production/native IPC or device was available. The fixture's
browser sessions and Vite server were closed. Two task-owned console logs were
archived in that ignored evidence directory and verified byte-identical before
their temporary `.playwright-mcp` copies/empty directory were removed.

Focused command: `npx vitest run src/live/OperatorDesk.test.tsx
src/live/QSOHeader.test.tsx src/live/cwVisibility.test.tsx
src/live/VoiceDesk.test.tsx --maxWorkers=1`; 40 tests in four files passed.
`npx tsc --noEmit` exited zero. These do not substitute for the final signed
native pointer-wheel recheck.

The final signed 1.5.13 native recheck passed at 1440×940: wheel input scrolled
inside the fixed Active QSO card, visibly reached the final voice editing/import
controls without moving the surrounding desk, and returned to visible Callsign
and Log QSO after close/up-scroll. Saved settings and all QSO values outside the
intended correction/recovery metadata were preserved. Armed CW remains outside
the offline native profile; its actual component/Stop geometry is the bounded
browser scope above, not a physical/native-output pass.
