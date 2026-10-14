# OM0RX-xLog live project board

Last updated: 14 October 2026, after installing signed/notarized alpha.25 from
exact source `c8ae4e7`. The compact Desk Logbook, retained split-map resizing,
default-off Clear-after-QSY, reconnect-generation fencing and KPA Operate policy
fix are now packaged. Installed acceptance proves Operate is no longer rejected
by the unrelated CAT-transmit checkbox. The launch still stopped instead of
reconnecting to a healthy saved Agent and required one manual Connect. A guarded
Operate attempt then reached the Agent but was safely rejected after the observed
FLEX route changed during apply; KPA remained Standby and output remained 0 W.
The Agent also left FLEX drive at 25 W rather than restoring the 12 m barefoot
90 W route. Unattended reconnect and exact Standby rollback remain active defects.
Receive-only startup resume is source-ready at `422bd2b` and is being packaged as
alpha.26; the Windows rollback defect remains separate.

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

**0.4.0-alpha.25**, exact packaged source
`c8ae4e71df1698bc4ecf9836be24ef84671d9da6`, is installed. The exact app passed
32/32 station-I/O-disabled packaged native checks, deep Developer ID verification,
Apple notarization submission `9efbbe6c-0713-4116-8161-64055301e528`, stapling and
Gatekeeper. Before/after data readback is 68,014 active contacts, zero dirty,
outbox or conflict rows, QSO revision 68,199 and SQLite quick-check `ok`; the
workspace payload is byte-identical. One host/worker pair started after installation. The app did
not reconnect automatically on launch; manual **Connect saved Agent** recovered
24.940000 MHz USB, RECEIVE, confirmed 12 m route, KPA Standby, KAT READY/fault 0,
output 0 W and alarms clear. A subsequent authorized guarded Operate check was not
CAT-consent blocked, but the Agent rejected it when the FLEX route changed to
24.941000 MHz during apply. No Tune, PTT, CW or rotor-turn command was issued. See
[alpha.25 evidence](releases/v0.4.0-alpha.25-macos.md).

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
| Shared revisioned rotor configuration | **Installed / hardware acceptance open** | Commit `46c5f1e`; SQLite-owned generation/revision state, durable receipts, restore fencing, one-time browser-local migration, Settings Rotator UI and lost-acknowledgement/conflict recovery pass. On 14 October the legacy ARCO endpoint was recovered from the stopped alpha.22 WebKit snapshot, persisted at revision 1 and observed connected at 049 degrees. Alpha.23 falsely reported the successful save as mismatched because native UUIDs were uppercase; alpha.25 includes fix `7883b90`, which keeps all non-UUID fields exact and passes **21 focused tests**. Physical-motion acceptance remains open. |
| Independent Chaser & DX selection | **Installed / partial ownership** | Passive child `42f7b6c`; protected draft selection `617fd0e`. Native-issued retained feed tokens are re-resolved against current worker generation and row version, then one activation owner applies a revision-fenced draft with durable receipt recovery. The child still cannot issue station, rotor or CW effects; active CW requires explicit Stop. Included in alpha.23; live-service selection acceptance remains open. |
| Shared Station Control owner | **Source verified / partial ownership** | Provider setup/lifecycle through `d4d8bb0`, explicit Hamlib catalogue `702cddf`, and exact Direct FLEX receive-frequency action `568ffb0`. The child action requires fresh observed RX/PTT-off VFO A evidence, capability support, exact setup/selection/control/connection generations and a durable receipt; one observed sample cannot issue twice. **53 frontend**, **4 receive-native**, **77 station-owner** and **9 monitor-context** focused checks plus TypeScript pass. Agent/Hamlib receive controls and FLEX mode remain hidden because their backends lack the same exact target guarantees. Hardware profiles remain CAS-blocked. |
| Normal split safety and KPA Operate admission | **Client installed / Agent route accepted earlier / rollback defect active** | xLog's rule is VFO-derived rather than offset/band-specific, with explicit 20 m coverage for RX 14.200 / TX 14.230 MHz; it suppresses only the exact known RX-versus-TX diagnostic when the observed distinct VFOs, confirmed TX path and Receive state agree. **19 adjacent decoder/observation tests** pass. Windows Agent source `4e9638a` and canonical deployment `6f55ea8` proved the TX-VFO route earlier: guarded `station_operate` returned HTTP 200 in 2847.4 ms at RX A 24.940 / TX B 24.945 MHz, KAT memory 24.945, READY, no alarms and no recovery requirement. Across 22 samples and an 11-second follow-up, MOX stayed off and RF output stayed 0 W. Alpha.25 installs commit `f100d84`: only Tune requires CAT transmit opt-in; guarded Operate still requires current Agent-advertised action, lifecycle stability and real station inhibitors. **10 focused action-policy** and **5 split-safety** tests pass. Installed acceptance reached the Agent without the false CAT-consent rejection. The Agent then correctly rejected the request because FLEX changed from 24.940 to 24.941 MHz during route apply; KPA stayed Standby and output stayed 0 W. **Active Agent defects:** the aborted apply left drive at 25 W rather than restoring the 12 m barefoot 90 W value; an earlier Standby left 95 W and KAT fault 2, and a first retry returned an empty HTTP 502. The Agent must restore the exact route value, retain a confirmed fault-free path and return a structured recoverable error. No PTT, Tune or CWX command was issued. |
| Clear after QSY (RADIO-05) | **Installed / default off / live acceptance open** | Commit `1d0b520` clears only after two distinct fresh observed-RX samples agree on the changed receive frequency; arbitrary split TX is ignored rather than inferred. Reconnect, stale data, first samples, radio/cluster selection changes, command epochs, active edits and worker/workspace generation changes veto the transaction. The native-only mutation uses an editor barrier and durable idempotent receipt; urgent release controls remain available. Legacy settings decode OFF. **3 Swift**, **16 Settings UI**, **4 QSY**, **12 cluster**, **18 activation**, **42 station-selection** and **1 native-boundary** focused tests pass. Raw Hamlib remains conservatively ineligible; `direct_agent` and `direct_flex_lan` are supported. |
| Compact desk-split Logbook | **Installed / visually observed** | Commit `6ef5748` uses the existing explicit Desk presentation context rather than a viewport guess. Alpha.25 visibly shows only Columns, the contact table and pagination in the Desk split; search/import/export/edit/delete/selection controls remain in dedicated, canvas-docked and detached Logbook views. Row Enter/double-click editing and column focus recovery remain available. **39 focused tests** plus TypeScript, diff and packaged acceptance checks pass. |
| Retained map resizing in split layouts | **Installed / interaction acceptance open** | Commit `c20b7cb` coalesces resize observations to one animation frame, measures the final positive pane size, remembers hidden/reveal transitions and avoids recreating the map. Alpha.25 rendered the retained map and compact Logbook together; camera, selected spot, overlays and markers remain covered across pointer/keyboard split resizing and Map/Logbook/above/below transitions. **34 focused Map/Desk tests** plus TypeScript, diff and packaged acceptance checks pass; extended manual divider interaction remains open. |
| Windows Agent restart reconnection | **Installed reproduction / alpha.26 source fix / packaged acceptance active** | Alpha.25 launched `stopped / Radio offline` even though the saved Agent was healthy and alpha.23 had shown the same failure after an Agent restart. Manual **Connect saved Agent** recovered `ready / Observed live` without radio action. Installed commit `a8a1e20` correctly fences late stream/command replies but did not start the saved session. Commit `422bd2b` adds one native startup resume through the existing durable selection/control fence, only for the selected saved Direct Agent. It forces `allow_transmit=false`, uses the endpoint's Keychain token, and refuses explicit disconnect/forget, provider changes, newer controls, or pending/unknown receipts. **21 session** and **43 selection** tests pass. Alpha.26 packaging and then actual Agent-restart/app-relaunch acceptance remain open. |
| Shared Sync refresh owner | **Source verified / mutation ownership open** | Commit `29ea0c0` extends the existing single native `sync_summary` monitor with a separate summary-change cursor and payload-free Main/Settings wakes. Both Sync views remove their three-second renderer timers, coalesce invalidations, fence stale replies, disable actions while state is unknown and retain explicit focus/Refresh recovery. Completion deduplication remains separate. **23 focused frontend** and **12 native monitor tests** plus TypeScript pass. Generation-bound, receipt-backed mutation ownership is still required before an independent actionable Sync child. |
| Reviewed ADIF/ADX transfer workflow | **Active after installed alpha.23 / partial DATA-10** | Workflow through canonical DXCC `f380d95`, explicit ISO-8859-1 ADI `efcc329`, scalar/type checks `64e1010`, grid/reference checks `d8ac9d0`, versioned extension metadata `4ac6edb`, exact USERDEF RANGE enforcement `5fcc04f`, structural rejection `00efac8`, AGE/A-index bounds `fcbbe17` and antenna-angle bounds `16a1c4c`. Exact decimal-string comparison enforces AGE `[0,120]`, A-index `[0,400]`, ANT_AZ `[0,360]` and ANT_EL `[-90,90]` without float rounding. Generic-schema header scalars now validate `ADIF_VER`, `CREATED_TIMESTAMP`, `PROGRAMID` and `PROGRAMVERSION` without fetching external schemas; the focused transfer file passes **247 tests** and TypeScript passes. Remaining full-schema/package, live external-sync and installed roundtrip acceptance stay open. |
| Immutable remote-backup execution foundation | **Active after installed alpha.23 / partial BACKUP-01** | UUID-bound durable authorization `52327f3`, live-worker snapshot/lifecycle integration `4ac6edb`, exclusive Dropbox transport `cec2f8f`, native credential seam `ba7c86d`, approval/start owner `eb6bd42` and durable verified registration owner `9a8f2e5` bind exact workspace, destination, account, vault service, dbid, generation and revision. Commit `6cf9665` now persists independently byte-verified Dropbox dbid/object/revision evidence and exposes a passive, default-off native retention review. Legacy proofless, ambiguous, foreign, failed/uncertain, clock-anomalous and required-newest receipts stay protected. **73 native**, **107 portable** and **4 lifecycle** checks pass at injected/mock boundaries. No deletion executor or capability exists; explicit deletion consent, fresh remote revalidation, revision-conditional deletion, durable unknown-outcome recovery, production OAuth and other providers remain open. |
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
8. **Active next:** Station Identity, retained Alerts, saved Antenna Reference,
   compact desk-split Logbook and the single-owner Sync refresh prerequisite are
   source-complete at their bounded scopes. Finish generation-bound Sync mutation
   ownership and the remaining panel inventory, then native lifecycle/geometry
   recovery; only then enable the full Windowed preset.
