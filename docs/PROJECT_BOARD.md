# OM0RX-xLog live project board

Last updated: 16 October 2026, after installing signed/notarized alpha.31 from
exact source `dd8dd642c650fc56522296860f6e2177c0804bcb`.
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

Full native TCI support for SunSDR/ExpertSDR and compatible TCI servers is now a
tracked feature. The official ExpertSDR3 protocol is normative and read-only QLog
behavior is an interoperability reference. The first source slice is complete: a bounded
case-insensitive incremental codec and discovery/state reducer passes **13/13** portable
tests after independent review. The second slice adds a native receive-only WebSocket actor
with explicit connect/disconnect, bounded input/observer queues, generation fencing, fresh
`READY` gating, no automatic reconnect/replay and teardown that cannot retain an abandoned
session; the combined focused suite passes **21/21**, including late old-connection rejection.
It still has no station authority.
Next are saved provider/telemetry and capability-fenced control with durable Tune/PTT owners.
No TCI command has been issued; package/live/hardware/RF acceptance is open.

Arbitrary ADIF contact editing is source complete. Existing Logbook contact/mutation
sessions now round-trip modeled and retained unknown/custom fields through pointer and
keyboard activation without a second log owner. Legacy optional values backfill on read
without silent rewriting or loss; explicit clears remain explicit. Focused Swift
**12/12**, sync identity **25/25**, frontend **72/72**, TypeScript and independent review
pass. Packaged macOS/manual copied-log acceptance remains open.

Current post-alpha.31 source moves Agent/FLEX carrier Tune from raw main/Monitor
dispatch into one durable native acquisition owner. It binds exact selection,
control, worker, connection and fresh idle-observation identities, persists before
one existing-worker send and never reconnects, retries or replays. Agent remains
acknowledged rather than RF-confirmed; FLEX requires newer TX-on evidence. Native
Tune/Cancel ordering survives reversed worker delivery, and selected-radio CW has
atomic acquisition plus a full-lifetime carrier veto, including cold-start journal
loading. Full frontend **2,574/2,574**, Rust **534/534**, focused portable Swift
**46/46**, production build and diff checks pass after two independent reviews.
Alpha.31 remains installed; package, live Agent/FLEX, RF and physical release
acceptance stay open. Independent WinKeyer keeps its separate local-output/lease
boundary.

Current source additionally gives main-only Agent/FLEX GUI PTT a durable native
owner with independent On acquisition and urgent owned Off lanes. Exact native
selection/control/observation/worker/connection targets, journal-before-send,
one-attempt Agent dispatch and shared Tune/CW acquisition/ordering fences replace
raw GUI PTT. Off cannot acquire generic authority or clear CW/Tune/embedded CAT
obligations. Review is receipt-only and cannot clear the separate durable release
duty; authoritative newer TX/RX proof is required.
An explicit no-command retired-owner recovery requires native child-reaping proof
and fresh RX on the same selected station; missing proof remains fail-closed.
No detached acquisition, automatic replay or reconnect is introduced. This is source/mock implementation,
not installed/package/live acceptance; alpha.31, physical Agent/FLEX release and
RF acceptance remain unchanged/open.

Current post-alpha.31 source also moves Agent amplifier Operate/Standby from raw
main/Monitor dispatch into one durable native owner shared by the Desk sidebar,
Station Control and standalone Monitor. It binds exact selection, control,
worker, Agent connection and observation identities, journals before one
existing-worker send and never reconnects, retries or replays. Operate requires
fresh idle/interlock evidence; Standby remains an independent urgent lane with
retained exact authority. A native preparation fence shared across WebViews makes
a newer Standby retire an older Operate even when their renderer delivery is
reversed. Restart invalidates preparation tokens while preserving unknown receipt
recovery. Full frontend **2,592/2,592**, Rust **523 unit + 22 integration**,
portable Swift **418/418**, and production build gates pass after independent
review. Alpha.31 remains installed;
package, live Agent, amplifier/drive readback, hardware and RF acceptance stay
open, and no station/network/operator-data action occurred.

Current post-alpha.31 source adds one durable native owner for Agent/FLEX Cancel
from both main Station Control and standalone Monitor. It binds selection, worker
and connection generations, persists before its one dispatch, never reconnects
or replays, and retains lost replies for explicit receipt recovery. Agent releases
only an owned transmit attempt; FLEX interrupts an owned tune readback and
requires fresh PTT-off confirmation. Operation-scoped renderer feedback closes
the admission and stale-receipt races found in independent review. Full frontend
**2,563/2,563**, Rust **526/526**, focused portable Swift **40/40**, production
build and diff checks pass. Alpha.31 remains installed; package and physical
station/RF acceptance stay open.

Current post-alpha.31 source also fixes a shared Propagation freshness-display
race: accepting a delayed native observation advances the display clock, so a
fresh automatic result is not labelled cached until the next minute tick. Focused
shared-view **17/17** and production build gates pass. No provider/network request
was made; installed/live-source acceptance remains open.

Current post-alpha.31 source adds the missing Station Control Rotor Stop without
weakening the shared owner boundary. It remains available with stale telemetry or
an unresolved Goto, uses one exact current-owner native dispatch, never retries an
uncertain acknowledgement, and keeps newer Stop feedback ahead of late Goto
recovery. Full frontend **2,549/2,549**, Rust **497 unit + 22 integration checks**
and production build gates pass. Alpha.31 remains installed; package and physical
rotor acceptance are still open.

A current-HEAD full code review is recorded in
[FULL_CODE_REVIEW_2026-10-15.md](FULL_CODE_REVIEW_2026-10-15.md). All ten
actionable review findings are closed in source and bound by focused
regressions. The installed alpha.31 frontend suite passes 2,462/2,462 across 166
files, the Rust/Tauri suite passes 459 unit plus 21 integration checks, and both
its source and installed packages pass 33/33 isolated native checks. Synthetic
responsive QA covers nine task surfaces at 360×640 and
1280×800 plus 37 Desk widths from 360 to 3,840 pixels. These results do not
close the explicitly listed Agent, installed-live, multi-display or hardware
acceptance boundaries.

