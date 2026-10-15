# OM0RX-xLog live project board

Last updated: 15 October 2026, after installing signed/notarized alpha.29 from
exact source `db7ed4734826ea90cfd69b345c4d6174778894e5`.
`/Applications/OM0RX-xLog.app` passes **33/33** isolated native checks from both
the source bundle and installed copy with `station_io: false`; Apple notarization,
Stapler and Gatekeeper pass. Installed live Wavelog synchronization is now
accepted: four safe remote contacts were imported, five linked contacts received
fresh confirmation/enrichment data and all six ambiguous records remained held
without uploads, deletions or conflicts. The operator intentionally left the Windows Remote
Station Agent off, so live reconnect, KPA/KAT/radio/rotor and RF acceptance were
not attempted. Windows Agent source commit `67d2902` now restores and verifies
the configured barefoot drive on Standby and the exact pre-Operate drive after a
failed or cancelled Operate request; Windows installation and physical readback
acceptance remain open.

A current-HEAD full code review is recorded in
[FULL_CODE_REVIEW_2026-10-15.md](FULL_CODE_REVIEW_2026-10-15.md). All ten
actionable review findings are closed in source and bound by focused
regressions. The current uncontended complete frontend suite passes 2,395/2,395
across 160 files, the
Rust/Tauri suite passes 460/460, and the focused portable Swift review set
passes 92/92. Synthetic responsive QA covers nine task surfaces at 360×640 and
1280×800 plus 37 Desk widths from 360 to 3,840 pixels. These results do not
close the explicitly listed Agent, installed-live, multi-display or hardware
acceptance boundaries.

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

**0.4.0-alpha.29**, exact packaged source
`db7ed4734826ea90cfd69b345c4d6174778894e5`, is installed as
`/Applications/OM0RX-xLog.app`. Both exact-source and installed acceptance reports
pass **33/33** station-I/O-disabled native checks. Apple accepted submission
`32bab250-0cbf-4100-a8fd-602587414954`; deep Developer ID verification,
Stapler and Gatekeeper pass. Pre-sync readback was **68,024 active contacts** and
QSO revision **68,239**. The accepted live sync now leaves **68,028 active
contacts**, zero dirty, outbox or conflict rows, QSO revision **68,248** and
SQLite quick-check `ok`. One installed host/worker pair started and
closed cleanly. Alpha.28, the prior 0.3.0 and alpha.27 apps are recoverable from
Trash and the rechecked 1.7 GB backup remains intact. See
[alpha.29 evidence](releases/v0.4.0-alpha.29-macos.md).

Post-alpha.29 source `468bbfd30974238789e37422aa21aeb0c7480270` is now
packaged as an ad-hoc macOS development
bundle and passes the isolated native suite with every emitted check green and
`station_io: false`; it is not installed, notarized or accepted against the
operator workspace. See the
[post-alpha.29 source-bundle report](MACOS_POST_ALPHA29_SOURCE_ACCEPTANCE_2026-10-15.md).
The same report records the QRZ/WSJT-X checkpoint `6e3ca27` and the later
Club Log checkpoint `6df02197138d1ff3e7f622595c2671ca668182dc`: the latest
rebuilt ad-hoc bundle passes a fresh **33/33** isolated run with
`station_io: false`. The app remains uninstalled and live provider/device
acceptance remains open.
Exact source `c214d5dcf6dfccb707379b1aeb471428f696c85f` packages the later
held-record review UI in the same uninstalled development bundle. A fresh
isolated run again passes **33/33** with the embedded renderer, staged worker and
`station_io: false`. Its private fixture does not contain the six live held
records, so their packaged/live visual follow-up remains open.

