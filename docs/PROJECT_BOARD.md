# OM0RX-xLog live project board

Last updated: 15 October 2026, after installing signed/notarized alpha.28 from
exact source `ab60d7dc347d84ef8b28e02bbc00bd3c94efe0fb`. The renamed
`/Applications/OM0RX-xLog.app` passes **32/32** isolated native checks from both
the source bundle and installed copy with `station_io: false`; Apple notarization,
Stapler and Gatekeeper pass. The operator intentionally left the Windows Remote
Station Agent off, so live reconnect, KPA/KAT/radio/rotor and RF acceptance were
not attempted. The Windows Agent's exact failed-apply and Standby drive rollback
remains a separate active defect.

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

**0.4.0-alpha.28**, exact packaged source
`ab60d7dc347d84ef8b28e02bbc00bd3c94efe0fb`, is installed as
`/Applications/OM0RX-xLog.app`. Both exact-source and installed acceptance reports
pass **32/32** station-I/O-disabled native checks. Apple accepted submission
`8957933a-7be0-44e6-81f3-c1ee5c2f7d06`; deep Developer ID verification,
Stapler and Gatekeeper pass. Immediate pre-install/post-launch readback remains
**68,024 active contacts**, zero dirty, outbox or conflict rows, QSO revision
**68,239** and SQLite quick-check `ok`. One installed host/worker pair started and
closed cleanly. The prior 0.3.0 and alpha.27 apps are recoverable from Trash and
the rechecked 1.7 GB backup. See
[alpha.28 evidence](releases/v0.4.0-alpha.28-macos.md).