A post-Hamlib three-pass review then confirmed nine additional defects in eight
correctness, data-safety, station-safety and window-lifecycle areas. Exact
source `c7beb576779351da269812dd65a60963ea7374ed` closes all eight with focused
regressions. The current full gates pass **2,399/2,399 frontend**, **445 Rust
unit + 21 integration**, **396 portable Swift tests in 52 suites**, **195
native Swift tests in 26 suites**, TypeScript and the production bundle build.
The exact-source uninstalled Mac candidate passes strict deep signing and
isolated **33/33** integrated-local-UI acceptance with `station_io: false`.
This does not change the installed alpha.29 baseline or close the Agent,
hardware, RF, live-provider, multi-display or Windows/Linux package boundaries.

Post-alpha.29 source `f658c7d` closes the remaining known narrow-table part of
UI-09. Logbook and Spot History retain resizable desktop tables, while narrow
containers reflow the operator-selected columns into labelled records. Browser
QA passes **78/78** representative surface/width combinations and **38/38**
focused breakpoint combinations without document or control overflow; the full
frontend suite passes **2,400/2,400**. The exact-source uninstalled Mac bundle
passes strict deep signing and isolated **33/33** native acceptance with
`station_io: false`. Mixed-DPI and operator visual acceptance remain open. See the
[responsive audit](RESPONSIVE_WINDOW_AUDIT_2026-10-15.md).

Post-alpha.29 source `1794f8f` completes DATA-09's source-version metadata
contract without treating ETags, timestamps or generic server headers as
dataset versions. Explicit bounded source versions/revisions survive valid 304
checks and clear on an unversioned replacement. Full native **196/196**,
portable Swift, frontend **2,401/2,401** and production build gates pass. The
exact-source uninstalled Mac bundle passes strict deep signing and isolated
**33/33** native acceptance with `station_io: false`. Current public activation
feeds do not expose an explicit version and correctly remain **Not reported**;
installed/live-source observation remains open. See the
[reference metadata acceptance](REFERENCE_SOURCE_VERSION_ACCEPTANCE_2026-10-15.md).

Post-alpha.29 source `6888b74` completes BACKUP-01's verified Dropbox restore
path at the source and isolated-package boundary. It downloads only the exact
revision pinned by an app-owned verified upload receipt, rechecks provider
account/object/revision/size plus SHA-256, and stages a deterministic local
`.xlogbackup` for inspection. Database replacement still requires the existing
explicit local restore confirmation. Full native, portable, frontend and Rust
suites pass; the exact-source uninstalled Mac bundle passes strict deep signing
and isolated **33/33** native acceptance with `station_io: false`. Production
OAuth, live account/upload/download/restore, installation and other provider
adapters remain open. See the [verified restore acceptance](REMOTE_BACKUP_VERIFIED_RESTORE_ACCEPTANCE_2026-10-15.md).

Post-alpha.29 source `473c5ac` adds BACKUP-01's Google Drive v3 transport
foundation at the source and isolated-package boundary. The native owner
pre-generates one exact file ID, uploads one frozen envelope, validates account,
object, parent, app-owned metadata, size, SHA-256 and pinned head revision, then
independently downloads only that revision for restore verification. Retention
fails closed until provider-safe conditional deletion exists. Native **206**,
portable Swift and exact-source package gates pass; the uninstalled bundle is
strictly signed and passes isolated **33/33** native acceptance with
`station_io: false`. Trusted OAuth, native presentation, retention deletion,
live-account evidence and installed acceptance remain open. See the
[Google Drive transport acceptance](GOOGLE_DRIVE_BACKUP_TRANSPORT_ACCEPTANCE_2026-10-15.md).

Post-alpha.29 source `3fa11ac` adds BACKUP-01's Microsoft Graph v1.0 OneDrive
transport foundation at the source and isolated-package boundary. One immutable
backup uses a conflict-failing upload session and sequential 10 MiB fragments;
verification checks drive/item/parent/size plus stable eTag/cTag around an
independent download and computes xLog's own SHA-256. Bearer credentials never
cross to provider-returned capability URLs. Retention fails closed until
eTag-conditional deletion exists. Native **214**, portable Swift and exact-source
package gates pass; the uninstalled bundle is strictly signed and passes
isolated **33/33** native acceptance with `station_io: false`. Trusted OAuth,
native presentation, conditional retention, live personal/business account
evidence and installed acceptance remain open. See the
[OneDrive transport acceptance](ONEDRIVE_BACKUP_TRANSPORT_ACCEPTANCE_2026-10-15.md).

Current-HEAD follow-up review source `bd38ace` closes a further restore/upload
replay boundary and Separate Windows recovery boundary. Restored online-log
consent is revoked before database publication; upload claims atomically recheck
provider enrollment and exact candidate membership; retained local contacts
detach vanished Wavelog IDs; credential and destination changes remain fenced.
Main and detached Settings now own different recovery journals, and genuine
conflicts/unknown outcomes cannot be hidden by a delayed native presentation
request. Full frontend **2,409/2,409**, native Swift **217/217**, portable Swift,
TypeScript, production bundle and Rust check gates pass. The exact-source
uninstalled Mac candidate passes strict signing and isolated **33/33** acceptance
with `station_io: false`. Installed/operator/live-provider and hardware gates
remain open. See the
[current-HEAD review acceptance](CURRENT_HEAD_REVIEW_ACCEPTANCE_2026-10-15.md).

