# Contest operator desk parity

Status: accepted product direction from Oliver on 18 October 2026; implementation in progress. The installed `3a05c2e` Test app still uses the interim fixed-layout contest workspace. This document is a delivery requirement, not acceptance evidence.

## Operator experience

Use the familiar contest-sw window composition and information hierarchy with xLog colours, typography, controls and station services. Operators must be able to open, close, move and resize each working panel. Offer both a single flexible canvas and separate native windows, including use across monitors. Save layouts independently from Normal Logging and restore them on restart; support restoring a default arrangement if windows become inaccessible.

The pinned upstream [desk screenshot](https://github.com/oliverbross/contest-sw/blob/7c8b499225a73f7f8f792246881bd7aefc05452f/pic/main.png) was visually inspected. It places a vertical band map on the left, cluster and Check Partial above the log, compact entry and macro controls below the log, and statistics, rate and rotor windows on the right. This is the starting preset, not a restriction on rearrangement. The pinned [entry/View-menu reference](https://github.com/oliverbross/contest-sw/blob/7c8b499225a73f7f8f792246881bd7aefc05452f/pic/view_menu.png) shows callsign/exchange fields, Run/S&P, band/mode choices, function-key macros and operator actions. It is an older upstream screenshot; current source determines available controls and behavior.

The pinned `not1mm/__main__.py` source at that revision creates the central Entry surface plus 11 dock windows: Band Map, Check Partial, Rate, Statistics, Group Chat, DXCC, Zone, Rotator, VFO, Log and Cluster. This is the complete initial working-window inventory; dialogs and later xLog extensions are tracked separately. Canvas and native-window completion must account for all 12 surfaces even when an early functional slice exposes fewer panels.

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

## Functional canvas checkpoint

The first source checkpoint now keeps `ContestWorkspace` as the sole session, draft, serial and mutation owner while the shared `OperatorCanvas` presents four live projections from that controller:

| Canvas panel | Current content |
| --- | --- |
| Entry | Contest fields, reports, duplicate/validation state, serial control and the existing Run/S&P macro bank |
| Check Partial | SCP and call-history import, selection and safe field projection |
| Statistics | Current score, QSO/point/multiplier totals and multiplier labels |
| Log | Contest-session log, paging and the existing correction/deletion editor |

The contest `traditional` preset is an editable canvas preset; hiding and restoring Entry does not unmount `ContestWorkspace` or create another draft owner. If the scoped layout cannot be verified, the same live controls remain available in the fixed arrangement. This is a bounded functional checkpoint, not full parity.

The remaining tracked working surfaces are Band Map, Rate, Group Chat, DXCC, Zone, Rotator, VFO and Cluster. They need contest-aware projections through their existing services before they can be exposed as meaningful canvas panels. The scoped native registry and planner recognize all 21 shared roles and the 12 contest-native roles, but native child presentation, action forwarding and state subscription remain separate implementation work.

## Implementation sequence

1. Inventory current upstream working windows and fields against xLog components; identify missing panels and record exact source references.
2. Separate contest session/controller ownership from panel presentation. Extract presentational components without duplicating draft, serial, score, log or assistance state.
3. Add contest-scoped layout persistence using the existing layout engine, with a familiar default arrangement and editable saved layouts.
4. Mount the same panels in the shared canvas. Verify close/reopen, move, resize, keyboard access, compact displays and restart restoration without losing entered text.
5. Extend the existing native window registry and presentation path for those panels. Keep one active contest/session/draft owner across windows and reject stale window commands after session or module changes.
6. Connect reused cluster/band map/station views through existing services and contest context. Add missing statistics/rate/tracker information on top of those services.
7. Package from the canonical checkout and test both modes on this Mac: cross-window updates, mode switches, window close/reopen, monitor changes, restart, CW/SSB Run/S&P, exports and Normal Logging isolation.

## Acceptance boundary

The desk is complete only when the working panels can be independently opened, closed, repositioned and resized in canvas and native-window modes; their information and actions are mapped to verified contest logic; layout and session state survive restart; and switching presentation does not duplicate or lose QSOs, serials, drafts or service ownership. A screenshot or static mockup does not establish this behavior. The current Test runtime keeps external radio/keying/PTT/audio I/O disabled. Windows/Linux app builds remain deferred by user direction.
