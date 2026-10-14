# OM0RX-xLog live project board

Last updated: 14 October 2026, after independent Settings source verification;
shared revisioned rotor configuration is next.

This is the operator-facing project overview. Keep it current after every material
implementation, validation, installation or acceptance change. Detailed evidence
and historical wording remain in the
[operator feedback tracker](OPERATOR_FEEDBACK_TRACKER_2026-10-12.md), the
[workspace/native-window plan](WORKSPACE_CANVAS_AND_NATIVE_WINDOWS_PLAN_2026-10-13.md)
and release notes. A source pass is not an installed, live-service or physical
hardware pass.

## Status legend

- **Done / installed:** implemented and observed in an installed package at the
  stated acceptance boundary.
- **Source ready:** implemented and tested in source; specific packaged, live,
  cross-platform or hardware evidence remains open.
- **Active:** being implemented now.
- **Queued:** accepted requirement, not yet implemented.
- **Acceptance:** implementation exists; evidence or measurement remains open.

## Current installed baseline

**0.4.0-alpha.22**, exact source `5e9192eff9e9abed551c95de78f3166775aede62`,
is installed. Its full source suites, 32 packaged native checks, Developer ID
signing, notarization, stapling and Gatekeeper checks passed. The Desk's four-way
Map/Logbook layout and offline local callsign/DXCC history were observed. The
67,997-contact workspace, pending state and NJ9L draft were unchanged; no station
or RF action was performed. See
[alpha.22 evidence](releases/v0.4.0-alpha.22-macos.md).

## Active stage: shared revisioned rotor configuration

The revision-safe Settings prerequisite is source-verified at `b58163f`, and the
independent Settings child is source-verified at `0ea919a`. The next bounded
stage moves rotor configuration out of browser-local state without connecting,
arming or moving hardware. The global Windowed preset remains disabled.

| Work item | Status | Current evidence / next gate |
| --- | --- | --- |
| SQLite-owned settings snapshot with revision | **Source verified** | Commit `b58163f`; one-time legacy seed, bounded non-secret validation and atomic storage implemented; four direct database tests pass. |
| Idempotent operation receipts | **Source verified** | Exact replay, no-op save, conflicting revision, reused ID and restore retirement pass focused database/API coverage. |
| Generation/revision-checked worker API | **Source verified** | `settings_load`, `settings_save` and `settings_receipt` carry workspace generation/revision; three end-to-end workspace safety tests pass. |
| Backup restore semantics | **Source verified** | Restore rotates generation, honors `restore_settings`, preserves current settings when excluded and retires old receipts. |
| Parent-owned raw Settings form | **Source verified** | The journaled session preserves raw invalid text, concurrent changes, lost acknowledgement and same-ID retry; nine focused tests pass. Secret-like keys are rejected recursively. |
| Settings UI recovery | **Source verified** | Check receipt, retry same save and adopt saved values are exposed; 14 component tests plus nine session tests pass and TypeScript is clean. |
| Full validation and review | **Source verified** | Frontend **1,049/1,049 across 128 files**, Rust **321/321**, normal Swift **82/82**, full portable Swift, production build and bundle gates pass; `git diff --check` is clean. |
| Independent native Settings child | **Source verified** | Commit `0ea919a`; tenth singleton native role, open/focus/Dock lifecycle, scoped non-hardware authority, main-absent renderer, dirty/remount/conflict recovery and 350,232-byte detached bundle pass. Frontend **1,051/1,051 across 129 files** and Rust **323/323** pass. Not packaged or installed. |
| Shared revisioned rotor configuration | **Active / next** | Replace browser-local rotor configuration with shared rotor-only revision/generation state. Opening, restoring and browsing must remain passive; only exact typed commands may reach the rotor owner. |

## Dependency-ordered delivery queue

1. **Source-complete:** revision-safe Settings, including restore and
   unknown-outcome recovery (`b58163f`). Packaged acceptance remains later.
2. **Source-complete:** independent Settings child with dirty-form/navigation/restart
   recovery and main-renderer-independent scoped services (`0ea919a`).
3. **Active next:** move Rotor configuration to shared revisioned rotor-only state; keep opening,
   restoring and browsing passive, and admit only exact typed commands.
4. Migrate Station Control, Chaser & DX and CW ownership to independent surfaces.
5. Finish the remaining panel inventory, native lifecycle/geometry recovery and
   only then enable the full Windowed preset.