Post-alpha.29 source `edd3182` adds BACKUP-01's native FTP and implicit-FTPS
transport foundation. Plain FTP requires explicit insecure consent; FTPS
requires verified TLS for control and data. A plan-derived `MKD` reservation
precedes one immutable upload, then xLog independently downloads and hashes the
bytes before issuing a namespaced receipt. Ambiguous outcomes never replay,
retention-count destinations fail closed, and SFTP remains a separate
host-key-pinned programme. Native **224/224**, portable Swift and C warnings-as-
errors gates pass; the exact-source uninstalled Mac bundle is strictly signed
and passes isolated **33/33** acceptance with `station_io: false`. No server,
credential, operator data or installed app was touched. See the
[FTP/FTPS transport acceptance](FTP_FTPS_BACKUP_TRANSPORT_ACCEPTANCE_2026-10-15.md).

Post-alpha.29 source `41a7854` adds BACKUP-01's native FTP/FTPS presentation.
Settings own the validated protocol, endpoint, directory and username while a
dedicated macOS Keychain account owns the password. Passive snapshots do not
read Keychain or contact a server; native prepare, local credential check,
explicit approval and Start form the only activation path. Account and
destination identities bind workspace, vault service, provider, endpoint,
username and directory, and any settings or password mutation retires older
authorization. Full frontend **2,411/2,411**, native Swift **225/225**, portable
Swift and C warnings-as-errors gates pass. The exact-source uninstalled Mac
bundle is strictly signed and passes isolated **33/33** acceptance with
`station_io: false`. No real credential, server, operator log or installed app
was touched; disposable-server and installed acceptance remain open.