The installed alpha.28 source adds full-control defaults across Remote Agent,
Hamlib, Direct FLEX and local CAT-client connection surfaces (`e04acef`), while
retaining an explicit receive-only choice and all real hardware/interlock gates.
It also adds four ADX decimal families (`9b3a203`) and keeps native geometry
tracking alive when an unsaved-edit or reservation guard cancels a close
(`3cb27f4`). A capability-gated Backups panel now exposes passive native status,
explicit setup/approval/start/stop and receipt recovery without accepting plans,
proofs or credentials from the renderer (`fb53bec`). Retained map resizing now
has one deterministic owner (`29b5077`); the shared canvas exposes visible
resize grips and a non-overlapping Fit-height action (`0fd445f`). Stale terminal
spot activations can be retired without replaying Tune or rotor effects
(`cad8913`). Detached task windows remove unrelated global chrome and the
Logbook uses its requested compact toolbar (`5db24db`, `3fcc4e0`). Spot History
adds persisted visible columns and accessible width resizing (`1c37043`). The
Window menu can open 13 independently keyed Band Maps with per-band CW, Phone
  and Data visibility (`401e86d`). Commit `cfa7638` applies the same task-first
  detached-window contract to all nineteen roles; `5a74363` adds traditional
  title dragging and eight-edge/corner panel resizing; `33dfae7` persists Canvas
  versus Separate Windows while restoring the exact prior Canvas preset.
  `6787270` gives propagation one coalesced native freshness owner plus explicit
  refresh. `b569d15` renames the product to **OM0RX-xLog** and introduces original
  desktop/in-app brand assets while retaining the existing bundle identifier for
  data and Keychain continuity. `d9b46da` adds opt-in, receive-only WSJT-X Logged
  ADIF intake with local semantic duplicate suppression. These changes are
  source-verified and included in the installed alpha.28 bundle.

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
  actions. Canvas and Separate Windows are now explicit persisted workspace modes;
  exact-source and installed packaged native acceptance pass; live hardware
  acceptance remains open.

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
| Shared revisioned rotor configuration | **Done / installed for saved DCU-1 reconnect / motion acceptance open** | Commit `46c5f1e` provides SQLite-owned generation/revision state, durable receipts, restore fencing and Settings Rotator UI. Commit `73c2bc1` adds a native, once-only saved DCU-1 startup connection with durable pending/acknowledged/unknown lifecycle receipts, exact workspace/config/owner fences and explicit-disconnect suppression. Its only mapped backend request is `station_rotor_connect`; no Turn, Stop or motion request exists in startup. Alpha.27 automatically resumed saved ARCO after relaunch and displayed observed 173 degrees, Connected and Stopped without a motion request. **67 native** and **25 rotor frontend** tests plus TypeScript pass. Physical-motion acceptance remains open; Hamlib rotor startup remains explicit. |
| Independent Chaser & DX selection | **Source recovery fix ready / installed acceptance open** | Passive child `42f7b6c`; protected draft selection `617fd0e`. Commit `cad8913` closes the alpha.27 stale-receipt regression: terminal uncertain operations with no active native reservation permit a fresh selection immediately, while explicit Check/retire recovery survives remount and cannot replay the old Tune or rotor effect. **50 focused frontend** and **29 native activation/authority** tests plus TypeScript pass. The child still cannot issue station, rotor or CW effects; active CW requires explicit Stop. Installed live-service selection acceptance remains open. |
| Shared Station Control owner | **Source verified / partial ownership** | Provider setup/lifecycle through `d4d8bb0`, explicit Hamlib catalogue `702cddf`, and exact Direct FLEX receive-frequency action `568ffb0`. The child action requires fresh observed RX/PTT-off VFO A evidence, capability support, exact setup/selection/control/connection generations and a durable receipt; one observed sample cannot issue twice. **53 frontend**, **4 receive-native**, **77 station-owner** and **9 monitor-context** focused checks plus TypeScript pass. Agent/Hamlib receive controls and FLEX mode remain hidden because their backends lack the same exact target guarantees. Hardware profiles remain CAS-blocked. |
| Normal split safety and KPA Operate admission | **Client installed / full-control source fix ready / Agent rollback defect active** | xLog's rule is VFO-derived rather than offset/band-specific, with explicit 20 m coverage for RX 14.200 / TX 14.230 MHz; it suppresses only the exact known RX-versus-TX diagnostic when the observed distinct VFOs, confirmed TX path and Receive state agree. **19 adjacent decoder/observation tests** pass. Windows Agent source `4e9638a` and canonical deployment `6f55ea8` proved the TX-VFO route earlier: guarded `station_operate` returned HTTP 200 in 2847.4 ms at RX A 24.940 / TX B 24.945 MHz, KAT memory 24.945, READY, no alarms and no recovery requirement. Across 22 samples and an 11-second follow-up, MOX stayed off and RF output stayed 0 W. Alpha.25 installs commit `f100d84`: only Tune requires CAT transmit permission; guarded Operate still requires current Agent-advertised action, lifecycle stability and real station inhibitors. Source commit `e04acef` now makes every Agent, Hamlib, Direct FLEX and local CAT-client connection start with full controls, preserves an explicit receive-only choice, and restores the full-control default after a new selection or configuration revision. **58 focused shared/child/monitor control tests** plus TypeScript pass. Installed acceptance previously reached the Agent without the false CAT-consent rejection. The Agent then correctly rejected the request because FLEX changed from 24.940 to 24.941 MHz during route apply; KPA stayed Standby and output stayed 0 W. **Active Agent defects:** the aborted apply left drive at 25 W rather than restoring the 12 m barefoot 90 W value; an earlier Standby left 95 W and KAT fault 2, and a first retry returned an empty HTTP 502. The Agent must restore the exact route value, retain a confirmed fault-free path and return a structured recoverable error. No PTT, Tune or CWX command was issued. |
| Clear after QSY (RADIO-05) | **Installed / default off / live acceptance open** | Commit `1d0b520` clears only after two distinct fresh observed-RX samples agree on the changed receive frequency; arbitrary split TX is ignored rather than inferred. Reconnect, stale data, first samples, radio/cluster selection changes, command epochs, active edits and worker/workspace generation changes veto the transaction. The native-only mutation uses an editor barrier and durable idempotent receipt; urgent release controls remain available. Legacy settings decode OFF. **3 Swift**, **16 Settings UI**, **4 QSY**, **12 cluster**, **18 activation**, **42 station-selection** and **1 native-boundary** focused tests pass. Raw Hamlib remains conservatively ineligible; `direct_agent` and `direct_flex_lan` are supported. |
| Compact desk-split Logbook | **Installed / visually observed** | Commit `6ef5748` uses the existing explicit Desk presentation context rather than a viewport guess. Alpha.25 visibly shows only Columns, the contact table and pagination in the Desk split; search/import/export/edit/delete/selection controls remain in dedicated, canvas-docked and detached Logbook views. Row Enter/double-click editing and column focus recovery remain available. **39 focused tests** plus TypeScript, diff and packaged acceptance checks pass. |
| Retained map resizing in split layouts | **Source regression fix ready / installed acceptance open** | User evidence exposed competing MapLibre/application resize observers, a hidden 400×300 fallback and repeated wrapped-world camera fitting. Commit `29b5077` makes the application the single resize owner, repaints after the final positive geometry frame and never refits the camera for a pure pane-size change. **36 focused Map/Desk tests** plus TypeScript pass. Installed divider and above/below visual acceptance remains open. |
| Detached task surfaces and multi-Band Maps | **Installed / packaged acceptance passed / operator visual follow-up open** | Commits `5db24db`, `3fcc4e0`, `a8f9192`, `0a96ede` and `cfa7638` remove unrelated global banners/header strips from all nineteen direct-menu task roles while preserving functional recovery and safety evidence. Detached Logbook has the requested compact one-line controls. Spot History persists column visibility and width controls (`1c37043`). The Window menu opens 13 independently keyed Band Maps with compact CW/Phone/Data settings (`401e86d`). Exact-source and installed 32-check acceptance prove retained renderer/window lifecycles, Band Map state and Spot History main-destruction recovery; browser QA covered 14 task surfaces at 360×640 without horizontal overflow. Operator multi-display review remains open. |
| Propagation freshness | **Installed / real-network acceptance open** | Commit `6787270` removes the worker-side click throttle, coalesces concurrent fetches, adds a native ten-minute cache TTL and probes freshness every 60 seconds plus mount/focus. Explicit Refresh always attempts a new fetch; a lost reply recovers retained evidence without replaying a network request. Frontend **4/4**, native **5/5** and Swift service **6/6** focused checks pass. The isolated package cannot contact N0NBH/HamQSL, so real-network freshness remains an operator acceptance item. |
| WSJT-X Logged ADIF intake | **Installed / live WSJT-X acceptance open** | Commit `d9b46da` adds explicit receive-only loopback/multicast UDP intake for official message type 12. One accepted WSJT-X Log QSO action writes locally through the existing ADIF and semantic duplicate boundary; no packet, CAT, PTT, Tune, CW or radio command can be emitted. Native **5/5**, Settings/UI **24/24**, Rust authority **44/44** and TypeScript checks pass. |
| Optional QRZ / Club Log / HRDLOG delivery | **Researched / queued** | Official contracts show these are independent upload services, not replacements for Wavelog's two-way reconciliation. QRZ needs a per-logbook API key; Club Log needs a product API key and user Application Password and requires immediate disablement after HTTP 403; HRDLOG uses a dedicated upload code. Implement only with Keychain secrets, per-service durable receipts, bounded retry, truthful upload-only wording and fixture plus live-account acceptance. No credential or live request was used during the RUMlog audit. |
| Windows Agent restart reconnection | **Done / installed / Agent-restart repetition open** | Alpha.26 installs commits `422bd2b` and `dd0eb3d`: one native startup resume uses the selected saved Direct Agent, existing durable selection/control fence and Keychain token, with full CAT/amplifier controls enabled by default. A fresh installed app launch automatically recovered `ready / Observed live` at 21.195000 MHz USB and ShackCQ connected; the opt-in checkbox was on and Tune simplex, PTT, VFO/split and Standby/Operate were available. Startup itself sent no station action and observed Receive, READY, KPA Operate and output 0 W. Explicit disconnect/forget, provider changes, newer controls or pending/unknown receipts still prevent resume. **10 startup-filter**, **44 Agent setup/control UI** and TypeScript checks pass. Repeating the acceptance across an actual subsequent Windows Agent process restart remains open. |
| Shared Sync refresh and mutation owner | **Installed / safe confirmation reconciliation active** | Commit `29ea0c0` provides one native summary monitor; `3134f7c` adds one shared mutation owner; alpha.27 includes target-epoch consent fencing at `0c4384a`. Alpha.28 now applies fresh Wavelog confirmation/enrichment fields to an authoritative single or already-linked local contact. Same-identity records with multiple remote IDs and differing ADIF details remain visibly held and unchanged; the implementation does not borrow confirmation data or guess an ID. Immediate installed readback is 68,024 active contacts with zero dirty, outbox or conflict rows. Live automatic-sync repetition remains an operator acceptance item. |
| Reviewed ADIF/ADX transfer workflow | **Installed / partial DATA-10; next schema slice source-verified** | Workflow through canonical DXCC `f380d95`, explicit ISO-8859-1 ADI `efcc329`, scalar/type checks `64e1010`, grid/reference checks `d8ac9d0`, versioned extension metadata `4ac6edb`, exact USERDEF RANGE enforcement `5fcc04f`, structural rejection `00efac8`, AGE/A-index bounds `fcbbe17` and antenna-angle bounds `16a1c4c`. Alpha.27 includes exact integer-family validation `8f481fb`, LAT/LON and uniform VUCC locators `c1bd710`, and five upload statuses, QRZ download, EQSL_AG and QSO_COMPLETE enums `c4515a6`. Alpha.28 includes `9b3a203`, adding signed ALTITUDE/MY_ALTITUDE and nonnegative DISTANCE/MAX_BURSTS decimal validation. Source `8f5755f` adds the official `GUEST_OP`/`VE_PROV` elements and exact Band, Mode, ARRL section, Morse-key, propagation-mode and Region validation at both ADX boundaries, with matching native USERDEF collision fences. Accepted spelling, precision and order remain exact and invalid ADX fails closed without changing ADI fallback behavior. Full frontend **158/2,207**, transfer **910/910**, portable Swift **173/25** and production build pass. Remaining string/list/schema families, full-schema/live-sync and installed import/export roundtrip acceptance stay open. |
| Immutable remote-backup execution foundation | **Source UI/IPC exposed / production capability unavailable / partial BACKUP-01** | UUID-bound durable authorization `52327f3`, live-worker snapshot/lifecycle integration `4ac6edb`, exclusive Dropbox transport `cec2f8f`, native credential seam `ba7c86d`, approval/start owner `eb6bd42` and durable verified registration owner `9a8f2e5` bind exact workspace, destination, account, vault service, dbid, generation and revision. Commit `6cf9665` persists independently byte-verified Dropbox dbid/object/revision evidence and a passive, default-off retention review. Commit `fb53bec` adds one native presentation owner and shared Backups panel: passive production status is visible, while setup verification, approval, Start, Stop and receipt-only recovery appear only when trusted native capability exists. Renderer input cannot supply plans, account proofs, credentials, package hashes or vault identities. Legacy proofless, ambiguous, foreign, failed/uncertain, clock-anomalous and required-newest receipts stay protected. The new slice passes **6 presentation + 19 service + 34 frontend + 1 Rust authority** checks plus TypeScript. No OAuth, real credential, remote upload/delete or deletion executor was added or used; production provisioning, frozen-plan preparation, retention execution and installed acceptance remain open. |
| Awards calculator bounded optimization | **Source verified / PERF acceptance open** | Commit `aad3886`; active ordinary JARL entities avoid unnecessary UTC date construction while deleted/designated-date rules retain exact UTC boundaries. The generated 100,000-contact calculator median improved **26.6–35.0%** across observed runs and all nine award totals remained exact. This is not packaged cold-open, database or UI median/p95 evidence. |
| Existing programme-reference feedback audit | **Source verified at existing scope** | Existing display-only POTA/SOTA/IOTA/WWFF/WWBOTA evidence is generation/draft/call fenced and never replaces operator input. **8 frontend** and **3 portable Swift** focused tests pass. User-observed POTA success is not proof of every live feed or packaged state. |
| Shared native CW owner and independent CW child | **Installed / partial windowing** | Owner `2cb7bac`; child `423bb73`. Desk and child share one provider/selection-fenced session; passive mount sends no output, only saved macro IDs cross IPC, and protected Close/Dock retains pending or unknown output. Registration-scoped cleanup cannot Stop another window's lease. Included in alpha.23 with `station_io: false`; physical keyer, radio and RF acceptance remain open. |
| Passive independent Rotor and Station Status | **Installed / partial windowing** | Rotor `adb125f` reads retained telemetry only and exposes no motion/setup/Stop authority. Station Status `39c447d` uses event-driven retained selection/telemetry with exact provider/generation/identity matching and exposes no connection, radio, transmit or rotor authority. Included in alpha.23; neither child starts polling, and exhaustive packaged visual/hardware acceptance remains open. |
| Shared Propagation owner and independent child | **Installed / partial windowing** | Commit `b969c68`; passive snapshot and explicit awaited/coalesced refresh share the existing injected Swift fetch/cache through one native projection. The prior 15-second main-renderer timer is removed. Child mount is passive, weather/control authority is hidden, and missing worker state is reported rather than silently created. Included in alpha.23; real-network and exhaustive packaged visual acceptance remain open. |
| Passive independent Station Identity | **Installed / live visual follow-up open** | Commit `8f5486a`; seventeenth singleton native role. It displays eight retained non-secret identity/revision fields fed only by existing authorized canonical Settings reads. Child mount performs no Settings RPC/default seed, poll, persistence, credential or device call. Settings/workspace/worker mutations invalidate availability and stale replies cannot restore it. **72 frontend**, **7 native identity/admission/lifecycle** and **17 registry** checks plus TypeScript pass. Alpha.28 packages the task-only responsive surface; operator visual review remains open. |
| Passive retained Alerts | **Installed / live-hardware acceptance open** | Commit `749d1ac`; eighteenth singleton native role. A closed native aggregation exposes only modeled Agent safety-inhibitor/alarm presence and rotor uncertainty codes from existing retained owners. Payload-free wakes add no timer/poller, owner initialization, control, acknowledgement or persistence. The UI says retained reports are not a live all-clear and excludes broader sync/CW/backup claims. **73 frontend**, **7 native Alerts/admission/lifecycle** and **18 registry** checks plus TypeScript pass. Alpha.28 packages the task-only responsive surface; the powered-off Agent prevents live report acceptance. |
| Passive saved Antenna Reference | **Installed / hardware acceptance open** | Commit `5642563`; nineteenth singleton native role. It reuses the canonical fenced Settings projection and Desk antenna renderer without new storage, Settings RPC, timer, polling, selection, matching or RF authority. Missing, hidden and automatic profiles do not fabricate an installed antenna. **76 frontend**, **5 native antenna/admission/lifecycle**, **6 shared-projection** and **19 registry** checks plus TypeScript pass. Alpha.28 packages the task-only responsive surface; physical antenna-profile acceptance remains open. |
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
    source-complete at their bounded scopes. Generation-bound Sync mutation
    ownership is also source-complete. Finish the remaining panel inventory and
    native lifecycle/geometry recovery; only then enable the full Windowed preset.