The installed alpha.29 source retains alpha.28's full-control defaults across
Remote Agent, Hamlib, Direct FLEX and local CAT-client connection surfaces
(`e04acef`), while
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
  source-verified and included in the installed alpha.29 bundle. Alpha.29 also
  completes reviewed ADX record-field validation and closes all twelve actionable
  findings from the final UI/runtime, station-safety and data/sync review at
  `db7ed47`, including connection-generation fencing, shutdown release ordering,
  Wavelog destination protection and conflict-safe bounded synchronization.

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
| Full validation and review | **Packaged / installed** | Frontend **2,387/2,387 across 159 files**, Rust **432 unit + 18 integration**, native Swift **173/173 across 25 suites**, and full portable Swift (XStation **17**, XLogPrototype XCTest **200** with four intentional benchmark skips, XCluster **56**, Swift Testing **376/376 across 51 suites**) pass. Production build, bundle gates, source and installed **33/33** native acceptance, Developer ID, notarization, Stapler, Gatekeeper and `git diff --check` pass at `db7ed47`. |
| Independent native Settings child | **Installed / visual acceptance open** | Commit `0ea919a`; tenth singleton native role, open/focus/Dock lifecycle, scoped non-hardware authority, main-absent renderer and dirty/remount/conflict recovery pass. Its Rotator tab consumes the shared passive configuration source. Included in alpha.23; exhaustive child-window visual/recovery acceptance remains open. |
| Shared revisioned rotor configuration | **Done / installed for saved DCU-1 reconnect / motion acceptance open** | Commit `46c5f1e` provides SQLite-owned generation/revision state, durable receipts, restore fencing and Settings Rotator UI. Commit `73c2bc1` adds a native, once-only saved DCU-1 startup connection with durable pending/acknowledged/unknown lifecycle receipts, exact workspace/config/owner fences and explicit-disconnect suppression. Its only mapped backend request is `station_rotor_connect`; no Turn, Stop or motion request exists in startup. Alpha.27 automatically resumed saved ARCO after relaunch and displayed observed 173 degrees, Connected and Stopped without a motion request. **67 native** and **25 rotor frontend** tests plus TypeScript pass. Physical-motion acceptance remains open; Hamlib rotor startup remains explicit. |
| Independent Chaser & DX selection | **Source recovery fix ready / installed acceptance open** | Passive child `42f7b6c`; protected draft selection `617fd0e`. Commit `cad8913` closes the alpha.27 stale-receipt regression: terminal uncertain operations with no active native reservation permit a fresh selection immediately, while explicit Check/retire recovery survives remount and cannot replay the old Tune or rotor effect. **50 focused frontend** and **29 native activation/authority** tests plus TypeScript pass. The child still cannot issue station, rotor or CW effects; active CW requires explicit Stop. Installed live-service selection acceptance remains open. |
| Shared Station Control owner | **Packaged isolated / partial ownership / hardware acceptance open** | Provider setup/lifecycle through `d4d8bb0`, explicit Hamlib catalogue `702cddf`, exact Direct FLEX receive controls through `77c15f2`, and exact Remote Agent receive-frequency/mode controls at `e909184`. Agent and FLEX child controls require fresh observed RX/PTT-off VFO A evidence, advertised provider capability, exact setup/selection/control/connection generations and a durable receipt; one observed sample cannot issue twice. Agent completion rejects ACK-only and optimistic state, requiring a later authoritative VFO-A readback with the exact target. Full **2,397 frontend**, **460 Rust** and portable Swift gates pass; exact Agent package source `e909184` passes isolated **33/33** native acceptance with `station_io: false` and strict signing. Hamlib receive controls remain hidden; hardware profiles remain CAS-blocked. See [Agent package acceptance](DIRECT_AGENT_RECEIVE_CONTROL_SOURCE_ACCEPTANCE_2026-10-15.md) and [FLEX mode package acceptance](DIRECT_FLEX_RECEIVE_MODE_SOURCE_ACCEPTANCE_2026-10-15.md). |
| Normal split safety and KPA Operate admission | **Client installed / Agent rollback source fixed / physical acceptance open** | xLog's rule is VFO-derived rather than offset/band-specific, with explicit 20 m coverage for RX 14.200 / TX 14.230 MHz; it suppresses only the exact known RX-versus-TX diagnostic when the observed distinct VFOs, confirmed TX path and Receive state agree. **19 adjacent decoder/observation tests** pass. Windows Agent source `4e9638a` and canonical deployment `6f55ea8` proved the TX-VFO route earlier: guarded `station_operate` returned HTTP 200 in 2847.4 ms at RX A 24.940 / TX B 24.945 MHz, KAT memory 24.945, READY, no alarms and no recovery requirement. Across 22 samples and an 11-second follow-up, MOX stayed off and RF output stayed 0 W. Alpha.25 installs commit `f100d84`: only Tune requires CAT transmit permission; guarded Operate still requires current Agent-advertised action, lifecycle stability and real station inhibitors. Source commit `e04acef` makes every Agent, Hamlib, Direct FLEX and local CAT-client connection start with full controls, preserves an explicit receive-only choice, and restores the full-control default after a new selection or configuration revision. Windows Agent commit `67d2902` closes the observed drive defect: explicit Standby restores and proves configured barefoot drive, while failed/cancelled Operate restores the exact freshly observed pre-Operate drive before releasing the transaction. An incomplete KPA or drive rollback returns structured `operate-rollback-incomplete` evidence. **131 focused station/Agent/policy tests** pass. The Agent was off during this source fix, so the earlier KAT fault 2, empty HTTP 502 and physical 12 m 90 W restoration require a fresh installed Windows acceptance. No PTT, Tune or CWX command was issued. See [Agent rollback evidence](WINDOWS_AGENT_DRIVE_ROLLBACK_SOURCE_FIX_2026-10-15.md). |
| Clear after QSY (RADIO-05) | **Installed / default off / live acceptance open** | Commit `1d0b520` clears only after two distinct fresh observed-RX samples agree on the changed receive frequency; arbitrary split TX is ignored rather than inferred. Reconnect, stale data, first samples, radio/cluster selection changes, command epochs, active edits and worker/workspace generation changes veto the transaction. The native-only mutation uses an editor barrier and durable idempotent receipt; urgent release controls remain available. Legacy settings decode OFF. **3 Swift**, **16 Settings UI**, **4 QSY**, **12 cluster**, **18 activation**, **42 station-selection** and **1 native-boundary** focused tests pass. Raw Hamlib remains conservatively ineligible; `direct_agent` and `direct_flex_lan` are supported. |
| Compact desk-split Logbook | **Installed / visually observed** | Commit `6ef5748` uses the existing explicit Desk presentation context rather than a viewport guess. Alpha.25 visibly shows only Columns, the contact table and pagination in the Desk split; search/import/export/edit/delete/selection controls remain in dedicated, canvas-docked and detached Logbook views. Row Enter/double-click editing and column focus recovery remain available. **39 focused tests** plus TypeScript, diff and packaged acceptance checks pass. |
| Retained map resizing in split layouts | **Source regression fix ready / installed acceptance open** | User evidence exposed competing MapLibre/application resize observers, a hidden 400×300 fallback and repeated wrapped-world camera fitting. Commit `29b5077` makes the application the single resize owner, repaints after the final positive geometry frame and never refits the camera for a pure pane-size change. **36 focused Map/Desk tests** plus TypeScript pass. Installed divider and above/below visual acceptance remains open. |
| Detached task surfaces and multi-Band Maps | **Installed / packaged acceptance passed / operator visual follow-up open** | Commits `5db24db`, `3fcc4e0`, `a8f9192`, `0a96ede` and `cfa7638` remove unrelated global banners/header strips from all nineteen direct-menu task roles while preserving functional recovery and safety evidence. Detached Logbook has the requested compact one-line controls. Spot History persists column visibility and width controls (`1c37043`). The Window menu opens 13 independently keyed Band Maps with compact CW/Phone/Data settings (`401e86d`). Exact-source and installed alpha.29 33-check acceptance prove retained renderer/window lifecycles, Band Map state and Spot History main-destruction recovery; browser QA covered 14 task surfaces at 360×640 without horizontal overflow. Operator multi-display review remains open. |
| Propagation freshness | **Installed / live transport accepted / visual follow-up open** | Commit `6787270` removes the worker-side click throttle, coalesces concurrent fetches, adds a native ten-minute cache TTL and probes freshness every 60 seconds plus mount/focus. Explicit Refresh always attempts a new fetch; a lost reply recovers retained evidence without replaying a network request. Frontend **4/4**, native **5/5** and the fixture-backed Swift service suite pass. On 15 October, a new default-disabled live probe exercised the packaged production transport/parser twice in 4.440s and returned current SFI 136, A 13, K 2 and all five band groups with `stale: false`. Installed-header visual freshness and outage observation remain open. See [live propagation acceptance](LIVE_PROPAGATION_ACCEPTANCE_2026-10-15.md). |
| WSJT-X Logged ADIF intake | **Source integration extended / live WSJT-X acceptance open** | Commit `d9b46da` adds explicit receive-only loopback/multicast UDP intake for official message type 12. One accepted WSJT-X Log QSO action writes locally through the existing ADIF and semantic duplicate boundary; no packet, CAT, PTT, Tune, CW or radio command can be emitted. Post-alpha.29 source also makes only a semantically new Logged ADIF contact eligible for already-enabled prospective online-log enrollment in the same transaction; duplicate packets and generic imports remain excluded. Native bridge **7/7** and online-delivery **13/13** focused checks pass. |
| Optional QRZ / Club Log / HRDLOG delivery | **QRZ + Club Log source ready / live acceptance open; HRDLOG deferred pending official contract** | QRZ and Club Log now have independent Keychain credentials, default-off prospective-only enrollment with explicit confirmation, immutable one-record claims, renderer-independent delivery, ambiguous-outcome no-replay, immediate credential removal and aggregate-only local health. Club Log uses only `realtime.php`; any known non-200 atomically records rejection, disables only Club Log and cancels its remaining queue, satisfying the provider's 403/firewall rule. Existing contacts, file imports, Wavelog pulls, edits and confirmation refreshes cannot enroll; only new manual or WSJT-X Logged ADIF contacts after each provider is enabled are eligible. No credential or live request was used. Live QRZ/Club Log account acceptance and rejected/uncertain review remain open. Official HRDLOG pages confirm real-time uploads and a dedicated upload code but do not publish the endpoint, wire schema, response, idempotency or retry contract needed for safe implementation. See [Club Log acceptance](CLUB_LOG_UPLOAD_FOUNDATION_ACCEPTANCE_2026-10-15.md) and [HRDLOG contract review](HRDLOG_CONTRACT_REVIEW_2026-10-15.md). |
| Windows Agent restart reconnection | **Done / installed / Agent-restart repetition open** | Alpha.26 installs commits `422bd2b` and `dd0eb3d`: one native startup resume uses the selected saved Direct Agent, existing durable selection/control fence and Keychain token, with full CAT/amplifier controls enabled by default. A fresh installed app launch automatically recovered `ready / Observed live` at 21.195000 MHz USB and ShackCQ connected; the opt-in checkbox was on and Tune simplex, PTT, VFO/split and Standby/Operate were available. Startup itself sent no station action and observed Receive, READY, KPA Operate and output 0 W. Explicit disconnect/forget, provider changes, newer controls or pending/unknown receipts still prevent resume. **10 startup-filter**, **44 Agent setup/control UI** and TypeScript checks pass. Repeating the acceptance across an actual subsequent Windows Agent process restart remains open. |
| Shared Sync refresh and mutation owner | **Installed base live accepted; documented-order package verified / installed live mutation open** | Commit `29ea0c0` provides one native summary monitor; `3134f7c` adds one shared mutation owner; alpha.27 includes target-epoch consent fencing at `0c4384a`. Alpha.28 applies fresh Wavelog confirmation/enrichment fields to an authoritative single or already-linked local contact. On 15 October, persisted automatic startup plus an acknowledged generation-fenced run imported four safe contacts and refreshed five linked contacts; no upload, delete, failure or conflict occurred. The six later held rows were valid confirmation/enrichment variants, not disposable duplicates. Source `24a7f9f` uses Wavelog API v2's documented ascending ADIF record-ID order and per-page `lastfetchedid` only when every page boundary and semantic identity agree; otherwise the prior fail-closed matcher still holds ambiguous groups. A fresh GET-only probe mapped all 68,040 remote IDs with zero held, zero local writes and zero remote writes; three safely mapped remote IDs are not yet local because the probe was read-only. The exact `df3b5e7` uninstalled bundle passes strict signing and 33/33 isolated checks with station I/O disabled. Installed automatic-sync and confirmation-refresh acceptance remain open. Commit `c214d5d` retains held-group review for any future dataset that cannot prove the documented join. See [live Wavelog acceptance](LIVE_WAVELOG_SYNC_ACCEPTANCE_2026-10-15.md) and [source-bundle evidence](MACOS_POST_ALPHA29_SOURCE_ACCEPTANCE_2026-10-15.md). |
| Reviewed ADIF/ADX transfer workflow | **Installed / DATA-10 live and large-file accepted** | Workflow through canonical DXCC `f380d95`, explicit ISO-8859-1 ADI `efcc329`, scalar/type checks `64e1010`, grid/reference checks `d8ac9d0`, versioned extension metadata `4ac6edb`, exact USERDEF RANGE enforcement `5fcc04f`, structural rejection `00efac8`, AGE/A-index bounds `fcbbe17` and antenna-angle bounds `16a1c4c`. Alpha.27 includes exact integer-family validation `8f481fb`, LAT/LON and uniform VUCC locators `c1bd710`, and five upload statuses, QRZ download, EQSL_AG and QSO_COMPLETE enums `c4515a6`. Alpha.28 includes `9b3a203`, adding signed ALTITUDE/MY_ALTITUDE and nonnegative DISTANCE/MAX_BURSTS decimal validation. Sources through `79ce6b9` enforce every published record scalar family while preserving exact spelling, precision, order and ADI fallback behavior. Alpha.29 passes packaged ADX semantic roundtrip, **38/38** installed large-log checks with 100,002 records and live reconciliation with fresh service confirmations. Any additional legacy encodings remain separately prioritized work; one large-log run is not percentile performance proof. |
| Immutable remote-backup execution foundation | **Frozen one-shot + authenticated probe + conditional retention source-complete / production OAuth unavailable / partial BACKUP-01** | UUID-bound durable authorization `52327f3`, live-worker snapshot/lifecycle integration `4ac6edb`, exclusive Dropbox transport `cec2f8f`, native credential seam `ba7c86d`, approval/start owner `eb6bd42` and durable verified registration owner `9a8f2e5` bind exact workspace, destination, account, vault service, dbid, generation and revision. Commit `6cf9665` persists independently byte-verified Dropbox dbid/object/revision evidence and a passive, default-off retention review. Commit `fb53bec` adds one native presentation owner and shared Backups panel. Commit `8ddab69` closes prepared-plan drift: approval and execution use one exact immutable backup ID/identity/byte sequence, and prepared recurrence is rejected before schedule enablement. Commit `1a5a4ff` adds a single bounded Dropbox account probe shared by setup and upload. Commit `d84d225` adds the native-only exact-key secure-store save/remove prerequisite. Commit `b437387` adds separately confirmed single-candidate retention deletion using Dropbox object ID plus `parent_rev`; it revalidates the exact retained review, workspace, destination, account, consent and credential around the request, and writes a durable non-replay marker before network I/O. Completed or ambiguous attempts remain visible but protected from a second delete. A presentation environment still remains uninstalled because the repository has no Dropbox application registration or trusted OAuth callback/refresh authority to obtain a token for that vault. Renderer input cannot supply plans, reviews, account proofs, credentials, package hashes, bytes or vault identities, and no deletion route is exposed over IPC. Full native and portable Swift suites, **22 backup UI checks**, TypeScript and production frontend build pass. No real credential, provider request, upload/delete or Keychain mutation was used; production OAuth, live authenticated upload/deletion/restore and installed acceptance remain open. See [frozen-plan acceptance](REMOTE_BACKUP_FROZEN_PLAN_ACCEPTANCE_2026-10-15.md). |
| Awards calculator and packaged performance | **Packaged isolated percentile acceptance / live contention open** | Commit `aad3886` removes unnecessary ordinary-JARL UTC construction while retaining date-sensitive rules. Exact source `cb5d450` then passes five independent 100,002-contact macOS runs at **39/39**: first Awards median/p95 **1,151/1,522 ms**, repeat **66/91 ms**, Logbook **229/244 ms**, rendered local intelligence **33/33 ms**, and six-screen navigation p95 **67–132 ms**. See [performance acceptance](PACKAGED_PERFORMANCE_ACCEPTANCE_2026-10-15.md). Operator-workspace/live-service contention, physical cold disk, memory pressure, multi-display and other-OS gates remain open. |
| Existing programme-reference feedback audit | **Source verified at existing scope** | Existing display-only POTA/SOTA/IOTA/WWFF/WWBOTA evidence is generation/draft/call fenced and never replaces operator input. **8 frontend** and **3 portable Swift** focused tests pass. User-observed POTA success is not proof of every live feed or packaged state. |
| Shared native CW owner and independent CW child | **Installed / partial windowing** | Owner `2cb7bac`; child `423bb73`. Desk and child share one provider/selection-fenced session; passive mount sends no output, only saved macro IDs cross IPC, and protected Close/Dock retains pending or unknown output. Registration-scoped cleanup cannot Stop another window's lease. Included in alpha.23 with `station_io: false`; physical keyer, radio and RF acceptance remain open. |
| Passive independent Rotor and Station Status | **Installed / partial windowing** | Rotor `adb125f` reads retained telemetry only and exposes no motion/setup/Stop authority. Station Status `39c447d` uses event-driven retained selection/telemetry with exact provider/generation/identity matching and exposes no connection, radio, transmit or rotor authority. Included in alpha.23; neither child starts polling, and exhaustive packaged visual/hardware acceptance remains open. |
| Shared Propagation owner and independent child | **Installed / partial windowing** | Commit `b969c68`; passive snapshot and explicit awaited/coalesced refresh share the existing injected Swift fetch/cache through one native projection. The prior 15-second main-renderer timer is removed. Child mount is passive, weather/control authority is hidden, and missing worker state is reported rather than silently created. Included in alpha.23; real-network and exhaustive packaged visual acceptance remain open. |
| Passive independent Station Identity | **Installed / live visual follow-up open** | Commit `8f5486a`; seventeenth singleton native role. It displays eight retained non-secret identity/revision fields fed only by existing authorized canonical Settings reads. Child mount performs no Settings RPC/default seed, poll, persistence, credential or device call. Settings/workspace/worker mutations invalidate availability and stale replies cannot restore it. **72 frontend**, **7 native identity/admission/lifecycle** and **17 registry** checks plus TypeScript pass. Alpha.28 packages the task-only responsive surface; operator visual review remains open. |
| Passive retained Alerts | **Installed / live-hardware acceptance open** | Commit `749d1ac`; eighteenth singleton native role. A closed native aggregation exposes only modeled Agent safety-inhibitor/alarm presence and rotor uncertainty codes from existing retained owners. Payload-free wakes add no timer/poller, owner initialization, control, acknowledgement or persistence. The UI says retained reports are not a live all-clear and excludes broader sync/CW/backup claims. **73 frontend**, **7 native Alerts/admission/lifecycle** and **18 registry** checks plus TypeScript pass. Alpha.28 packages the task-only responsive surface; the powered-off Agent prevents live report acceptance. |
| Passive saved Antenna Reference | **Installed / hardware acceptance open** | Commit `5642563`; nineteenth singleton native role. It reuses the canonical fenced Settings projection and Desk antenna renderer without new storage, Settings RPC, timer, polling, selection, matching or RF authority. Missing, hidden and automatic profiles do not fabricate an installed antenna. **76 frontend**, **5 native antenna/admission/lifecycle**, **6 shared-projection** and **19 registry** checks plus TypeScript pass. Alpha.28 packages the task-only responsive surface; physical antenna-profile acceptance remains open. |
| Remaining Station Control ownership | **Active / dependency split** | Direct FLEX and Remote Agent exact VFO-A receive frequency/mode are source-complete and package-isolated. Hardware-profile apply requires Agent-side config revision/ETag plus conditional PUT/If-Match. Hamlib exact-target parity and discovery/SmartLink remain separate. Installed physical acceptance is still required for both implemented providers. |