Source `ec10704` adds a disposable loopback FTP/implicit-FTPS acceptance harness
using synthetic bytes only. The real libcurl transport completed plain-FTP
exclusive upload, independent verification and restore downloads, exact SHA
comparison and replay refusal. A reservation `550` wrote no object; a lost
post-store acknowledgement wrote one object but remained uncertain and was not
replayed. An untrusted implicit-FTPS certificate failed before any object was
written. The warning-clean native run now covers **229 tests across 31 suites**.
No external network, trust-store change, credential,
operator log or station I/O was used. Source `e325a3f` then corrects libcurl's
early oversized-file result mapping and expands the disposable gate to
advertised/unknown-size overrun, growth after verification and the unchanged
15-second control-handshake timeout. **7 tests / 8 live invocations** and the
full warning-clean native **232 tests across 31 suites** pass. Harness
`1080e6e` then proves the unchanged 30-second low-speed and 120-second total
download limits in a clean-source **8-test / 10-execution** run and fixes
Bash 3.2 early-failure cleanup; the full native suite is now **233 tests**.
Harness `0dfefc5` then proves stalled/slow upload behavior against the same
unchanged limits: each failure leaves exactly one measured partial object, no
verified authority and no replay. The clean-source gate is now **9 tests / 12
executions** and the full native suite **234 tests**. A production-library
trust probe at `762f44d` then rejected the disposable certificate under every
attempted CA environment override while CLI curl accepted the same CA and
still rejected the wrong hostname. Trusted FTPS therefore requires an
explicit scoped production CA configuration; no trust store was changed.
Source `ab112a3`, tightened by `f533cde` to reject an explicitly empty port,
adds the separate SFTP configuration boundary: canonical OpenSSH SHA-256
host-key pins, strict endpoint/path validation, identity fencing and redacted
non-Codable password values. Native **238** and the full portable gate pass,
but no SFTP client, dependency, UI, vault or network path is enabled.

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
| Shared Station Control owner | **Packaged isolated / partial ownership / hardware acceptance open** | Provider setup/lifecycle through `d4d8bb0`, explicit Hamlib catalogue `702cddf`, exact Direct FLEX receive controls through `77c15f2`, exact Remote Agent receive-frequency/mode controls at `e909184`, and exact Hamlib receive-frequency/mode controls at `5a847a7`. Commit `6332240` closes the earlier Agent/FLEX admission gap. Every exact child control requires fresh RX/PTT-off VFO-A evidence, exact setup/selection/control/connection generations and a durable no-replay receipt; one observed sample cannot issue twice. Agent completion waits for a later authoritative observation. Hamlib holds one rigctld session lock across fresh VFO/PTT prechecks, one target write and exact target/VFO/PTT readback, never selecting a VFO or changing split implicitly. Full **2,399 frontend** and **466 Rust** checks pass; exact package source `5a847a7` passes isolated **33/33** native acceptance with `station_io: false` and strict signing. Hardware profiles remain CAS-blocked. See [Agent package acceptance](DIRECT_AGENT_RECEIVE_CONTROL_SOURCE_ACCEPTANCE_2026-10-15.md), [FLEX mode package acceptance](DIRECT_FLEX_RECEIVE_MODE_SOURCE_ACCEPTANCE_2026-10-15.md) and [Hamlib package acceptance](HAMLIB_EXACT_RECEIVE_CONTROL_SOURCE_ACCEPTANCE_2026-10-15.md). |
| Normal split safety and KPA Operate admission | **Client installed / Agent rollback source fixed / physical acceptance open** | xLog's rule is VFO-derived rather than offset/band-specific, with explicit 20 m coverage for RX 14.200 / TX 14.230 MHz; it suppresses only the exact known RX-versus-TX diagnostic when the observed distinct VFOs, confirmed TX path and Receive state agree. **19 adjacent decoder/observation tests** pass. Windows Agent source `4e9638a` and canonical deployment `6f55ea8` proved the TX-VFO route earlier: guarded `station_operate` returned HTTP 200 in 2847.4 ms at RX A 24.940 / TX B 24.945 MHz, KAT memory 24.945, READY, no alarms and no recovery requirement. Across 22 samples and an 11-second follow-up, MOX stayed off and RF output stayed 0 W. Alpha.25 installs commit `f100d84`: only Tune requires CAT transmit permission; guarded Operate still requires current Agent-advertised action, lifecycle stability and real station inhibitors. Source commit `e04acef` makes every Agent, Hamlib, Direct FLEX and local CAT-client connection start with full controls, preserves an explicit receive-only choice, and restores the full-control default after a new selection or configuration revision. Windows Agent commit `67d2902` closes the observed drive defect: explicit Standby restores and proves configured barefoot drive, while failed/cancelled Operate restores the exact freshly observed pre-Operate drive before releasing the transaction. An incomplete KPA or drive rollback returns structured `operate-rollback-incomplete` evidence. **131 focused station/Agent/policy tests** pass. The Agent was off during this source fix, so the earlier KAT fault 2, empty HTTP 502 and physical 12 m 90 W restoration require a fresh installed Windows acceptance. No PTT, Tune or CWX command was issued. See [Agent rollback evidence](WINDOWS_AGENT_DRIVE_ROLLBACK_SOURCE_FIX_2026-10-15.md). |
| Clear after QSY (RADIO-05) | **Installed / default off / live acceptance open** | Commit `1d0b520` clears only after two distinct fresh observed-RX samples agree on the changed receive frequency; arbitrary split TX is ignored rather than inferred. Reconnect, stale data, first samples, radio/cluster selection changes, command epochs, active edits and worker/workspace generation changes veto the transaction. The native-only mutation uses an editor barrier and durable idempotent receipt; urgent release controls remain available. Legacy settings decode OFF. **3 Swift**, **16 Settings UI**, **4 QSY**, **12 cluster**, **18 activation**, **42 station-selection** and **1 native-boundary** focused tests pass. Raw Hamlib remains conservatively ineligible; `direct_agent` and `direct_flex_lan` are supported. |
| Desk-split normal Logbook table | **Source follow-up ready / installed base visually observed** | Commit `6ef5748` uses the explicit Desk presentation context rather than a viewport guess. Commit `4465578`, included in alpha.31, keeps the normal Logbook table above or below the map. The 16 October source follow-up starts with all ten normal Logbook columns, retains Desk-scoped visibility and pointer/keyboard widths, and migrates the untouched legacy five-column default without overwriting customized legacy preferences. Search/import/export/edit/delete/selection controls remain in dedicated, canvas-docked and detached Logbook views; row Enter/double-click editing remains available. Scoped **59/59**, production build and diff checks pass; packaged follow-up acceptance remains open. |
| Retained map resizing in split layouts | **Source regression fix ready / installed acceptance open** | User evidence exposed competing MapLibre/application resize observers, a hidden 400×300 fallback and repeated wrapped-world camera fitting. Commit `29b5077` makes the application the single resize owner, repaints after the final positive geometry frame and never refits the camera for a pure pane-size change. **36 focused Map/Desk tests** plus TypeScript pass. Installed divider and above/below visual acceptance remains open. |
| Detached task surfaces and multi-Band Maps | **Installed / packaged acceptance passed / operator visual follow-up open** | Commits `5db24db`, `3fcc4e0`, `a8f9192`, `0a96ede` and `cfa7638` remove unrelated global banners/header strips from all nineteen direct-menu task roles while preserving functional recovery and safety evidence. Detached Logbook has the requested compact one-line controls. Spot History persists column visibility and width controls (`1c37043`). The Window menu opens 13 independently keyed Band Maps with compact CW/Phone/Data settings (`401e86d`). Exact-source and installed alpha.29 33-check acceptance prove retained renderer/window lifecycles, Band Map state and Spot History main-destruction recovery; browser QA covered 14 task surfaces at 360×640 without horizontal overflow. Operator multi-display review remains open. |
| Propagation freshness | **Installed / live transport accepted / visual follow-up open** | Commit `6787270` removes the worker-side click throttle, coalesces concurrent fetches, adds a native ten-minute cache TTL and probes freshness every 60 seconds plus mount/focus. Explicit Refresh always attempts a new fetch; a lost reply recovers retained evidence without replaying a network request. Frontend **4/4**, native **5/5** and the fixture-backed Swift service suite pass. On 15 October, a new default-disabled live probe exercised the packaged production transport/parser twice in 4.440s and returned current SFI 136, A 13, K 2 and all five band groups with `stale: false`. Installed-header visual freshness and outage observation remain open. See [live propagation acceptance](LIVE_PROPAGATION_ACCEPTANCE_2026-10-15.md). |
| WSJT-X Logged ADIF and CQ intake | **CQ classification source ready / package and live WSJT-X acceptance open** | Commit `d9b46da` adds explicit receive-only loopback/multicast Logged ADIF intake. The later CQ path accepts bounded fresh FT8/FT4 reports without adding outbound packets or station authority. Commit `2fab507` classifies retained CQ calls against the current local logbook and CTY resolver, binds changes to workspace/QSO/reference revisions, fails closed to `Unknown`, and proves that classification refresh cannot replay an old decode as a new alert. New Logged ADIF contacts still use the semantic duplicate boundary and prospective online-log enrollment transaction; generic imports remain excluded. |
| Optional QRZ / Club Log / HRDLOG delivery | **QRZ + Club Log source ready / live acceptance open; HRDLOG deferred pending official contract** | QRZ and Club Log now have independent Keychain credentials, default-off prospective-only enrollment with explicit confirmation, immutable one-record claims, renderer-independent delivery, ambiguous-outcome no-replay, immediate credential removal and aggregate-only local health. Club Log uses only `realtime.php`; any known non-200 atomically records rejection, disables only Club Log and cancels its remaining queue, satisfying the provider's 403/firewall rule. Existing contacts, file imports, Wavelog pulls, edits and confirmation refreshes cannot enroll; only new manual or WSJT-X Logged ADIF contacts after each provider is enabled are eligible. No credential or live request was used. Live QRZ/Club Log account acceptance and rejected/uncertain review remain open. Official HRDLOG pages confirm real-time uploads and a dedicated upload code but do not publish the endpoint, wire schema, response, idempotency or retry contract needed for safe implementation. See [Club Log acceptance](CLUB_LOG_UPLOAD_FOUNDATION_ACCEPTANCE_2026-10-15.md) and [HRDLOG contract review](HRDLOG_CONTRACT_REVIEW_2026-10-15.md). |
| Windows Agent restart reconnection | **Done / installed / Agent-restart repetition open** | Alpha.26 installs commits `422bd2b` and `dd0eb3d`: one native startup resume uses the selected saved Direct Agent, existing durable selection/control fence and Keychain token, with full CAT/amplifier controls enabled by default. A fresh installed app launch automatically recovered `ready / Observed live` at 21.195000 MHz USB and ShackCQ connected; the opt-in checkbox was on and Tune simplex, PTT, VFO/split and Standby/Operate were available. Startup itself sent no station action and observed Receive, READY, KPA Operate and output 0 W. Explicit disconnect/forget, provider changes, newer controls or pending/unknown receipts still prevent resume. **10 startup-filter**, **44 Agent setup/control UI** and TypeScript checks pass. Repeating the acceptance across an actual subsequent Windows Agent process restart remains open. |
| Shared Sync refresh and mutation owner | **Installed base live accepted; documented-order package verified / installed live mutation open** | Commit `29ea0c0` provides one native summary monitor; `3134f7c` adds one shared mutation owner; alpha.27 includes target-epoch consent fencing at `0c4384a`. Alpha.28 applies fresh Wavelog confirmation/enrichment fields to an authoritative single or already-linked local contact. On 15 October, persisted automatic startup plus an acknowledged generation-fenced run imported four safe contacts and refreshed five linked contacts; no upload, delete, failure or conflict occurred. The six later held rows were valid confirmation/enrichment variants, not disposable duplicates. Source `24a7f9f` uses Wavelog API v2's documented ascending ADIF record-ID order and per-page `lastfetchedid` only when every page boundary and semantic identity agree; otherwise the prior fail-closed matcher still holds ambiguous groups. A fresh GET-only probe mapped all 68,040 remote IDs with zero held, zero local writes and zero remote writes; three safely mapped remote IDs are not yet local because the probe was read-only. The exact `df3b5e7` uninstalled bundle passes strict signing and 33/33 isolated checks with station I/O disabled. Installed automatic-sync and confirmation-refresh acceptance remain open. Commit `c214d5d` retains held-group review for any future dataset that cannot prove the documented join. See [live Wavelog acceptance](LIVE_WAVELOG_SYNC_ACCEPTANCE_2026-10-15.md) and [source-bundle evidence](MACOS_POST_ALPHA29_SOURCE_ACCEPTANCE_2026-10-15.md). |
| Reviewed ADIF/ADX transfer workflow | **Installed / DATA-10 live and large-file accepted** | Workflow through canonical DXCC `f380d95`, explicit ISO-8859-1 ADI `efcc329`, scalar/type checks `64e1010`, grid/reference checks `d8ac9d0`, versioned extension metadata `4ac6edb`, exact USERDEF RANGE enforcement `5fcc04f`, structural rejection `00efac8`, AGE/A-index bounds `fcbbe17` and antenna-angle bounds `16a1c4c`. Alpha.27 includes exact integer-family validation `8f481fb`, LAT/LON and uniform VUCC locators `c1bd710`, and five upload statuses, QRZ download, EQSL_AG and QSO_COMPLETE enums `c4515a6`. Alpha.28 includes `9b3a203`, adding signed ALTITUDE/MY_ALTITUDE and nonnegative DISTANCE/MAX_BURSTS decimal validation. Sources through `79ce6b9` enforce every published record scalar family while preserving exact spelling, precision, order and ADI fallback behavior. Alpha.29 passes packaged ADX semantic roundtrip, **38/38** installed large-log checks with 100,002 records and live reconciliation with fresh service confirmations. Any additional legacy encodings remain separately prioritized work; one large-log run is not percentile performance proof. |
| Immutable remote-backup execution foundation | **Verified Dropbox lifecycle plus Google Drive, OneDrive and FTP/FTPS transport/presentation source/package complete; disposable FTP live accepted; SFTP configuration source complete / production providers unavailable / partial BACKUP-01** | UUID-bound durable authorization, native credential/approval owners and durable verified registration bind exact workspace, destination, account, vault service, provider identity, generation and revision. Dropbox source through `6888b74` covers frozen upload, conditional retention and exact-revision verified restore staging. Google Drive `473c5ac` adds pre-generated file identity, provider SHA/head-revision verification and exact-revision download. OneDrive `3fa11ac` adds conflict-failing sequential upload sessions, opaque drive/item/eTag receipts, credential-free capability URLs and eTag/cTag-bracketed download with local SHA-256. FTP/implicit-FTPS transport `edd3182` adds an exclusive plan-derived directory reservation, one immutable object, bounded independent download/SHA-256 verification, explicit insecure consent for FTP and verified control/data TLS for FTPS. Presentation `41a7854` adds validated Settings, a dedicated native Keychain password, passive no-network/no-Keychain snapshots, explicit prepare/check/approve/Start authority and revision retirement. Harness `ec10704` proves the real libcurl path against disposable loopback servers: plain-FTP upload, verification, restore and replay refusal pass; reservation refusal writes nothing; a lost post-store acknowledgement remains uncertain without replay; and an untrusted FTPS certificate writes zero objects. Fix `e325a3f` correctly classifies libcurl's early size rejection and adds advertised/unknown-size overrun, post-verification growth and production handshake-timeout acceptance. Harness `1080e6e` proves the unchanged 30-second low-speed and 120-second total download limits, prevents verification/replay after either failure and makes Bash 3.2 early-failure cleanup reliable. Harness `0dfefc5` proves the same unchanged limits for partial uploads, with exact remote-byte/hash evidence, no verified authority and no replay. Probe `762f44d` shows CA environment variables do not configure trust in the production library even though CLI curl accepts the same CA; a scoped production CA interface remains required. SFTP foundation `ab112a3`, tightened by `f533cde`, validates canonical SSH host-key pins, endpoints, directories and identity fencing while adding no client, dependency, UI, vault or network path. Cloud and FTP-family retention-count destinations fail closed where conditional deletion is absent. Lost acknowledgements are idempotent only for the identical envelope; renderer input cannot supply authority, credentials, hashes or bytes. Latest full native **238**, full frontend **2,411**, portable Swift and exact-source isolated **33/33** Mac package gates pass at their respective checkpoints with `station_io: false`. No real credential, external provider/server, Keychain mutation or operator restore was used; production OAuth, live authenticated providers, scoped trusted-certificate FTPS, installed acceptance, cloud-provider retention and the SFTP backend/transport/presentation remain open. See [frozen-plan acceptance](REMOTE_BACKUP_FROZEN_PLAN_ACCEPTANCE_2026-10-15.md), [verified Dropbox restore acceptance](REMOTE_BACKUP_VERIFIED_RESTORE_ACCEPTANCE_2026-10-15.md), [Google Drive transport acceptance](GOOGLE_DRIVE_BACKUP_TRANSPORT_ACCEPTANCE_2026-10-15.md), [OneDrive transport acceptance](ONEDRIVE_BACKUP_TRANSPORT_ACCEPTANCE_2026-10-15.md), [FTP/FTPS transport and presentation acceptance](FTP_FTPS_BACKUP_TRANSPORT_ACCEPTANCE_2026-10-15.md) and [SFTP configuration acceptance](SFTP_BACKUP_CONFIGURATION_FOUNDATION_ACCEPTANCE_2026-10-15.md). |
| Awards calculator and packaged performance | **Packaged isolated percentile acceptance / live contention open** | Commit `aad3886` removes unnecessary ordinary-JARL UTC construction while retaining date-sensitive rules. Exact source `cb5d450` then passes five independent 100,002-contact macOS runs at **39/39**: first Awards median/p95 **1,151/1,522 ms**, repeat **66/91 ms**, Logbook **229/244 ms**, rendered local intelligence **33/33 ms**, and six-screen navigation p95 **67–132 ms**. See [performance acceptance](PACKAGED_PERFORMANCE_ACCEPTANCE_2026-10-15.md). Operator-workspace/live-service contention, physical cold disk, memory pressure, multi-display and other-OS gates remain open. |
| Existing programme-reference feedback audit | **Source verified at existing scope** | Existing display-only POTA/SOTA/IOTA/WWFF/WWBOTA evidence is generation/draft/call fenced and never replaces operator input. **8 frontend** and **3 portable Swift** focused tests pass. User-observed POTA success is not proof of every live feed or packaged state. |
| Shared native CW owner and independent CW child | **Installed / partial windowing** | Owner `2cb7bac`; child `423bb73`. Desk and child share one provider/selection-fenced session; passive mount sends no output, only saved macro IDs cross IPC, and protected Close/Dock retains pending or unknown output. Registration-scoped cleanup cannot Stop another window's lease. Included in alpha.23 with `station_io: false`; physical keyer, radio and RF acceptance remain open. |
| Passive independent Rotor and Station Status | **Installed / partial windowing** | Rotor `adb125f` reads retained telemetry only and exposes no motion/setup/Stop authority. Station Status `39c447d` uses event-driven retained selection/telemetry with exact provider/generation/identity matching and exposes no connection, radio, transmit or rotor authority. Included in alpha.23; neither child starts polling, and exhaustive packaged visual/hardware acceptance remains open. |
| Shared Propagation owner and independent child | **Installed / partial windowing** | Commit `b969c68`; passive snapshot and explicit awaited/coalesced refresh share the existing injected Swift fetch/cache through one native projection. The prior 15-second main-renderer timer is removed. Child mount is passive, weather/control authority is hidden, and missing worker state is reported rather than silently created. Included in alpha.23; real-network and exhaustive packaged visual acceptance remain open. |
| Passive independent Station Identity | **Installed / live visual follow-up open** | Commit `8f5486a`; seventeenth singleton native role. It displays eight retained non-secret identity/revision fields fed only by existing authorized canonical Settings reads. Child mount performs no Settings RPC/default seed, poll, persistence, credential or device call. Settings/workspace/worker mutations invalidate availability and stale replies cannot restore it. **72 frontend**, **7 native identity/admission/lifecycle** and **17 registry** checks plus TypeScript pass. Alpha.28 packages the task-only responsive surface; operator visual review remains open. |
| Passive retained Alerts | **Installed / live-hardware acceptance open** | Commit `749d1ac`; eighteenth singleton native role. A closed native aggregation exposes only modeled Agent safety-inhibitor/alarm presence and rotor uncertainty codes from existing retained owners. Payload-free wakes add no timer/poller, owner initialization, control, acknowledgement or persistence. The UI says retained reports are not a live all-clear and excludes broader sync/CW/backup claims. **73 frontend**, **7 native Alerts/admission/lifecycle** and **18 registry** checks plus TypeScript pass. Alpha.28 packages the task-only responsive surface; the powered-off Agent prevents live report acceptance. |
| Passive saved Antenna Reference | **Installed / hardware acceptance open** | Commit `5642563`; nineteenth singleton native role. It reuses the canonical fenced Settings projection and Desk antenna renderer without new storage, Settings RPC, timer, polling, selection, matching or RF authority. Missing, hidden and automatic profiles do not fabricate an installed antenna. **76 frontend**, **5 native antenna/admission/lifecycle**, **6 shared-projection** and **19 registry** checks plus TypeScript pass. Alpha.28 packages the task-only responsive surface; physical antenna-profile acceptance remains open. |
| Remaining Station Control ownership | **Active / dependency split** | Direct FLEX, Remote Agent and Hamlib exact VFO-A receive frequency/mode are source-complete and package-isolated. Hardware-profile apply requires Agent-side config revision/ETag plus conditional PUT/If-Match. FLEX discovery and SmartLink remain separate. Installed physical acceptance is still required for all three implemented providers. |

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
   (`568ffb0`, `77c15f2`), Remote Agent exact VFO-A receive frequency/mode
   (`e909184`, native admission fix `6332240`) and Hamlib exact VFO-A receive
   frequency/mode (`5a847a7`) are source-complete and package-isolated.
   Hardware-profile apply still needs Agent conditional writes; discovery and
   SmartLink remain separate. Do not duplicate owners while prerequisites are
   absent.