9. Package and live-accept RADIO-05 Clear after QSY, now source-complete with
   trusted observed-RX provenance, editor veto, selection/command epochs and an
   idempotent native transaction. Keep the default OFF until the operator opts in.
10. Finish DATA-10 remaining XSD/RANGE/live-sync/package acceptance; complete
    BACKUP-01 production provisioning, frozen-plan preparation and authenticated
    provider capability, then add revision-conditional retention deletion on the
    now-wired review owner; then close
    remaining RUMlog gaps.
11. Run packaged cross-platform, large-log performance, live sync and separately
   authorized hardware acceptance. Do not collapse these into source evidence.

## Workspace/native-window programme

| ID | Outcome | Status |
| --- | --- | --- |
| WS-01 | Show/hide/move/resize every desk panel | **Source complete / acceptance** — `5a74363` implements the requested model: each arrow toggles edit mode, title bars move, all eight edges/corners resize, Lock exits editing, Fit is secondary and internal content reflows or scrolls. Canvas **26/26**, transport **5/5** and TypeScript pass; installed multiple-display interaction remains open. |
| WS-02 | Settings-managed named layouts | **In progress** — revisioned persistence/UI, independent Settings and shared passive Rotator configuration are source-verified; packaged/native acceptance remains. |
| WS-03 | Native menus replace navigation | **Source complete / acceptance** — `33dfae7` adds checked native Canvas/Separate Windows choices, persists the mode and exact prior Canvas preset, retains open task windows and hides the main canvas only after authoritative save. Dirty editors, layout transactions and armed/pending CW veto the switch; the switch emits no device action. TypeScript, **59 frontend**, **66 Rust** and **16 Swift** layout tests pass. |
| WS-04 | Window menu opens/focuses every panel | **In progress** — nineteen roles now include independent Settings, passive Chaser & DX, Station Control, CW, Rotor, Station Status, Propagation, Station Identity, retained Alerts and saved Antenna Reference; remaining screens follow the dependency queue. |
| WS-05 | Docked/mixed/undocked share one live session | **In progress** — major draft/cluster/radio/rotor ownership, Desk CW and shared Desk/child Agent lifecycle moved; remaining provider/action owners open. |
| WS-06 | Layout/geometry survive restart and display changes | **In progress / acceptance** — persistence/recovery source exists; `3cb27f4` prevents a cancelled close from retiring a still-live window's geometry tracker, with **22 focused native geometry tests**. Mixed-DPI/native evidence remains open. |
| WS-07 | No duplicate logging or station actions | **In progress** — Settings and rotor-configuration receipts plus one protected Chaser draft-activation owner are source-verified; Chaser has no raw station/rotor/CW authority. Full multi-window gate remains open. |
| WS-08 | Responsive, accessible, measured laptop/4K UI | **In progress / acceptance** — detached task chrome, intrinsic intelligence sizing, compact Logbook toolbar, accessible canvas resize/Fit and configurable Spot History columns are source-ready. Whole-app native measurements and packaged laptop/4K checks remain open. |