## Dependency-ordered delivery queue

1. **Installed at isolated-package scope:** revision-safe Settings, including
   restore and unknown-outcome recovery (`b58163f`); alpha.29 packaged acceptance
   exercises Settings save/readback with station I/O disabled.
2. **Installed / operator visual acceptance open:** independent Settings child
   with dirty-form/navigation/restart recovery and main-renderer-independent
   scoped services (`0ea919a`).
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
7. **Dependency-split:** Direct FLEX exact VFO-A receive frequency/mode
   (`568ffb0`, `77c15f2`) and Remote Agent exact VFO-A receive frequency/mode
   (`e909184`) are source-complete and package-isolated. Hamlib exact-target
   parity remains open; hardware-profile apply still needs Agent conditional
   writes. Do not duplicate owners while that prerequisite is absent.
8. **Installed / operator visual acceptance open:** all nineteen detached task
   roles, compact desk-split Logbook and Canvas/Separate Windows are packaged.
   Alpha.29's source and installed 33-check runs cover native routes, detached
   lifecycles, main-window-absent Spot History recovery, Band Map state and
   workspace persistence without station I/O. Mixed-display visual acceptance
   and remaining shared provider/action ownership stay open.
9. Package and live-accept RADIO-05 Clear after QSY, now source-complete with
   trusted observed-RX provenance, editor veto, selection/command epochs and an
   idempotent native transaction. Keep the default OFF until the operator opts in.
