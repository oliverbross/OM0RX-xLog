# OM0RX-xLog live project board

Last updated: 14 October 2026, after installing signed/notarized alpha.23, then
source-verifying passive Station Identity, retained Alerts and Antenna Reference
windows, stricter lossless ADX facets, and default-off Dropbox credential,
approval and verified-registration ownership. The saved Agent and ARCO rotor were
recovered live; their false native-UUID receipt warnings are fixed in later source.
A split-aware station-safety projection and guarded Operate admission fix are now
source-verified for normal RX-A/TX-B operation.

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

**0.4.0-alpha.23**, exact source `45d29ba30dbb6059128f228f3638229deac7262b`,
is installed. Production build/bundle gates, ADIF native-transfer preflight, 32
packaged native checks, Developer ID signing, notarization, stapling and
Gatekeeper checks passed. Before/after readback is unchanged at 68,013 active and
mapped contacts, zero dirty/outbox/conflicts, SQLite quick-check `ok` and the same
NJ9L draft. One host/worker pair is running. The install itself performed no
 station, RF, manual-sync or remote-backup action. At the operator's later request,
 the prior Agent endpoint was imported into shared setup and observed ready with
 KPA500/KAT500 telemetry; the recovered ARCO rotor was connected and observed at
 049 degrees. No tune, PTT, CW or rotor-turn command was issued during recovery. See
[alpha.23 evidence](releases/v0.4.0-alpha.23-macos.md).

## Active stage: independent control surfaces

