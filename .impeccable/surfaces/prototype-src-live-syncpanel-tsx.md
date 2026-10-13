---
version: 1
slug: "prototype-src-live-syncpanel-tsx"
primary_target: "prototype/src/live/SyncPanel.tsx"
related_targets: ["prototype/src/live/SyncPanel.css"]
---

## Direction contract

THESIS: Extend the existing Sync workspace with persistent automatic synchronization while retaining deliberate consent and field-level conflict review.

OWN-WORLD: Inherit the established navy console, system typography, restrained teal actions and amber attention states. Existing controls and table density remain the visual authority.

STORY: Confirm the writer, enable an interval, see whether sync is enabled/running/completed and when it retries. Turn it off explicitly. Conflicts remain choices between local and Wavelog fields; enabling a schedule never silently resolves them.

FIRST VIEWPORT: One compact schedule/action row follows setup and writer consent, with enabled state, interval, enable/disable and manual run. Last-run and next-attempt evidence sits directly below, without decorative cards. Existing field comparison and pending outbox retain their layout. Controls wrap at compact desktop widths and remain readable at 4K.

FORM: Precisely requested extension of the existing operate surface; no concept seed or replacement visual world. The distinguishing interaction is choosing sources while retaining a visible comparison.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Scope: Extend SyncPanel component/CSS/tests and connect the native automatic service. Code-led local extension; no seed applies. Preserve DESIGN.md and its existing identity. Verify synthetic off/on/running/failure states; screenshots do not prove live synchronization or native restart acceptance.

## Scoped finish evidence — 2026-10-13

Reviewer disposition: SHIP for the automatic-sync UI extension. The finished production component retains the incumbent navy console, system typography, teal enabled/action state, neutral secondary controls and field-level conflict comparison. The schedule occupies one wrapping inline row; last-finished and next-attempt evidence uses a compact divided row with aligned numeric text. Enabling requires single-writer consent and an explicit interval; saved consent is read on mount, active runs lock schedule changes, and turning off retains contacts and pending changes. No new visual world, reusable system change or shipping raster was introduced.

Evidence inspected: `prototype/src/live/SyncPanel.tsx`, its CSS and focused tests, and the synthetic harness `prototype/src/sync-review.tsx`, which imports the production component and supplies fixture state without network synchronization. The four captures in `.impeccable/review/sync-automatic/` are `compact-off.png`, `desktop-on.png`, `4k-running.png` and `desktop-failure.png`. They show readable compact wrapping, enabled interval controls, disabled running controls and failure/retry evidence within the existing visual world. These are verification captures, not product imagery; their on-screen synthetic label establishes provenance. The supplied focused verification result is 10 UI tests passed, covering consent/configuration, saved state, completion refresh, setup truthfulness and existing conflict/outbox behavior.

Acceptance boundary: synthetic rendering and focused UI tests do not establish authenticated Wavelog synchronization, native installed-app automatic scheduling or persistence across a real app restart. Those require separate native/account evidence. The reviewer noted an optional P3 pre-existing behavior: a polling error can remain visible after a later successful poll; it does not block this scoped UI disposition.

The temporary synthetic harness was removed after capture; the production component, focused tests and labeled screenshots remain the evidence. Final combined frontend suite: 549 tests passed, with TypeScript/Vite and detached bundle checks passing.

Pre-existing documentation drift: `DESIGN.md` has no machine-readable token frontmatter and uses older headings including Direction, Surfaces and Components and Interaction; `.impeccable/design.json` is absent. These findings are recorded without repair. The existing design document remains the incumbent identity reference; no refresh, replacement or sidecar creation is approved by this ordinary Operate extension. The six direction-contract blocks above remain unchanged by this evidence note.