## Operator feedback portfolio

The compact status below deliberately separates implementation from remaining
acceptance. Consult the detailed tracker before closing any individual item.

| Status | IDs | Remaining boundary |
| --- | --- | --- |
| **Done / installed at stated scope** | UI-17, UI-26, UI-39, CW-01, CW-02, CW-03, CLUSTER-01, SYNC-01 | Some rows retain explicit hardware, alternate-OS or accessibility limits. |
| **Implemented in installed alpha.27 source; row-specific acceptance open** | UI-01–08, UI-10–16, UI-22–25, UI-27–38, UI-40–41, MAP-01–04, DATA-01–07, RADIO-01–05, PERF-02–03, SYNC-06 | Perform the packaged visual, live-service, latency, real-feed or hardware checks named in the tracker; no RF inference. RADIO-05 remains default-off until separately authorized live acceptance. |
| **Active / partial** | UI-09, UI-18–21, SYNC-02, DATA-08–11, BACKUP-01, PERF-01, WS-01–08, RUM-01–03, SHIP-01 | DATA-10 has reviewed UTF-8/Windows-1252/ISO-8859-1 ADI, UTF-8 ADX, 33-field duplicate updates, typed/pattern checks, versioned APP/USERDEF metadata with exact RANGE semantics, strict structural rejection and exact AGE/A-index/antenna-angle/altitude/distance/burst bounds; full XSD/live-sync/package acceptance remains. BACKUP-01 now has UUID-bound durable consent, default-off live-worker lifecycle, exclusive independently verified Dropbox execution, just-in-time workspace-vault credentials, native capability-gated setup/approval/start/status/recovery UI and durable verified-registration metadata, but no production OAuth verifier/provisioner, frozen-plan preparation, retention execution or other providers. DATA-11's feedback path is audited. Agent-restart lifecycle hardening awaits installed restart acceptance; exact Standby drive rollback remains an active Agent defect. |

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