6. Implement RADIO-05 Clear after QSY on trusted observed-RX provenance with
   editor veto, selection/command epochs and an idempotent native transaction.
7. Complete ADIF preview/update/export scope (DATA-10), optional cloud backup
   destinations (BACKUP-01) and the remaining evidence-backed RUMlog gaps.
8. Run packaged cross-platform, large-log performance, live sync and separately
   authorized hardware acceptance. Do not collapse these into source evidence.

## Workspace/native-window programme

| ID | Outcome | Status |
| --- | --- | --- |
| WS-01 | Show/hide/move/resize every desk panel | **In progress** — canvas foundation exists; inventory and native interaction remain. |
| WS-02 | Settings-managed named layouts | **In progress** — revisioned persistence/UI and Settings safety are source-verified; independent Settings window is next. |
| WS-03 | Native menus replace navigation | **In progress** — routes exist; sidebar removal awaits native acceptance. |
| WS-04 | Window menu opens/focuses every panel | **In progress** — ten roles now include independent Settings; remaining screens follow the dependency queue. |
| WS-05 | Docked/mixed/undocked share one live session | **In progress** — major draft/cluster/radio/rotor ownership moved; remaining owners open. |
| WS-06 | Layout/geometry survive restart and display changes | **In progress / acceptance** — persistence/recovery source exists; mixed-DPI/native evidence open. |
| WS-07 | No duplicate logging or station actions | **In progress** — Settings revisions/receipts and its scoped child authority are source-verified; full multi-window gate remains open. |
| WS-08 | Responsive, accessible, measured laptop/4K UI | **In progress / acceptance** — targeted fixtures pass; whole-app native measurements open. |

## Operator feedback portfolio

The compact status below deliberately separates implementation from remaining
acceptance. Consult the detailed tracker before closing any individual item.

| Status | IDs | Remaining boundary |
| --- | --- | --- |
| **Done / installed at stated scope** | UI-17, UI-26, UI-39, CW-01, CW-02, CW-03, CLUSTER-01, SYNC-01 | Some rows retain explicit hardware, alternate-OS or accessibility limits. |
| **Implemented in installed alpha.22 source; row-specific acceptance open** | UI-01–08, UI-10–16, UI-22–25, UI-27–28, UI-30–38, UI-40–41, MAP-01–04, DATA-01–07, RADIO-01–04, PERF-02–03, SYNC-06 | Perform the packaged visual, live-service, latency, real-feed or hardware checks named in the tracker; no RF inference. |
| **Active / partial** | UI-09, UI-18–21, SYNC-02, DATA-08–09, PERF-01, WS-01–08, RUM-01–03, SHIP-01 | Finish implementation where marked, then collect representative packaged evidence. |
| **Queued implementation** | UI-29, DATA-10, DATA-11 audit, BACKUP-01, RADIO-05 | Follow the dependency queue and safety acceptance in the tracker. |

## Major acceptance campaigns still open

- **Performance:** PERF-01 packaged cold/warm startup, intelligence, Awards,
  navigation and background-load median/p95; PERF-03 installed/UI latency under
  realistic contention.
- **Synchronization:** SYNC-02 complete standalone/Wavelog mode acceptance and
  SYNC-06 live bounded reconciliation without guessing held identities.
- **Station:** RADIO-01–04 physical/remote evidence only when separately
  authorized; Australia–Slovakia WAN delay must remain distinct from
  Windows-local device time. No RF action is implied by this board.
- **Data portability:** DATA-10 preview, duplicate/update policy, unsupported-field
  retention and all/filtered/selected consistent export.
- **Backups:** BACKUP-01 secure account setup, encrypted transfer where available,
  retention, upload verification and tested restore without altering existing
  remote backups.
- **Cross-platform/windowing:** macOS, Windows and Linux route parity,
  main-renderer-absent operation, mixed DPI/negative origins, monitor disconnect,
  maximize/restore and window recovery.
- **RUMlog comparison:** finish read-only Settings/menu evidence, then implement
  only prioritized independent benefits; do not expose empty imitation features.

## Update discipline

Whenever work changes state:

1. Update the active-stage row and the relevant programme/portfolio status here.
2. Add exact tests, commit/build/package identity and acceptance limits to the
   detailed tracker or a release/source-acceptance document.
3. Move an item to **Done / installed** only after its stated installed/live gate
   is observed. Keep hardware, public-service and cross-platform claims explicit.
4. Preserve operator data and unfinished work; record any backup/rollback path
   before an installation or migration.
