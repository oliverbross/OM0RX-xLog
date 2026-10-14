# OM0RX-xLog live project board

Last updated: 14 October 2026, after source verification of journaled exact Direct
FLEX VFO A receive-frequency control and explicit lossless ISO-8859-1 ADI import.
Hardware-profile apply and live backup wiring remain dependency-blocked as recorded
below; the next unblocked feature stage follows the delivery queue.

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

## Active stage: independent control surfaces

The revision-safe Settings prerequisite is source-verified at `b58163f`, the
independent Settings child at `0ea919a`, shared rotor configuration at `46c5f1e`,
passive Chaser & DX at `42f7b6c` and passive Station Control at `ed1cc04`. One
native CW session owner now serializes Desk arm/send/Stop at `2cb7bac`; WinKeyer
remains independent of radio selection and teardown cannot leave registered
clients behind. Protected Chaser selection now resolves retained native feed
identities and uses the existing activation owner at `617fd0e`; it creates a draft
only and cannot duplicate radio, rotor or CW effects. No CW child is exposed yet.
The first Station Control ownership slice shares Agent endpoint configuration and
fenced connection receipts at `e95968e`; the child performs Agent lifecycle
requests through that same owner at `cb33921`. Journaled provider selection is now
shared across Desk and child at `0500729`, including exact generation/selection-ID
handover fences and lost-reply recovery. Hamlib setup and explicit lifecycle now
use that same owner at `b958384`; raw radio-Hamlib lifecycle requests are denied.
Direct FLEX private-IP setup and lifecycle now use the same owner at `d4d8bb0`,
with fresh per-connection transmit consent and no raw lifecycle bypass. The shared
Hamlib setup gains an explicit, passive-until-clicked radio model browser at
`702cddf`. Hardware-profile apply cannot safely move until the Remote Agent exposes
revision/ETag conditional configuration writes; its current unconditional full PUT
could overwrite another writer. The next bounded stage is safe exact child radio
actions. The global Windowed preset remains disabled.

