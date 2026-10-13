# Compact QSO header — Operate refinement

Target: `QSOHeader.tsx`, traditional/custom Desk QSO and full QSO editor.
User explicitly requested removing the global tuning line and moving existing
IOTA/reference evidence onto the QSO heading row, aligned at the far right.

Preserve the incumbent navy surfaces, system typography, cyan radio icon and
teal evidence text. No new visual identity, raster, animation or control.
The title retains its accessible name; status is adjacent, live and call-fenced.
Long/multiple reference descriptions wrap within the right-hand space instead
of forcing horizontal overflow. Empty/unmatched evidence reserves no space.
Tune errors and authoritative confirmation/rotor fences remain unchanged.

Verification: focused component tests plus complete frontend/build gates;
synthetic production-component captures at compact, desktop and 4K sizes.
Native installed acceptance remains separate. Existing DESIGN.md format drift
and missing sidecar are outside scope; do not repair them incidentally.

Bounded independent review (2026-10-13): no scoped P1/P2 safety or UX findings.
Reviewed the shared header, Desk/full-editor wiring, call fence and tuning-row
removal, plus desktop, 4K and compact synthetic production-component captures.
The final compact Desk fixture includes its production `.operator-desk` query
container. Evidence stays at the right edge beside the heading; multiple rows
wrap without obscuring the title or controls. Accessible heading names remain
unchanged, stale-call evidence is hidden, and tune errors/confirmation fences
remain in the source. Existing colour, typography and density are preserved.
Screenshot evidence: `screenshot-1791878807269.png` (desktop),
`screenshot-1791878807693.png` (4K), `screenshot-1791878807903.png`
(full editor), `screenshot-1791878983619.png` (compact Desk), and
`screenshot-1791878983787.png` (compact full editor), all under
`/Users/oliver/.agent-browser/tmp/screenshots/`.
These captures support layout review only; they do not establish installed
native, live-account or radio/hardware acceptance. No new raster ships.