10. **Live Wavelog acceptance, BACKUP-01 frozen-plan preparation, native
    credential-vault mutation and revision-conditional retention source paths
    complete;** register the Dropbox app and complete trusted production OAuth,
    live upload/deletion/restore acceptance and installed acceptance; then close
    remaining RUMlog gaps and provider adapters.
11. Run packaged cross-platform, percentile large-log performance and separately
   authorized hardware acceptance. Do not collapse these into source evidence.

## Workspace/native-window programme

| ID | Outcome | Status |
| --- | --- | --- |
| WS-01 | Show/hide/move/resize every desk panel | **Source complete / acceptance** — `5a74363` implements the requested model: each arrow toggles edit mode, title bars move, all eight edges/corners resize, Lock exits editing, Fit is secondary and internal content reflows or scrolls. Canvas **26/26**, transport **5/5** and TypeScript pass; installed multiple-display interaction remains open. |
| WS-02 | Settings-managed named layouts | **Source complete / packaged acceptance** — revisioned persistence/UI supports duplicate, rename, activate, delete and restore with conflict/lost-acknowledgement recovery. Alpha.29's isolated native run exercises save-without-activation, activation, rename, Settings remount, Traditional restore and unchanged shared draft through rendered controls; operator multi-display review remains open. |
| WS-03 | Native menus replace navigation | **Source complete / acceptance** — `33dfae7` adds checked native Canvas/Separate Windows choices, persists the mode and exact prior Canvas preset, retains open task windows and hides the main canvas only after authoritative save. Dirty editors, layout transactions and armed/pending CW veto the switch; the switch emits no device action. TypeScript, **59 frontend**, **66 Rust** and **16 Swift** layout tests pass. |
| WS-04 | Window menu opens/focuses every panel | **Source complete / packaged acceptance** — all nineteen task roles are available with consistent task-first chrome; alpha.29's source and installed native runs exercise menu routing, detached lifecycles and main-window-absent recovery. Operator multi-display visual acceptance remains open. |
| WS-05 | Docked/mixed/undocked share one live session | **In progress** — major draft/cluster/radio/rotor ownership, Desk CW and shared Desk/child Agent lifecycle moved; remaining provider/action owners open. |
| WS-06 | Layout/geometry survive restart and display changes | **In progress / acceptance** — persistence/recovery source exists; `3cb27f4` prevents a cancelled close from retiring a still-live window's geometry tracker, with **22 focused native geometry tests**. Mixed-DPI/native evidence remains open. |
| WS-07 | No duplicate logging or station actions | **In progress** — Settings and rotor-configuration receipts plus one protected Chaser draft-activation owner are source-verified; Chaser has no raw station/rotor/CW authority. Full multi-window gate remains open. |
| WS-08 | Responsive, accessible, measured laptop/4K UI | **Source complete / acceptance** — detached task chrome, intrinsic intelligence sizing, compact Logbook toolbar, accessible canvas resize/Fit and configurable Spot History columns are source-ready. Five ad-hoc packaged 100,002-contact runs pass 39/39 and record launch plus painted navigation distributions; synthetic responsive QA covers 360–3,840 px. Physical laptop/4K, multi-display/DPI, assistive-technology and operator-workspace checks remain open. |