| Work item | Status | Current evidence / next gate |
| --- | --- | --- |
| SQLite-owned settings snapshot with revision | **Source verified** | Commit `b58163f`; one-time legacy seed, bounded non-secret validation and atomic storage implemented; four direct database tests pass. |
| Idempotent operation receipts | **Source verified** | Exact replay, no-op save, conflicting revision, reused ID and restore retirement pass focused database/API coverage. |
| Generation/revision-checked worker API | **Source verified** | `settings_load`, `settings_save` and `settings_receipt` carry workspace generation/revision; three end-to-end workspace safety tests pass. |
| Backup restore semantics | **Source verified** | Restore rotates generation, honors `restore_settings`, preserves current settings when excluded and retires old receipts. |
| Parent-owned raw Settings form | **Source verified** | The journaled session preserves raw invalid text, concurrent changes, lost acknowledgement and same-ID retry; nine focused tests pass. Secret-like keys are rejected recursively. |
| Settings UI recovery | **Source verified** | Check receipt, retry same save and adopt saved values are exposed; 14 component tests plus nine session tests pass and TypeScript is clean. |
| Full validation and review | **Source verified** | Frontend **1,049/1,049 across 128 files**, Rust **321/321**, normal Swift **82/82**, full portable Swift, production build and bundle gates pass; `git diff --check` is clean. |
| Independent native Settings child | **Source verified** | Commit `0ea919a`; tenth singleton native role, open/focus/Dock lifecycle, scoped non-hardware authority, main-absent renderer and dirty/remount/conflict recovery pass. Its Rotator tab now consumes the shared passive configuration source. Not packaged or installed. |
| Shared revisioned rotor configuration | **Source verified** | Commit `46c5f1e`; SQLite-owned generation/revision state, durable receipts, restore fencing, one-time browser-local migration, Settings Rotator UI and lost-acknowledgement/conflict recovery pass. Browsing/restoring remains passive; the Settings child may read rotor models but cannot connect or issue motion. Frontend **1,057/1,057 across 130 files**, Rust **323/323**, normal Swift **86/86**, full portable Swift and production build pass. The Settings child bundle is 385,114 bytes. Not packaged, installed or hardware-tested. |
| Independent Chaser & DX selection | **Source verified / partial ownership** | Passive child `42f7b6c`; protected draft selection `617fd0e`. Native-issued retained feed tokens are re-resolved against current worker generation and row version, then one activation owner applies a revision-fenced draft with durable receipt recovery. The child still cannot issue station, rotor or CW effects; active CW requires explicit Stop. Focused Swift, frontend and native tests pass. Not packaged, installed or live-service tested. |
| Shared Station Control owner | **Source verified / partial ownership** | Provider setup/lifecycle through `d4d8bb0`, explicit Hamlib catalogue `702cddf`, and exact Direct FLEX receive-frequency action `568ffb0`. The child action requires fresh observed RX/PTT-off VFO A evidence, capability support, exact setup/selection/control/connection generations and a durable receipt; one observed sample cannot issue twice. **53 frontend**, **4 receive-native**, **77 station-owner** and **9 monitor-context** focused checks plus TypeScript pass. Agent/Hamlib receive controls and FLEX mode remain hidden because their backends lack the same exact target guarantees. Hardware profiles remain CAS-blocked. |
| Reviewed ADIF/ADX transfer workflow | **Source verified / partial DATA-10** | Workflow through canonical DXCC `f380d95`; explicit ISO-8859-1 ADI `efcc329`. UTF-8, strict Windows-1252 and lossless Latin-1 are explicit choices; Latin-1 maps every source byte to the same code point, preserves all C1 values through native import/export/update and rejects NUL. **64 utility**, **23 component** and focused native transfer tests plus TypeScript pass. ADX input remains UTF-8-only. Other encoding/typed-field decisions, full XSD/package acceptance and packaged roundtrip remain open. |
| Immutable remote-backup execution foundation | **Source verified / partial BACKUP-01** | Planning through recurring host seam `83aab64`; private local snapshot/tick adapters `7970974`. Fresh SQLite/settings/preferences are sealed and revalidated under an injected active-context lease; staging is removed before bytes return. **49 native** and **46 portable-manifest** tests pass. Live wiring first needs a workspace-bound authorization owner: production identity is UUID text while plans currently use `UInt64`, and no destination revision/consent authority exists. Provider adapters, credentials, authenticated receipts, retention/UI and crash-orphan cleanup remain open. |
| Awards calculator bounded optimization | **Source verified / PERF acceptance open** | Commit `aad3886`; active ordinary JARL entities avoid unnecessary UTC date construction while deleted/designated-date rules retain exact UTC boundaries. The generated 100,000-contact calculator median improved **26.6–35.0%** across observed runs and all nine award totals remained exact. This is not packaged cold-open, database or UI median/p95 evidence. |
| Existing programme-reference feedback audit | **Source verified at existing scope** | Existing display-only POTA/SOTA/IOTA/WWFF/WWBOTA evidence is generation/draft/call fenced and never replaces operator input. **8 frontend** and **3 portable Swift** focused tests pass. User-observed POTA success is not proof of every live feed or packaged state. |
| Shared native CW owner | **Source verified / partial windowing** | Commit `2cb7bac`; the Desk uses one native client/session owner for arm/send/Stop with provider/selection generations, revisioned snapshots, priority Stop and deterministic unregister/teardown cleanup. WinKeyer does not require a selected radio. Focused native/frontend gates and the aggregate full suites pass. No independent CW child, package, installation, physical keyer, radio or RF acceptance yet. |
| Remaining Station Control ownership | **Active / dependency split** | Direct FLEX exact receive frequency is implemented; exact mode is blocked because the backend targets mutable `selectedSliceID`. Hardware-profile apply requires Agent-side config revision/ETag plus conditional PUT/If-Match. Agent/Hamlib action parity and discovery/SmartLink remain separate. |

## Dependency-ordered delivery queue

1. **Source-complete:** revision-safe Settings, including restore and
   unknown-outcome recovery (`b58163f`). Packaged acceptance remains later.
2. **Source-complete:** independent Settings child with dirty-form/navigation/restart
   recovery and main-renderer-independent scoped services (`0ea919a`).
3. **Source-complete:** shared revisioned rotor-only configuration with passive
   open/restore/browse behavior and exact typed command boundaries (`46c5f1e`).
4. **Source-complete at protected-selection scope:** independent Chaser & DX
   read/refresh (`42f7b6c`) plus native-token, editor-admitted draft selection
   (`617fd0e`). Station/rotor/CW effects and packaged/live acceptance remain open.
5. **Source-complete for all three provider lifecycle paths and selection:** passive
   Station Control observations (`ed1cc04`), shared Agent endpoint/receipts
   (`e95968e`), active child Agent lifecycle (`cb33921`), journaled shared provider
   handover (`0500729`), shared Hamlib (`b958384`) and shared private-IP Direct FLEX
   setup/lifecycle (`d4d8bb0`). Hardware profiles and broader child actions remain
   embedded/open; discovery/SmartLink is not claimed.
6. **Source-complete at shared-owner scope:** one native CW session owns Desk
   arm/send/Stop (`2cb7bac`). An independent CW child and packaged/hardware
   acceptance remain open.