8. **Installed / operator visual acceptance open:** all nineteen detached task
   roles, compact desk-split Logbook and Canvas/Separate Windows are packaged.
   Alpha.29's source and installed 33-check runs cover native routes, detached
   lifecycles, main-window-absent Spot History recovery, Band Map state and
   workspace persistence without station I/O. Mixed-display visual acceptance
   and remaining shared provider/action ownership stay open.
9. Package and live-accept RADIO-05 Clear after QSY, now source-complete with
   trusted observed-RX provenance, editor veto, selection/command epochs and an
   idempotent native transaction. Keep the default OFF until the operator opts in.
10. **Live Wavelog acceptance and BACKUP-01's Dropbox lifecycle plus Google
    Drive, OneDrive and FTP/FTPS transport/presentation are source/package complete;**
    register the provider applications and complete trusted production OAuth,
    cloud-provider presentation/retention, live upload/deletion/download/restore
    acceptance and installed acceptance; complete trusted-certificate FTPS,
    then implement host-key-
    pinned SFTP.
11. Run packaged cross-platform, percentile large-log performance and separately
   authorized hardware acceptance. Do not collapse these into source evidence.

## Workspace/native-window programme

| ID | Outcome | Status |
| --- | --- | --- |
| WS-01 | Show/hide/move/resize every desk panel | **Source complete / acceptance** — `5a74363` implements the requested model: each arrow toggles edit mode, title bars move, all eight edges/corners resize, Lock exits editing, Fit is secondary and internal content reflows or scrolls. Canvas **26/26**, transport **5/5** and TypeScript pass; installed multiple-display interaction remains open. |
| WS-02 | Settings-managed named layouts | **Source complete / packaged acceptance** — revisioned persistence/UI supports duplicate, rename, activate, delete and restore with conflict/lost-acknowledgement recovery. Alpha.29's isolated native run exercises save-without-activation, activation, rename, Settings remount, Traditional restore and unchanged shared draft through rendered controls; operator multi-display review remains open. |
| WS-03 | Native menus replace navigation | **Source complete / acceptance** — `33dfae7` adds checked native Canvas/Separate Windows choices and persists the mode plus exact prior Canvas preset. Returning to Canvas closes every separate task window after authoritative save, matching the current operator contract; dirty editors, layout transactions and armed/pending CW veto the switch, and the switch emits no device action. TypeScript, **59 frontend**, **66 Rust** and **16 Swift** layout tests pass. |
| WS-04 | Window menu opens/focuses every panel | **Source complete / packaged acceptance** — all nineteen task roles are available with consistent task-first chrome; alpha.29's source and installed native runs exercise menu routing, detached lifecycles and main-window-absent recovery. Operator multi-display visual acceptance remains open. |
| WS-05 | Docked/mixed/undocked share one live session | **In progress** — major draft/cluster/radio/rotor ownership, Desk CW and shared Desk/child Agent lifecycle moved. Desk, main Full and standalone Simple/Full Log QSO share authoritative native Read Radio plus disabled-by-default continuous Follow Radio. Main Agent/FLEX/Hamlib and standalone Station Control share the native manual-simplex-tune owner; main Agent/FLEX and standalone Monitor share durable carrier-Tune and Cancel owners; Desk Rotor, standalone Rotor, Station Control and Monitor share one durable native manual-Goto owner. Read/tune/carrier/release/Goto recovery is generation-bound and receipt-checked without replay; Follow consumes the existing native telemetry owner and never depends on a hidden renderer. Remaining provider/action owners are still open. |
| WS-06 | Layout/geometry survive restart and display changes | **In progress / acceptance** — persistence/recovery source exists; `3cb27f4` prevents a cancelled close from retiring a still-live window's geometry tracker, with **22 focused native geometry tests**. Mixed-DPI/native evidence remains open. |
| WS-07 | No duplicate logging or station actions | **In progress** — Settings and rotor-configuration receipts plus protected Chaser, explicit Read Radio, continuous Follow, manual simplex tune, carrier Tune/Cancel and manual Rotor Goto owners are source-verified. Read Radio admits every editor, journals the original workspace, and retains lost or unreconciled outcomes until an explicit read-only durable-receipt check; no station read or mutation is replayed. Follow admits every registered editor, coalesces newest-only telemetry, rechecks workspace/worker/draft/selection/connection/control epochs and waits for exact per-instance terminal settlement; unknown outcomes disable without replay. Manual tune journals before dispatch, requires exact selection/control/connection generations plus fresh PTT-off evidence, confirms authoritative simplex readback and never replays an uncertain outcome. Carrier Tune/Cancel use ordered native intents, one existing-worker dispatch and persistent receipt-only recovery; selected-radio CW is mutually excluded for the full unresolved carrier lifetime while urgent release remains available. Manual Goto binds fresh serialized rotor ownership and exact target identity; unresolved outcomes survive restart/compaction, block another turn and can only be checked or durably reviewed without replay. Canvas and detached Rotor Stop use the same owner-scoped native ingress, including Auto revocation, shutdown/isolation denial, no pre/post device-read dependency and no Stop replay. The full multi-window gate remains open. |
| WS-08 | Responsive, accessible, measured laptop/4K UI | **Source complete / acceptance** — detached task chrome, intrinsic intelligence sizing, compact Logbook toolbar, accessible canvas resize/Fit and configurable Spot History columns are source-ready. Five ad-hoc packaged 100,002-contact runs pass 39/39 and record launch plus painted navigation distributions; synthetic responsive QA covers 360–3,840 px. Physical laptop/4K, multi-display/DPI, assistive-technology and operator-workspace checks remain open. |