## Operator feedback portfolio

The compact status below deliberately separates implementation from remaining
acceptance. Consult the detailed tracker before closing any individual item.

| Status | IDs | Remaining boundary |
| --- | --- | --- |
| **Done / installed at stated scope** | UI-17, UI-26, UI-39, CW-01, CW-02, CW-03, CLUSTER-01, SYNC-01 | Some rows retain explicit hardware, alternate-OS or accessibility limits. |
| **Implemented in installed alpha.29 source; row-specific acceptance open** | UI-01–08, UI-10–25, UI-27–38, UI-40–41, MAP-01–04, DATA-01–07, RADIO-01–05, PERF-02–03, SYNC-02, SYNC-06 | Perform the packaged visual, live-service, latency, real-feed or hardware checks named in the tracker; no RF inference. RADIO-05 remains default-off until separately authorized live acceptance. UI-18–21 and SYNC-02 are source-verified after alpha.29; their installed/operator acceptance remains open. |
| **Active / partial** | UI-09, DATA-08–11, BACKUP-01, PERF-01, WS-01–08, RUM-01–03, SHIP-01 | DATA-10 has reviewed UTF-8/Windows-1252/ISO-8859-1 ADI, UTF-8 ADX, 33-field duplicate updates, versioned APP/USERDEF metadata with exact RANGE semantics, strict structural rejection and every published 3.1.7 record scalar type family. Alpha.29 adds a packaged ADX semantic round trip and **38/38** installed 100,002-record functional checks; live-sync acceptance remains. BACKUP-01 now has UUID-bound durable consent, default-off live-worker lifecycle, exclusive independently verified Dropbox execution, just-in-time workspace-vault credentials, native capability-gated setup/approval/start/status/recovery UI, durable verified-registration metadata, frozen-plan preparation and revision-fenced Dropbox retention deletion. Production OAuth/verifier provisioning, live upload/delete/restore acceptance and other providers remain open. DATA-11's feedback path is audited. Agent-restart lifecycle hardening and the corrected Standby/failed-Operate drive rollback both await installed Windows repetition; the rollback defect itself is closed in Agent source `67d2902`. |