7. **Active next:** extend Station Control ownership to safe exact child radio
   actions without creating a second station, radio or device owner. Resume shared
   hardware-profile apply only after the Remote Agent gains conditional writes.
8. Finish the remaining panel inventory, native lifecycle/geometry recovery and
   only then enable the full Windowed preset.
9. Implement RADIO-05 Clear after QSY on trusted observed-RX provenance with
   editor veto, selection/command epochs and an idempotent native transaction.
10. Finish DATA-10 remaining encoding/typed-field decisions and full XSD/package
    acceptance; wire BACKUP-01 live app/workspace ownership plus real provider/
    credential/authenticated-receipt/UI stages on the durable local adapters; then
    close remaining RUMlog gaps.
11. Run packaged cross-platform, large-log performance, live sync and separately
   authorized hardware acceptance. Do not collapse these into source evidence.

## Workspace/native-window programme

| ID | Outcome | Status |
| --- | --- | --- |
| WS-01 | Show/hide/move/resize every desk panel | **In progress** — canvas foundation exists; inventory and native interaction remain. |
| WS-02 | Settings-managed named layouts | **In progress** — revisioned persistence/UI, independent Settings and shared passive Rotator configuration are source-verified; packaged/native acceptance remains. |
| WS-03 | Native menus replace navigation | **In progress** — routes exist; sidebar removal awaits native acceptance. |
| WS-04 | Window menu opens/focuses every panel | **In progress** — twelve roles now include independent Settings, passive Chaser & DX and passive Station Control; remaining screens follow the dependency queue. |
| WS-05 | Docked/mixed/undocked share one live session | **In progress** — major draft/cluster/radio/rotor ownership, Desk CW and shared Desk/child Agent lifecycle moved; remaining provider/action owners open. |
| WS-06 | Layout/geometry survive restart and display changes | **In progress / acceptance** — persistence/recovery source exists; mixed-DPI/native evidence open. |
| WS-07 | No duplicate logging or station actions | **In progress** — Settings and rotor-configuration receipts plus one protected Chaser draft-activation owner are source-verified; Chaser has no raw station/rotor/CW authority. Full multi-window gate remains open. |
| WS-08 | Responsive, accessible, measured laptop/4K UI | **In progress / acceptance** — targeted fixtures pass; whole-app native measurements open. |

## Operator feedback portfolio

The compact status below deliberately separates implementation from remaining
acceptance. Consult the detailed tracker before closing any individual item.

| Status | IDs | Remaining boundary |
| --- | --- | --- |
| **Done / installed at stated scope** | UI-17, UI-26, UI-39, CW-01, CW-02, CW-03, CLUSTER-01, SYNC-01 | Some rows retain explicit hardware, alternate-OS or accessibility limits. |
| **Implemented in installed alpha.22 source; row-specific acceptance open** | UI-01–08, UI-10–16, UI-22–25, UI-27–38, UI-40–41, MAP-01–04, DATA-01–07, RADIO-01–04, PERF-02–03, SYNC-06 | Perform the packaged visual, live-service, latency, real-feed or hardware checks named in the tracker; no RF inference. |
| **Active / partial** | UI-09, UI-18–21, SYNC-02, DATA-08–11, BACKUP-01, PERF-01, WS-01–08, RUM-01–03, SHIP-01 | DATA-10 has reviewed UTF-8/Windows-1252 ADI plus UTF-8 ADX import, frozen ADI/ADX export and 33-field duplicate updates including canonical DXCC; other encodings/typed fields and full XSD/package acceptance remain. BACKUP-01 has durable planning through private local capture and recurring ticks, but no live app/workspace wiring, provider adapter, authenticated remote receipt or UI. DATA-11's feedback path is audited. |
| **Queued implementation** | RADIO-05 | Follow the dependency queue and safety acceptance in the tracker. |

## Major acceptance campaigns still open

- **Performance:** PERF-01 packaged cold/warm startup, intelligence, Awards,
  navigation and background-load median/p95; PERF-03 installed/UI latency under
  realistic contention.
- **Synchronization:** SYNC-02 complete standalone/Wavelog mode acceptance and
  SYNC-06 live bounded reconciliation without guessing held identities.
- **Station:** RADIO-01–04 physical/remote evidence only when separately
  authorized; Australia–Slovakia WAN delay must remain distinct from
  Windows-local device time. No RF action is implied by this board.
- **Data portability:** DATA-10 packaged roundtrip, remaining legacy-encoding
  decisions, full ADX/XSD acceptance, typed-field decisions and large-file acceptance.
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
