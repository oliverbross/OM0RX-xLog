# Contest operator desk parity

Status: accepted product direction from Oliver on 18 October 2026; implementation in progress. The installed `3a05c2e` Test app still uses the interim fixed-layout contest workspace. This document is a delivery requirement, not acceptance evidence.

## Operator experience

Use the familiar contest-sw window composition and information hierarchy with xLog colours, typography, controls and station services. Operators must be able to open, close, move and resize each working window, including use across monitors. Contesting is presented through separate native windows opened from the Contest menu; the earlier combined canvas is not a product mode. Save contest window geometry independently from Normal Logging and restore it on restart, while recovering windows that become inaccessible after a monitor change.

The pinned upstream [desk screenshot](https://github.com/oliverbross/contest-sw/blob/7c8b499225a73f7f8f792246881bd7aefc05452f/pic/main.png) was visually inspected. It places a vertical band map on the left, cluster and Check Partial above the log, compact entry and macro controls below the log, and statistics, rate and rotor windows on the right. This is the starting preset, not a restriction on rearrangement. The pinned [entry/View-menu reference](https://github.com/oliverbross/contest-sw/blob/7c8b499225a73f7f8f792246881bd7aefc05452f/pic/view_menu.png) shows callsign/exchange fields, Run/S&P, band/mode choices, function-key macros and operator actions. It is an older upstream screenshot; current source determines available controls and behavior.

The pinned `not1mm/__main__.py` source at that revision creates the central Entry surface plus 11 dock windows: Band Map, Check Partial, Rate, Statistics, Group Chat, DXCC, Zone, Rotator, VFO, Log and Cluster. This is the complete initial working-window inventory; dialogs and later xLog extensions are tracked separately. Native-window completion must account for all 12 surfaces even when an early functional slice exposes fewer windows.

## Reuse and panel mapping

| Upstream working window | xLog reuse | Contest-specific addition |
| --- | --- | --- |
| Entry and macro controls | Existing input styling, shared draft/command ownership, keyboard and station adapters | Descriptor-driven contest exchange, serial, duplicate status, Run/S&P and contest messages |
| Log Display | Existing table, column, selection and editing patterns | Contest-session projection, exchange/points/multiplier columns, contest correction history |
| Band Map | `BandMaps`, existing band-map preferences and detached surface | Worked/needed contest state and routing to the active contest draft |
| Cluster | `ClusterPanel`, shared cluster service and activation pipeline | Contest filtering, multiplier/duplicate annotations and contest draft destination |
| Check Partial and history | Existing contest SCP/history services and callsign assistance | Compact selectable candidates, visible source and safe field mapping |
| Stats / score / multipliers | Existing contest score projection and table primitives | Per-band/mode totals, points, multiplier detail and claimed score |
| Rate | Existing timing/table primitives | Derived contest QSO rate, recent-QSO windows and Run/S&P counts |
| Rotor / station / CW | Existing station panels and service ownership | Contest context and messages; no second hardware owner |
| DXCC/zone trackers and other upstream working windows | Audit `dxcc_tracker.py`, `zone_tracker.py`, `chat.py` and related UI sources | Record complete upstream window inventory and remaining feature gaps before claiming desk parity |

The contest catalog remains separate from presentation. Selecting a definition supplies fields, validation, duplicate/scoring policy, messages and export semantics to shared panels; a new contest should not require a new desk implementation.

## Existing implementation to extend

- `prototype/src/live/OperatorCanvas.tsx` already provides panel frames, drag/resize, visibility, keyboard adjustment, snap/lock and compact presentation.
- `Sources/XLogCore/WorkspaceLayout.swift`, `workspaceLayoutSession.ts`, `useWorkspaceLayout.ts` and the existing transport provide validated, revisioned persisted layouts and recovery.
- `workspaceMode.ts`, `useWorkspaceWindows.ts`, `prototype/src-tauri/src/workspace_windows.rs`, `workspace_window_runtime.rs` and geometry support provide native window presentation and restoration.
- `LiveApp.tsx` currently mounts `ContestWorkspace` directly, while Normal Logging composes `OperatorCanvas` from shared panels. Replace that presentation difference through shared infrastructure, not a parallel window manager.

Extend panel identities and layout scope deliberately. Normal Logging presets, pending layout operations and detached windows must not be overwritten or accidentally adopted by Contesting. Reuse native geometry recovery and existing unsaved-edit/mode-switch safeguards.

## Historical canvas checkpoint

An earlier source checkpoint kept `ContestWorkspace` as the sole session, draft, serial and mutation owner while the shared `OperatorCanvas` presented four live projections from that controller:

| Historical panel | Checkpoint content |
| --- | --- |
| Entry | Contest fields, reports, duplicate/validation state, serial control and the existing Run/S&P macro bank |
| Check Partial | SCP and call-history import, selection and safe field projection |
| Statistics | Current score, QSO/point/multiplier totals and multiplier labels |
| Log | Contest-session log, paging and the existing correction/deletion editor |

That checkpoint is retained as implementation and regression history only. It does not define the current user experience: the Contest menu opens separate native windows, and there is no contest canvas/desktop mode. The single-owner rule remains applicable to every detached window.

The remaining tracked working surfaces at that historical checkpoint were Band Map, Rate, Group Chat, DXCC, Zone, Rotator, VFO and Cluster. They require contest-aware projections through their existing services before their separate native windows can be considered functional. A registered panel/window identity or visible shell is not acceptance evidence; native action forwarding and state subscription must operate against the single contest owner.

## Detached surface action contract

`contestSurfaceProtocol.ts` freezes the bounded frontend action and projection contract shared with the native adapter. Each request carries the exact UUID operating context, session and workspace generation, a UUID request ID, the current projection revision, `scope: "contesting"`, one admitted panel ID, an action and an exact-key parameter object. `workspaceGeneration` is the contest UUID string used by the worker and layout contracts. Nulls, unknown keys, boolean-as-number values, non-finite numbers, cross-panel actions and oversized UTF-8 strings are rejected.

Entry owns typed field, exchange, frequency, band, mode, serial, commit and F1–F12/Enter/Escape actions. Check Partial owns assistance query and stable-candidate selection. Log owns paging and bounded correction/deletion editing. Selection sends a stable candidate ID; the main controller resolves it against the exact projection revision instead of accepting projected fields from a child window. Panels whose adapters are not implemented accept no actions. A missing reply or owner shutdown is an uncertain terminal outcome: child windows refresh state and do not replay an action automatically.

Entry and Log correction frequency intents carry the raw text (empty allowed, at most 11 UTF-8 bytes), so a detached field preserves incomplete values such as punctuation or letters long enough for the same main-owner validation message to appear. The main owner applies digits, range and contest-band semantics and publishes the resulting raw text and validation error; a child never keeps a second unsaved editor. The native bridge commands are `contest_surface_action`, `contest_surface_action_next`, `contest_surface_action_complete`, `contest_surface_publish`, and `contest_surface_snapshot`; the single payload-free `xlog:contest-surface` wake only tells a listener to reread authoritative state.

Entry ready projection v2 adds the descriptor's available bands and modes, immutable sent fields, serial allocation, and the existing simulation controller's armed/style/status/readiness/function-key/trace state. Sent values obey both the field's declared bound and the 1024-byte projection ceiling; IDs, bands, modes and function keys are unique; serial allocation must reference an admitted sent field; and trace publication rejects more than 24 entries instead of truncating them. Entry v1 remains readable for compatibility and unavailable projections remain exact v1. Arm, style and macro intents retain the exact draft revision fence and run through the mounted `ContestOperatorPanel`; descriptor, sent exchange, readiness and trace are read-only projections.

This contract does not transfer draft or mutation ownership. The main `ContestWorkspace` remains the only controller; a child surface receives one validated panel projection and forwards typed intent. Text fields keep a bounded presentation-intent buffer while one request is in flight, coalesce later keystrokes, and reconcile only after an exact terminal receipt and newer projection. An uncertain or lost receipt is never replayed automatically.

## Implementation sequence

1. Inventory current upstream working windows and fields against xLog components; identify missing panels and record exact source references.
2. Separate contest session/controller ownership from panel presentation. Extract presentational components without duplicating draft, serial, score, log or assistance state.
3. Add contest-scoped layout persistence using the existing layout engine, with a familiar default arrangement and editable saved layouts.
4. Present the panels as separate native windows. Verify close/reopen, move, resize, keyboard access, compact displays and restart restoration without losing entered text.
5. Extend the existing native window registry and presentation path for every panel. Keep one active contest/session/draft owner across windows and reject stale window commands after session or module changes.
6. Connect reused cluster/band map/station views through existing services and contest context. Add missing statistics/rate/tracker information on top of those services.
7. Package from the canonical checkout and test both modes on this Mac: cross-window updates, mode switches, window close/reopen, monitor changes, restart, CW/SSB Run/S&P, exports and Normal Logging isolation.

## Acceptance boundary

The desk is complete only when the working windows can be independently opened, closed, repositioned and resized; their information and actions are mapped to verified contest logic; and window geometry and session state survive restart without duplicating or losing QSOs, serials, drafts or service ownership. A screenshot or static mockup does not establish this behavior. The current Test runtime keeps external radio/keying/PTT/audio I/O disabled. Windows/Linux app builds remain deferred by user direction.