## Operator feedback portfolio

The compact status below deliberately separates implementation from remaining
acceptance. Consult the detailed tracker before closing any individual item.

| Status | IDs | Remaining boundary |
| --- | --- | --- |
| **Done / installed at stated scope** | UI-17, UI-26, UI-39, CW-01, CW-02, CW-03, CLUSTER-01, SYNC-01 | Some rows retain explicit hardware, alternate-OS or accessibility limits. |
| **Implemented in installed alpha.29 or current reviewed source; row-specific acceptance open** | UI-01–25, UI-27–38, UI-40–41, MAP-01–04, DATA-01–07, DATA-09, RADIO-01–05, PERF-02–03, SYNC-02, SYNC-06 | Perform the packaged visual, live-service, latency, real-feed or hardware checks named in the tracker; no RF inference. RADIO-05 remains default-off until separately authorized live acceptance. UI-09 and UI-18–21 are source-verified after alpha.29; their installed/operator acceptance remains open. DATA-09 now retains only explicit bounded provider versions/revisions; current public activation feeds expose none and intentionally remain Not reported. |
| **Active / partial** | DATA-08, DATA-10–11, BACKUP-01, PERF-01, WS-01–08, RUM-01–03, SHIP-01 | DATA-10 has reviewed UTF-8/Windows-1252/ISO-8859-1 ADI, UTF-8 ADX, 33-field duplicate updates, versioned APP/USERDEF metadata with exact RANGE semantics, strict structural rejection and every published 3.1.7 record scalar type family. Alpha.29 adds a packaged ADX semantic round trip and **38/38** installed 100,002-record functional checks; live-sync acceptance remains. BACKUP-01 now has UUID-bound durable consent, default-off live-worker lifecycle, independently verified Dropbox upload/retention/restore execution, Google Drive exact-ID/exact-revision transport and OneDrive conflict-failing chunked upload plus tag-bracketed verification. Production OAuth/verifier provisioning, cloud-provider presentation/retention, live provider acceptance and FTP-family adapters remain open. DATA-11's feedback path is audited. Agent-restart lifecycle hardening and the corrected Standby/failed-Operate drive rollback both await installed Windows repetition; the rollback defect itself is closed in Agent source `67d2902`. |

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
- **Backups:** BACKUP-01 source/package gates cover Dropbox verified upload,
  conditional retention and exact-revision restore staging, Google Drive
  exact-ID/exact-revision verification, and OneDrive conflict-failing chunked
  upload with tag-bracketed local-SHA verification. FTP and implicit FTPS add
  exclusive directory reservation plus independent bounded local-SHA
  verification. Native FTP/FTPS Settings, Keychain ownership and explicit
  prepare/check/approve/Start presentation are source/package complete.
  Disposable plain-FTP upload/verify/restore/replay refusal and untrusted-FTPS
  rejection pass with synthetic bytes. Environment CA overrides do not supply
  production-library FTPS trust; a scoped CA interface remains required. The
  host-key-pinned SFTP configuration/identity foundation passes native and
  portable gates without enabling a client or network path. Production OAuth,
  live providers, trusted-certificate FTPS, cloud-provider
  presentation/retention, installed acceptance and the SFTP backend/transport/
  presentation remain open.