## Major acceptance campaigns still open

- **Performance:** PERF-01 now has five-process isolated packaged median/p95 for
  launch/readiness, intelligence, Awards, Logbook and six-screen navigation.
  Physical cold disk, memory pressure, operator data and live background-load
  contention remain; PERF-03 installed/UI latency under realistic contention is
  still open.
- **Synchronization:** SYNC-02 complete standalone/Wavelog mode acceptance and
  SYNC-06 live bounded reconciliation without guessing held identities.
- **Station:** RADIO-01–04 physical/remote evidence only when separately
  authorized; Australia–Slovakia WAN delay must remain distinct from
  Windows-local device time. No RF action is implied by this board.
- **Data portability:** DATA-10 remaining legacy-encoding decisions and live-sync
  behavior. Packaged ADX semantic roundtrip and an installed 100,002-record
  functional run pass in alpha.29; realistic percentile performance remains
  under the separate performance campaign.
- **Backups:** BACKUP-01 secure account setup, encrypted transfer where available,
  retention, upload verification and tested restore without altering existing
  remote backups.
- **Cross-platform/windowing:** macOS, Windows and Linux route parity,
  main-renderer-absent operation, mixed DPI/negative origins, monitor disconnect,
  maximize/restore and window recovery.
- **RUMlog comparison:** RUM-01/02 read-only Settings, menu and installed-bundle
  help evidence is complete. The selected RUM-03 custom DX-alert foundation and
  native popup/optional-sound delivery are source-complete at `d37aeb6`, with
  no RF authority. Installed live-cluster notification acceptance remains open;
  do not add empty contest/QSL imitation features.