The revision-safe Settings prerequisite is source-verified at `b58163f`, the
independent Settings child at `0ea919a`, shared rotor configuration at `46c5f1e`,
passive Chaser & DX at `42f7b6c` and passive Station Control at `ed1cc04`. One
native CW session owner serializes Desk and independent CW arm/send/Stop at
`2cb7bac` and `423bb73`; WinKeyer remains independent of radio selection and
guarded teardown cannot hide pending or unknown output. Passive Rotor `adb125f`
and Station Status `39c447d` windows consume retained native owners without
starting device polling or gaining control authority. Propagation `b969c68` removes
the renderer timer/duplicate downloader in favor of one explicit shared refresh and
a passive independent child. Station Identity `8f5486a` displays a retained
non-secret projection from an already-authorized canonical Settings read; it never
calls Settings, seeds defaults, polls or gains service/device authority. Protected Chaser selection
now resolves retained native feed
identities and uses the existing activation owner at `617fd0e`; it creates a draft
only and cannot duplicate radio, rotor or CW effects.
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
| Settings UI recovery | **Source verified** | Check receipt, retry same save and adopt saved values are exposed. Commit `5a34062` also accepts native uppercase UUID spelling while keeping revisions, payloads and unexpected keys exact; **20 focused tests** plus TypeScript pass. |
| Full validation and review | **Source verified** | Frontend **1,049/1,049 across 128 files**, Rust **321/321**, normal Swift **82/82**, full portable Swift, production build and bundle gates pass; `git diff --check` is clean. |
| Independent native Settings child | **Installed / visual acceptance open** | Commit `0ea919a`; tenth singleton native role, open/focus/Dock lifecycle, scoped non-hardware authority, main-absent renderer and dirty/remount/conflict recovery pass. Its Rotator tab consumes the shared passive configuration source. Included in alpha.23; exhaustive child-window visual/recovery acceptance remains open. |
| Shared revisioned rotor configuration | **Installed / hardware acceptance open** | Commit `46c5f1e`; SQLite-owned generation/revision state, durable receipts, restore fencing, one-time browser-local migration, Settings Rotator UI and lost-acknowledgement/conflict recovery pass. On 14 October the legacy ARCO endpoint was recovered from the stopped alpha.22 WebKit snapshot, persisted at revision 1 and observed connected at 049 degrees. Alpha.23 falsely reported the successful save as mismatched because native UUIDs were uppercase; source fix `7883b90` keeps all non-UUID fields exact and passes **21 focused tests**. The fix is not yet installed; physical-motion acceptance remains open. |
| Independent Chaser & DX selection | **Installed / partial ownership** | Passive child `42f7b6c`; protected draft selection `617fd0e`. Native-issued retained feed tokens are re-resolved against current worker generation and row version, then one activation owner applies a revision-fenced draft with durable receipt recovery. The child still cannot issue station, rotor or CW effects; active CW requires explicit Stop. Included in alpha.23; live-service selection acceptance remains open. |
| Shared Station Control owner | **Source verified / partial ownership** | Provider setup/lifecycle through `d4d8bb0`, explicit Hamlib catalogue `702cddf`, and exact Direct FLEX receive-frequency action `568ffb0`. The child action requires fresh observed RX/PTT-off VFO A evidence, capability support, exact setup/selection/control/connection generations and a durable receipt; one observed sample cannot issue twice. **53 frontend**, **4 receive-native**, **77 station-owner** and **9 monitor-context** focused checks plus TypeScript pass. Agent/Hamlib receive controls and FLEX mode remain hidden because their backends lack the same exact target guarantees. Hardware profiles remain CAS-blocked. |
| Normal split safety and KPA Operate admission | **Source verified / Agent deployment open** | Live Agent revision 8413 correctly identified RX A 24.940 MHz, TX B 24.945 MHz, 12 m, Receive, READY and a confirmed TX route, but retained one failed-command alarm that compared RX against TX and advertised only `prepare-route`. The decoder now suppresses that diagnostic only when its exact kHz pair matches the observed distinct RX/TX VFOs, the current path is confirmed and the radio is proven in receive; every other mismatch remains blocking. The rule is VFO-derived rather than offset/band-specific, with explicit 20 m coverage for RX 14.200 / TX 14.230 MHz. When the Agent supports guarded `station_operate`, allows amplification and advertises `prepare-route`, xLog also admits the Agent's existing atomic prepare-and-operate transaction instead of requiring a prior proof. **19 adjacent decoder/observation tests** pass, including five new split regressions. Windows Agent TX-frequency verification and deployment remain required before live Operate acceptance. |
| Reviewed ADIF/ADX transfer workflow | **Active after installed alpha.23 / partial DATA-10** | Workflow through canonical DXCC `f380d95`, explicit ISO-8859-1 ADI `efcc329`, scalar/type checks `64e1010`, grid/reference checks `d8ac9d0`, versioned extension metadata `4ac6edb`, exact USERDEF RANGE enforcement `5fcc04f`, structural rejection `00efac8`, AGE/A-index bounds `fcbbe17` and antenna-angle bounds `16a1c4c`. Exact decimal-string comparison now enforces AGE `[0,120]`, A-index `[0,400]`, ANT_AZ `[0,360]` and ANT_EL `[-90,90]` without float rounding; **267 focused tests** plus TypeScript pass. Full XSD, live external-sync and installed roundtrip remain open. |
| Immutable remote-backup execution foundation | **Active after installed alpha.23 / partial BACKUP-01** | UUID-bound durable authorization `52327f3`, live-worker snapshot/lifecycle integration `4ac6edb`, exclusive Dropbox transport `cec2f8f`, native credential seam `ba7c86d`, approval/start owner `eb6bd42` and durable verified registration owner `9a8f2e5` bind exact workspace, destination, account, vault service, dbid, generation and revision. Registration persists only private checksummed non-secret metadata; replacement/removal, competing owners and cancellation-ignoring late replies are fenced. Latest evidence: **66 native**, **94 portable** and **4 lifecycle** checks, all with injected verification/mocked provider boundaries. Production verification/OAuth provisioning, deliberate IPC/UI exposure, retention and other providers remain open. |
| Awards calculator bounded optimization | **Source verified / PERF acceptance open** | Commit `aad3886`; active ordinary JARL entities avoid unnecessary UTC date construction while deleted/designated-date rules retain exact UTC boundaries. The generated 100,000-contact calculator median improved **26.6–35.0%** across observed runs and all nine award totals remained exact. This is not packaged cold-open, database or UI median/p95 evidence. |
| Existing programme-reference feedback audit | **Source verified at existing scope** | Existing display-only POTA/SOTA/IOTA/WWFF/WWBOTA evidence is generation/draft/call fenced and never replaces operator input. **8 frontend** and **3 portable Swift** focused tests pass. User-observed POTA success is not proof of every live feed or packaged state. |
| Shared native CW owner and independent CW child | **Installed / partial windowing** | Owner `2cb7bac`; child `423bb73`. Desk and child share one provider/selection-fenced session; passive mount sends no output, only saved macro IDs cross IPC, and protected Close/Dock retains pending or unknown output. Registration-scoped cleanup cannot Stop another window's lease. Included in alpha.23 with `station_io: false`; physical keyer, radio and RF acceptance remain open. |
| Passive independent Rotor and Station Status | **Installed / partial windowing** | Rotor `adb125f` reads retained telemetry only and exposes no motion/setup/Stop authority. Station Status `39c447d` uses event-driven retained selection/telemetry with exact provider/generation/identity matching and exposes no connection, radio, transmit or rotor authority. Included in alpha.23; neither child starts polling, and exhaustive packaged visual/hardware acceptance remains open. |
| Shared Propagation owner and independent child | **Installed / partial windowing** | Commit `b969c68`; passive snapshot and explicit awaited/coalesced refresh share the existing injected Swift fetch/cache through one native projection. The prior 15-second main-renderer timer is removed. Child mount is passive, weather/control authority is hidden, and missing worker state is reported rather than silently created. Included in alpha.23; real-network and exhaustive packaged visual acceptance remain open. |
| Passive independent Station Identity | **Source verified / partial windowing** | Commit `8f5486a`; seventeenth singleton native role. It displays eight retained non-secret identity/revision fields fed only by existing authorized canonical Settings reads. Child mount performs no Settings RPC/default seed, poll, persistence, credential or device call. Settings/workspace/worker mutations invalidate availability and stale replies cannot restore it. **72 frontend**, **7 native identity/admission/lifecycle** and **17 registry** checks plus TypeScript pass. Not packaged or visually accepted. |
| Passive retained Alerts | **Source verified / partial windowing** | Commit `749d1ac`; eighteenth singleton native role. A closed native aggregation exposes only modeled Agent safety-inhibitor/alarm presence and rotor uncertainty codes from existing retained owners. Payload-free wakes add no timer/poller, owner initialization, control, acknowledgement or persistence. The UI says retained reports are not a live all-clear and excludes broader sync/CW/backup claims. **73 frontend**, **7 native Alerts/admission/lifecycle** and **18 registry** checks plus TypeScript pass. Not packaged or live/hardware accepted. |
| Passive saved Antenna Reference | **Source verified / partial windowing** | Commit `5642563`; nineteenth singleton native role. It reuses the canonical fenced Settings projection and Desk antenna renderer without new storage, Settings RPC, timer, polling, selection, matching or RF authority. Missing, hidden and automatic profiles do not fabricate an installed antenna. **76 frontend**, **5 native antenna/admission/lifecycle**, **6 shared-projection** and **19 registry** checks plus TypeScript pass. Not packaged or hardware accepted. |
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
6. **Source-complete at shared-owner/child scope:** one native CW session owns Desk
   and independent child arm/send/Stop (`2cb7bac`, `423bb73`); passive Rotor and
   Station Status children follow at `adb125f` and `39c447d`. Packaged/hardware
   acceptance remains open.