- **Cross-platform/windowing:** macOS, Windows and Linux route parity,
  main-renderer-absent operation, mixed DPI/negative origins, monitor disconnect,
  maximize/restore and window recovery.
- **RUMlog comparison:** RUM-01/02 read-only Settings, menu and installed-bundle
  help evidence is complete. The selected RUM-03 custom DX-alert foundation and
  native popup/optional-sound delivery are source-complete at `d37aeb6`, with
  no RF authority. Installed live-cluster notification acceptance remains open;
  do not add empty contest/QSL imitation features.
- **QLog comparison:** QLOG-01/02 read-only current-source inventory and gap
  decisions are complete at upstream commit `cbb75f2`; a second read-only pass
  on 15 October confirmed that this is still upstream HEAD and expanded the
  comparison across WSJT-X UDP, provider services and saved layout profiles.
  Named rules, structured spot conditions, merged repeat counts, expiry and
  separate delivery adapters
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
  speech and outbound UDP remain deferred. QLOG-04's broader reference pass is
  complete; its selected UDP, provider and layout lessons stay in their existing
  independently accepted programmes rather than becoming a blanket parity
  promise. Source `6d238e6` adds the next bounded QLog-inspired condition:
  named rules can require an 80-byte, control-free, literal case-insensitive
  comment substring, AND-combined with existing filters. Legacy rules remain
  unrestricted, unsafe source comments cannot match, and the latest safe match
  is retained as wrapped dashboard evidence. Rust **12/12**, renderer **13/13**
  and production-build gates pass; no poller, regex engine or station action was
  added. Combined exact source `0da511d` passes strict deep-signature verification
  and isolated integrated **33/33** acceptance with station I/O disabled.
  Live-cluster, installed-app and operator observation remain open. See the
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