- **QLog comparison:** QLOG-01/02 read-only current-source inventory and gap
  decisions are complete at upstream commit `cbb75f2`. Named rules, structured
  spot conditions, merged repeat counts, expiry and separate delivery adapters
  inform the same alert slice. xLog improves the boundary with native
  generation/revision ownership, stable spot identities, explicit rate limits
  and no implicit tune action. QLOG-03 rule and native delivery source
  implementation plus macOS source-package acceptance are complete at
  `d37aeb6`: the native-owned popup and optional sound choices default off,
  enforce a three-per-ten-second delivery limit, expose suppressed counts and
  contain no action button or station authority. Focused native/renderer tests
  and the production bundle gate pass, strict deep signature verification
  passes, and the isolated integrated run passes 33/33 with station I/O disabled.
  Operator/live-cluster and actual macOS popup/sound acceptance remain open;
  speech and outbound UDP remain deferred. See the
  [QLog audit](QLOG_WORKFLOW_GAP_AUDIT_2026-10-15.md).

## Update discipline

Whenever work changes state:

1. Update the active-stage row and the relevant programme/portfolio status here.
2. Add exact tests, commit/build/package identity and acceptance limits to the
   detailed tracker or a release/source-acceptance document.
3. Move an item to **Done / installed** only after its stated installed/live gate
   is observed. Keep hardware, public-service and cross-platform claims explicit.
4. Preserve operator data and unfinished work; record any backup/rollback path
   before an installation or migration.