7. **Dependency-split:** Direct FLEX exact receive frequency is source-complete;
   exact mode needs an explicit-slice backend, and hardware-profile apply needs
   Agent conditional writes. Do not duplicate owners while those prerequisites are absent.
8. **Active next:** Station Identity, retained Alerts and saved Antenna Reference
   are source-complete at their bounded scopes. Finish the remaining Sync ownership prerequisite and panel
   inventory, then native lifecycle/geometry recovery; only then
   enable the full Windowed preset.
9. Implement RADIO-05 Clear after QSY on trusted observed-RX provenance with
   editor veto, selection/command epochs and an idempotent native transaction.
10. Finish DATA-10 remaining XSD/RANGE/live-sync/package acceptance; implement
    BACKUP-01 real provider executors, credentials, authenticated receipts,
    approval/start UI and retention on the now-wired worker owner; then close
    remaining RUMlog gaps.
11. Run packaged cross-platform, large-log performance, live sync and separately
   authorized hardware acceptance. Do not collapse these into source evidence.

## Workspace/native-window programme

| ID | Outcome | Status |
| --- | --- | --- |
| WS-01 | Show/hide/move/resize every desk panel | **In progress** — canvas foundation exists; inventory and native interaction remain. |
| WS-02 | Settings-managed named layouts | **In progress** — revisioned persistence/UI, independent Settings and shared passive Rotator configuration are source-verified; packaged/native acceptance remains. |
| WS-03 | Native menus replace navigation | **In progress** — routes exist; sidebar removal awaits native acceptance. |
| WS-04 | Window menu opens/focuses every panel | **In progress** — nineteen roles now include independent Settings, passive Chaser & DX, Station Control, CW, Rotor, Station Status, Propagation, Station Identity, retained Alerts and saved Antenna Reference; remaining screens follow the dependency queue. |
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
| **Implemented in installed alpha.23 source; row-specific acceptance open** | UI-01–08, UI-10–16, UI-22–25, UI-27–38, UI-40–41, MAP-01–04, DATA-01–07, RADIO-01–04, PERF-02–03, SYNC-06 | Perform the packaged visual, live-service, latency, real-feed or hardware checks named in the tracker; no RF inference. |
| **Active / partial** | UI-09, UI-18–21, SYNC-02, DATA-08–11, BACKUP-01, PERF-01, WS-01–08, RUM-01–03, SHIP-01 | DATA-10 has reviewed UTF-8/Windows-1252/ISO-8859-1 ADI, UTF-8 ADX, 33-field duplicate updates, typed/pattern checks, versioned APP/USERDEF metadata with exact RANGE semantics, strict structural rejection and exact AGE/A-index/antenna-angle bounds; full XSD/live-sync/package acceptance remains. BACKUP-01 now has UUID-bound durable consent, default-off live-worker lifecycle, exclusive independently verified Dropbox execution, just-in-time workspace-vault credentials, hidden approval/start ownership and durable verified-registration metadata, but no production OAuth verifier/provisioner, deliberate UI/IPC exposure, retention execution or other providers. DATA-11's feedback path is audited. |
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