9. Package and live-accept RADIO-05 Clear after QSY, now source-complete with
   trusted observed-RX provenance, editor veto, selection/command epochs and an
   idempotent native transaction. Keep the default OFF until the operator opts in.
10. Finish DATA-10 remaining XSD/RANGE/live-sync/package acceptance; implement
    BACKUP-01 real provider executors, credentials, authenticated receipts,
    approval/start UI and revision-conditional retention deletion on the now-wired
    passive review owner; then close
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
| **Implemented in installed alpha.25 source; row-specific acceptance open** | UI-01–08, UI-10–16, UI-22–25, UI-27–38, UI-40–41, MAP-01–04, DATA-01–07, RADIO-01–05, PERF-02–03, SYNC-06 | Perform the packaged visual, live-service, latency, real-feed or hardware checks named in the tracker; no RF inference. RADIO-05 remains default-off until separately authorized live acceptance. |
| **Active / partial** | UI-09, UI-18–21, SYNC-02, DATA-08–11, BACKUP-01, PERF-01, WS-01–08, RUM-01–03, SHIP-01 | DATA-10 has reviewed UTF-8/Windows-1252/ISO-8859-1 ADI, UTF-8 ADX, 33-field duplicate updates, typed/pattern checks, versioned APP/USERDEF metadata with exact RANGE semantics, strict structural rejection and exact AGE/A-index/antenna-angle bounds; full XSD/live-sync/package acceptance remains. BACKUP-01 now has UUID-bound durable consent, default-off live-worker lifecycle, exclusive independently verified Dropbox execution, just-in-time workspace-vault credentials, hidden approval/start ownership and durable verified-registration metadata, but no production OAuth verifier/provisioner, deliberate UI/IPC exposure, retention execution or other providers. DATA-11's feedback path is audited. Agent-restart lifecycle hardening awaits installed restart acceptance; exact Standby drive rollback remains an active Agent defect. |

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
