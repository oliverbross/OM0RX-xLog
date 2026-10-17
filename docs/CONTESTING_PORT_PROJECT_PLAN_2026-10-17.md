# OM0RX-xLog Contesting — porting and delivery plan

**Date:** 17 October 2026, Australia/Darwin  
**Status:** APPROVED — fixture-scoped P1/P2 foundation and P3 pilot persistence source accepted; full stage, platform, runtime and sponsor-rule gates remain open
**Product owner:** Oliver Bross, OM0RX  
**Delivery owner:** this contesting chat, alongside **OM0RX-xLog main**  
**Source:** [oliverbross/contest-sw](https://github.com/oliverbross/contest-sw), a fork of Not1MM  
**Goal:** bring the complete audited contest-sw feature set into a separate **Contesting** module inside xLog, retaining xLog's UI, local-first behavior and station ownership, with macOS, Windows and Linux acceptance.

**Provenance refresh (17 October 2026):** this substantive planning draft was preserved from the untracked file in `/Users/oliver/Documents/Projects/OM0RX-xLog` and placed in the canonical checkout at `/Users/oliver/Documents/Projects/OM0RX-xLog-beta3-resume`. Its technical inventory, programme, risks and acceptance criteria are retained. Only stale xLog source/release coordinates and workflow wording were refreshed against the consolidated `main` lineage described below.

**Authorization boundary:** Oliver approved the staged implementation programme on 17 October 2026. The current authorization covers the isolated contesting branch, portable-core/rule spike, test application and directly requested test packaging. It does not authorize production installation/deployment, modification of the pinned contest-sw checkout, or a claim that source-derived rules are current sponsor-approved rules.

**Current implementation ledger (17 October 2026):** work is isolated at `/Users/oliver/.codex/worktrees/xlog-contesting/OM0RX-xLog` on `codex/contesting-foundation`.

- `71f71b2`: Astra-accepted fixture-scoped Foundation core; 16 focused tests passed in native and portable-only manifests on macOS. This is not three-OS or current sponsor-rule acceptance.
- `c403ac8`: accepted test-application/runtime isolation boundary; runtime test-package acceptance remains unverified.
- `7a0e8d9`: accepted component UI protocol after 24 focused tests, a 3,096-test frontend run and desktop/narrow render review.
- `b02654f`: accepted frontend-only gate restricting contest workspace navigation to the isolated test profile. It is not a portability/CI checkpoint.
- `3c9dc70`: onboarding now requires workspace setup and aligns contest-entry validation; this is source/test work, not packaged-app launch acceptance.
- `22f1016` and `6d49c47`: Swift 6.0 compatibility corrections for delivery cancellation and throwing test expressions.
- `c105b61`: Astra-approved P3 pilot persistence source with full-UUID generations, atomic SQLite mutations/reads, durable serials, bounded exact replay and 23 passing focused native store tests. The current core suite also passed 16 native tests. Both portable-manifest commands exited zero, but their executed-test counts were elided and are not claimed.
- `299e6e9`: portability compatibility source includes the manifest decomposition and platform-scoped station tests without changing the package graph. In hosted run `39030287452`, Linux passed with 16 core and 23 store tests. macOS progressed past manifest compilation but failed on a Swift 6.0 Testing autoclosure/actor-await expression; Windows reached the remote-backup presentation sources and exposed remaining `CoreFoundation` portability work. Those macOS and Windows corrections remain pending, so this is not a three-platform acceptance.
- `b6bc281`: hoists the actor-awaited native-command lookup out of the Swift Testing autoclosure. The frozen combined source passed `LiveRemoteBackupServiceTests` locally on macOS with 21/21 tests. This is focused local evidence; a successful hosted macOS platform job remains pending.
- `001f0da`: adds the bounded Windows/CoreFoundation fallbacks for remote-backup presentation parsing. The frozen combined source passed `LiveRemoteBackupPresentationTests` locally on macOS with 8/8 tests, including boolean identity and numeric-revision cases. Hosted Windows source/test evidence is recorded below; native Windows application runtime evidence remains pending.
- Hosted run `39031590054` at `d1ab5aa581746ff6a8f5b8285e0c20a2f686f8da` passed on Linux and Windows. Windows job `117392988044` verified 16 contest-core, 23 contest-store, 6 ConnectionDoctor and 8 remote-backup presentation tests. This is native Windows source/test evidence, not packaged application, UI, service, hardware or whole-app parity; the macOS job still awaited the separate Testing autoclosure compatibility correction at this checkpoint.
- `603b770`: Astra-approved integrated contest worker/UI contract and generated Swift/JSON fixture; the connected backend has 9 passing focused Swift tests and its TypeScript fixture suite has 29 passing tests. P3 remains open for edit/delete, backup/restore, performance targets, completed platform jobs, and integrated runtime/package acceptance. No test-app build or launch is claimed here.
- `0d6c429` merges the accepted xLog main milestone `e42376db0bd65c1b2b5668692a52ed12cd802536` into the isolated contesting branch. That main milestone is the accepted release-1.2.2 line; contesting's separate runtime and package gates remain open.
- `2742331`: Astra-approved source for the fresh worker build manifest and isolated real-process acceptance harness. No worker build, process run, test-app package, or application launch is claimed by this source-only checkpoint.
- `ff2b8e3`: clean-source real-worker acceptance passed after a fresh two-job release build. The 35 framed exchanges covered fail-closed missing profile, empty-workspace onboarding, CQ WW and CQ WPX create/draft/reserve/commit/scoring, exact replay, receipts and restart reopen; external service requests were denied and the normal isolated logbook stayed empty. Worker SHA-256 was `6dab1e5b431a7a39f3136b978e0705c37d9cf6e85b65f7efbf3d14738c85c4ad`, and the resource tree SHA-256 was `748093a0e25253926e8440a7afc997947da0211c1a7d11ee4d695e57cdc3d1b3`. Sampled process checks observed no network sockets or radio-like descriptors, and protected production database metadata was unchanged without reading contents. This is a minimal worker-bootstrap result: the Rust host, final Test `.app`, installation, native menu/UI and hardware remain untested.
- A main-line follow-up for spot coalescing is in progress and is not merged into the contesting branch. It is outside the evidence recorded here until separately accepted and synchronized.

**Parallel implementation update:** the Test application package built successfully from frozen source `434e5dec3e23731d323ce6f26a3e181ec0e586a4` in the original contesting worktree. Astra independently approved its build/identity/signature/content baseline: Test-only bundle identity and URL scheme, version 1.2.2, ad-hoc deep/strict signature verification, arm64 main executable, universal worker, and matching original/preserved file and resource manifests. The read-only artifact and evidence are preserved in that worktree at `dist/contesting-test/acceptance/434e5de-package/`; the bundle manifest SHA-256 is `3e9858a079e40b2a43f5e81a60554979c55c8ea4b2a5ef4fc7148e64bbf97f39`. It has not been installed or launched. Native UI, full-app runtime, notarization, Intel application and hardware acceptance remain open.

P3 correction/deletion implementation proceeds independently in `/Users/oliver/.codex/worktrees/contest-corrections/OM0RX-xLog`, branch `codex/contest-corrections`, created from that same commit. Later P3 source changes require separate runtime acceptance. The narrow hosted Swift 6.0 test-compiler correction proceeds in its own `contest-portability` worktree/branch so its verification cannot compile unfinished store changes. Hosted run `39032872265` at `434e5de` passed Linux and Windows; macOS failed compiling the malformed-TCI-input test array before focused contest tests ran. A first local rerun in the shared corrections worktree encountered incomplete store source and supplies no TCI test evidence; the isolated rerun is pending.

**Completed portability checkpoint:** the isolated TCI test passed locally (1/1), Astra approved the exact eight-case-preserving fix, and commit `59a38571f39acc7ed12fc07b8f43a4e7fcbe8b36` passed [hosted run 39034236953](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39034236953) on all three operating systems. macOS (Swift 6.0.3), Linux and Windows (Swift 6.3.3) each executed 16 core and 23 store tests; Windows additionally passed 6 ConnectionDoctor and 8 remote-backup presentation tests. The fix is integrated into `codex/contesting-foundation`; `85e0cd5` records platform evidence. This is the pilot source/test matrix, not acceptance of later editing/export source or packaged runtime on all three systems. Two subsequent local port test attempts hit the tool's working-directory fallback and compiled into dedicated canonical scratch folders with zero matching tests. They are excluded from evidence; source/app/data were unchanged, the main chat was informed, and reruns require explicit directory guards and absolute scratch paths.

The next P3 work is ordered as three reviewable packages: (1) transactional QSO corrections/deletions, immutable audit history, tombstones and full score recalculation; (2) strict worker commands and a revision-bound full-contact read, with generated wire fixtures; (3) the shared-UX correction form and delete confirmation, preserving operating drafts, reservations and uncertain-operation recovery. Package 1 is now Astra-approved and committed at `b1318cff4c85ce42ed952468a907f7c0218d33b8`, with 32 counted store tests passing in the guarded isolated worktree. The suite covers populated v1-to-v2 migration, post-write transaction rollback, bounded results, replay, immutable fields, serial/draft preservation, generation fences and duplicate promotion. Integration `b0103f8` combines it with the reviewed compiler fix. Package 2 is in progress; Package 3 follows its reviewed wire contract. Backup/restore, crash recovery and large-log performance gates remain open.

The independent F20/F21/P4 export-formatting slice is Astra-approved and committed at `dba4ff6`, implemented in `/Users/oliver/.codex/worktrees/contest-exports/OM0RX-xLog`, branch `codex/contest-exports`. It extends the existing Cabrillo formatter and reuses xLog's ADIF writer/parser for the two pilots, with immutable revision/rule/reference-bound inputs and complete golden fixtures. Six core export tests and five ADIF tests passed in the guarded isolated worktree after review fixes for invalid contacts, ties-to-even frequency rounding, standard-field/date validation and frozen metadata consistency. Integration `8fcb54e` combines the reviewed store and formatter packages; a clean-source guarded integration run passed all 59 tests (16 core, 6 export, 32 store, 5 ADIF), while its hosted matrix remains pending. This slice has no worker, UI or file-writing integration. Current sponsor compliance and submission readiness remain unverified. Superseded or duplicate CI runs were cancelled rather than counted as passes; later integrated runs provide the relevant platform evidence.

Three SOL workstreams now proceed independently: worker correction/deletion commands in the corrections worktree; a single-coherent-read export service in the exports worktree; and verified contest database snapshots in the reused `contest-portability` worktree, now on `codex/contest-snapshots`. The export service must use existing transactional session reads, preserve historical artifact identity after later writes, and explicitly map the stored operator-category aliases before formatting. The snapshot utility uses bounded SQLite online backup, exact schema/integrity checks and native no-replace publication; offline copy-reopen tests must preserve historical generations, receipts, audit records, tombstones, drafts and serials. Activating a restored workspace remains deferred until a separate runtime admission epoch can invalidate stale clients without rewriting historical identities. Neither new slice grants file/UI/worker restore or export acceptance by itself.

Direct liaison is active with the main chat, currently titled **Move station control into Radio**. It has received the contesting source/build coordinates and isolation boundaries. Its ongoing radio reservation/startup fixes and fixed reference-validation layout are tracked for the next deliberately reviewed synchronization after main acceptance. Only foreground native Test UI checks wait for the main chat's live app testing; isolated implementation and noninteractive tests continue. No new main release is inferred accepted from work in progress.

Astra High reviews architecture and code; at most three SOL 5.6 Medium implementation workers may operate concurrently. Direct user authorization permits bounded test packaging from this implementation worktree; production release packaging and installation remain canonical-checkout gates.

## 1. Review decision

Recommended approach: build contesting inside the existing React/Tauri/Swift application. Reuse xLog's visual components and service owners; port contest rules into a portable, independently tested contest core. Do not embed the Qt application or add a production Python runtime by default.

Contesting gets its own contest sessions, drafts, scoring, serial allocation and log storage. Normal logging remains a separate workflow. Shared radio, rotor, cluster, credentials and reference-data services continue to have one owner. Moving a completed contest into the normal logbook is an explicit, repeat-safe operation.

The first useful delivery is a single-operator HF contest workspace. It is an intermediate milestone, not completion of the requested full port. All 94 source plugins, digital and voice workflows, reporting, migration, and supported network operation remain tracked through final acceptance. Upstream unfinished functions have explicit dispositions below rather than silently becoming promised working features.

This document is the approval artifact. Approval authorizes the implementation programme and its staged review gates; it does not mean any feature is already implemented or tested.

## 2. Evidence and baseline

| Item | Inspected baseline | Interpretation |
|---|---|---|
| Downloaded source | `/Users/oliver/Documents/Projects/contest-sw`, shallow clone of `master`, `7c8b499225a73f7f8f792246881bd7aefc05452f` | Read-only reference checkout; source application was not installed or launched. |
| Source version | `pyproject.toml`: `26.10.11`, Python >=3.11, PyQt6, SQLite | Windows is not established as a supported/tested source platform. |
| Source scale | 178 Python files, 80,161 physical lines; 94 rule modules with 57,809 lines, excluding plugin `__init__.py` | Counts include comments, tests and generated Python; they are not complexity or effort estimates. |
| Contest selector | 94 entries in `not1mm/data/new_contest.ui`; all map to a plugin filename | Stronger inventory than README's “60+”; existence is not proof of correctness. |
| Source footprint | Approximately 115 MB of files excluding `.git`; shallow checkout approximately 223 MB including `.git` on this machine | Download/archive size and Python percentage are poor predictors of port effort. |
| Historical canonical xLog source at planning refresh | `/Users/oliver/Documents/Projects/OM0RX-xLog-beta3-resume`, `main` / `origin/main`, `2f3086e` (`Recover QSO drafts from durable receipts`) | Preserved discovery evidence for the plan; it is not the current implementation coordinate. |
| Approved implementation base | isolated worktree `codex/contesting-foundation`, started from `c5059ea5798edc6e3094e3d204fd9270de34916f`, application version 1.1.10 | Historical starting coordinate for P1/P2. Merge `0d6c429` now incorporates accepted main milestone `e42376db0bd65c1b2b5668692a52ed12cd802536`, release 1.2.2. A later spot-coalescing follow-up remains outside this branch pending separate acceptance. |
| Historical installed 1.1 source at planning refresh | `ef9861e` (`Release 1.1 panel and map refinements`), application version `1.1.0` | Preserved exact release-code baseline from the earlier `/Applications/OM0RX-xLog.app` acceptance; it is not a claim about the currently installed application. |
| Release evidence | `347beee`, `docs/MACOS_1_1_0_RELEASE_ACCEPTANCE_2026-10-17.md` on the consolidated lineage | Records the exact package identity, hashes, signing, automated/native acceptance and evidence limits for the 1.1.0 bundle. |

The historical 1.1.0 release record reports 3,048 frontend tests, 570 application Rust tests plus 22 Hamlib dummy tests, 306 Swift tests, and 35/35 native acceptance checks with station I/O disabled. These are earlier release records, not tests run for this plan, current installed-app evidence or contesting evidence. At that recorded acceptance point the installed executable matched the candidate hash and Developer ID signing was verified; Apple notarization was not performed and is not inferred.

Inspection covered source layout, all plugin names/metadata and hook presence, selector reconciliation, core schema, main event flow, macro execution, network handling, representative rule implementations/tests, current xLog contracts, and the newer release's UI changes. It did **not** execute all contests, prove scoring correctness, inspect every function body, validate sponsor rules, or test hardware. Those are explicit implementation tasks.

The source repository's `AGENTS.md` contains restrictions against automated inspection/modification. Oliver explicitly requested downloading and inspecting his fork; that direct instruction governs this read-only investigation. No upstream file was modified. Any future upstream contribution is separate from this xLog port.

## 3. What contest-sw actually provides

Rule plugins mix several responsibilities: Qt field layout and tab order, exchange extraction, SQL queries, duplicate rules, scoring, multipliers, ESM actions and output formatting. For example, CQ WPX reads widget text for serials and uses database queries for prefix multipliers; CQ WW's ESM handler manipulates buttons and queues messages. These cannot be copied unchanged into React.

The central `not1mm/__main__.py` is 5,258 lines. Its macro processor performs actions as well as substitutions, including transmitting, logging, spotting, wiping fields and changing operating mode. The port must separate a side-effect-free preview from deliberate execution.

The source has five duplicate-policy categories: once per contest, per band, per band/mode, no duplicate restriction, and contest-specific logic. Eight plugins provide a special duplicate function. Ninety-three have an ESM hook, 23 have a digital `ft8_handler`, and three have EDI output. Hook presence alone does not mean that every mode or export is supported correctly.

### Feature disposition ledger

Every row is in the full programme unless explicitly marked as an upstream limitation or proposed exception. “Reuse” means reuse a foundation with contest-specific verification, not claim completed parity.

| ID | Source capability and evidence | xLog treatment | Completion evidence |
|---|---|---|---|
| F01 | Create/open/edit contest, categories, station/operator settings; `new_contest.py`, `select_contest.py`, `ContestInstance` | New Contest Manager, session templates and frozen station snapshot | Restart, switch and duplicate-session tests; categories retained in exports |
| F02 | 94 selectable plugins; `plugins/`, `new_contest.ui` | Portable versioned rule registry; all entries in Appendix A | Every entry receives a tested disposition; no empty “supported” records |
| F03 | Dynamic exchanges, tab order, parser/prefill/validation | Contest entry adapter using xLog field styling and editor primitives | Keyboard scenarios and exchange edge cases for every rule family |
| F04 | Duplicate checks, points, up to three multiplier flags, recalculation | New deterministic contest engine; all five dupe policies | Golden results after create/edit/delete/import and full rescore |
| F05 | Sent serials, prior serials, padding/cut numbers | Transactional reservation/commit ledger; formatting separate from numeric value | Crash, double-click, uncertain acknowledgement and multi-station tests |
| F06 | Run / Search & Pounce, ESM, configurable keyboard bindings, corrected-call handling | New contest state machine; reuse xLog focus and send ownership | No accidental send/log during edit, IME, repeated keys or stale context |
| F07 | F1–F12 CW, free text, speed, auto-CQ, keyer integrations | Reuse CW owner/WinKeyer; add contest profiles, tokens and bounded repeat lifecycle | Simulator and operator-observed send/stop tests by backend/platform |
| F08 | cwdaemon and PyWinKeyer/SwiftKeyer network interfaces; `cwinterface.py` | Compatibility adapters through shared transmit ownership where existing direct WinKeyer is not equivalent | Protocol fixtures plus actual supported backend checks |
| F09 | Voice WAV/phonetic sequencing, soundcard selection, radio voice memories | New audio adapter and contest voice profile; shared PTT owner | Device removal, audio end/error, Stop and PTT-release tests |
| F10 | Macros including EXCH, PREVCALL/PREVNR, LOGIT, TX/RX, MARK, SPOT, RUN, SANDP, WIPE, VOICE1–10, RI: | Parse into typed text/actions, preview without execution; map legacy profiles with diagnostics | Token/action coverage; unsupported radio commands explicitly rejected |
| F11 | WSJT-X logged contacts, digital handlers | Reuse parser/receiver with explicit contest destination and rule validation | Duplicate datagrams, late packets and contest-switch routing tests |
| F12 | FLDIGI ADIF UDP and XML-RPC RTTY sends; `fldigi_sendstring.py`, main | New adapter using shared transmit lifecycle | Receive/import and transmit/return-to-RX integration evidence |
| F13 | CAT via rigctld, flrig, TCI; `cat_*.py` | Reuse Hamlib/TCI/embedded xCat; flrig compatibility is new work | Capability matrix per provider; observed frequency/mode and stop behavior |
| F14 | rotctld rotator, bearings; `rotator.py`, `rot_interface.py` | Reuse xLog rotor/geo services | Existing ownership and stale-generation protections remain effective |
| F15 | Cluster, bandmap, local mark/CQ marker, spots, tune/navigation; `clusterwindow.py`, `bandmap.py` | Reuse feed and map UI; add contest dupe/multiplier projection | Normal DX classification and contest-needed status remain distinct |
| F16 | QRZ and HamQTH lookup; `lookup.py`, `lookupservice.py` | QRZ/CTY reuse; HamQTH adapter; offline fallback | Enrichment never overwrites typed exchange; unavailable service stays nonblocking |
| F17 | Super Check Partial, fuzzy candidates, recent spots/local-log candidates | New SCP index using xLog intelligence surface | Prefix/fuzzy behavior, offline refresh, bounded latency and source attribution |
| F18 | Call-history import, prefill, export/generation | New contest history store and mapping; reuse file chooser/import preview | Every documented key retained; stale suggestions cannot overwrite input |
| F19 | Log view, edit/delete, claimed-QSO state, statistics/rate, DXCC/zone trackers | Reuse table and windows; new contest projections and rescoring | Rate windows and mult status verified against independent calculations |
| F20 | ADIF import/export | Reuse xLog parser/unknown-field preservation; add contest mapping | Exchange, serials, IDs and app fields survive round trips |
| F21 | Cabrillo per-plugin output | New versioned serializers; preserve supported fields/encoding | Exact header/QSO fixtures, frequency units and per-contest format validation |
| F22 | EDI: DARC VHF, NAC VHF, TA VHF/UHF | New EDI serializers using existing geo helpers | Three family-specific golden outputs and distance/grid checks |
| F23 | Real-time XML scoreboard; `rtc_service.py`, `online_score_xml` | New optional reporter, secure credential store, bounded background work | Recorded payloads, interval/error/retry tests; live opt-in acceptance |
| F24 | N1MM-style radio/contact/update/delete/score packets; `lib/n1mm.py` | New optional UDP output adapter | Wire fixtures and receiver verification; no claim of N1MM+ interoperability |
| F25 | Multi-Multi master/client, serial/dupe queries, contact replay, chat | Separate network workstream; renfield protocol dependency | Multiple hosts, disconnect/reconnect, conflict and serial uniqueness evidence |
| F26 | Operator change and rover location | New immutable operator/location snapshots on QSO | Changes do not rewrite earlier QSOs or invalidate archived score silently |
| F27 | Remote VFO/Pico USB knob; `vfo.py`, `usb_vfo_knob/` | Portable explicit device selection through station owner | Windows COM, macOS and Linux serial permission/hotplug tests |
| F28 | Languages, theme, fonts, docking and preferences | Use xLog appearance/window behavior; migrate relevant language text and settings | Same UI conventions, scaled layouts, keyboard labels and translations review |
| F29 | Existing Not1MM SQLite logs and settings | Read-only import preview with provenance and reconciliation | Counts, categories, exchanges, raw fields and source hashes accounted for |
| F30 | UDC parsing helpers; `parse_udc.py`, `ham_utility.py` | Preserve/evaluate parsing semantics; no complete custom-contest workflow found in main | Document supported subset; executable custom rules require a separate contract |
| F31 | General Logging and DX-Pedition plugins | Reuse normal xLog where equivalent; retain source session identity on import | Explicit mapping, no duplicated normal logger or silently discarded plugin |
| F32 | SO2R and broader Multi-Op listed in `Things_To_Do.md` | Upstream limitation; do not claim mature SO2R from a port | Product extension only after explicit scope decision; Multi-Multi F25 still required |
| F33 | Help/manual, reference updates, legacy packaging/assets | xLog help and platform packaging; retain notices/data provenance | Documentation, clean install, dependency inventory and bundled-data review |

The upstream HTML manual is older than current source (for example it describes missing RTTY while current RTTY plugins exist). Use the current `.tex` manual plus source; resolve contradictions in the ledger rather than copying old claims.

## 4. Reuse map for xLog

Paths below are repository-relative for maintainers. Where a file exists only in newer beta source, that is marked. Reuse percentages are deliberately not estimated before the first vertical slice.

| Existing component | Reuse | Required contest extension / limit |
|---|---|---|
| `prototype/src/live/workspaceScreens.json`, `workspaceNavigation.ts`; Rust `workspace_navigation.rs`, menu construction in `main.rs` | Native menus and acknowledged navigation | Add Contesting through one registry plus explicit native group; test delivery from detached windows |
| `OperatorCanvas.tsx`, `OperatorWorkspace.tsx`, `useWorkspaceLayout.ts`, `workspace_windows.rs` | Canvas and Separate Windows, geometry, docking, restoration | Contest-scoped layouts and window identities; preserve existing saved normal layout |
| Newer `QSOEditorCore.tsx`, `QSOEditorCanvas.tsx`, `qsoFields.ts` | Field styling, layout, lookup presentation, focus utilities | A compact contest entry component/schema; avoid growing normal editor with 94 branches |
| `operatorDraftSession.ts`, `Sources/XLogCore/OperatorDraft.swift` | Revision, receipt and recovery patterns | Separate contest draft ID/session; current singleton cannot safely serve two drafts |
| `LogbookPanel.tsx`, `LogbookContact.swift`, mutation sessions | Table controls, editing UX and repeat-safe command patterns | Contest repository, columns and score invalidation; no direct reuse of normal write endpoint |
| `Models.swift`, `ADIF.swift`, `QSOADIF.swift`, `SemanticQSOIdentity.swift` | QSO values, frequency/band parsing and lossless fields | Contest instance identity, exchange snapshots, rule version and explicit imported identity |
| `LogbookDatabase.swift` | SQLite conventions and transactional patterns | New contest database/repository; do not turn contest writes into normal sync-outbox writes |
| `CTYResolver.swift`, `Geo.swift`, `CallsignEnrichment.swift` | Date-aware entity lookup, coordinates and enrichment | Pin reference version per contest; contest-specific prefix and geography rules stay in rule engine |
| `XClusterIntegrationCore`, `LiveClusterMethods.swift`, `ClusterPanel.tsx`, `BandMaps.tsx` | One cluster connection, spot stream and familiar presentation | Contest-specific status index alongside existing worked/confirmed state |
| `LiveStationSession.swift`, `LiveTCISession.swift`, Rust station/Hamlib/FLEX modules | Radio provider selection, observation and command ownership | Contest requests enter through existing owner; flrig and legacy macro capability gaps remain new work |
| Rust `rotor_session.rs`, `auto_rotor.rs`; `RotorPanel.tsx` | Independent rotor owner and bearings | Contest-origin context; never create a second rotctld connection |
| `CWProfile.swift`, `CWDesk.tsx`, `useSharedCW.tsx`, Rust `cw_session*`, `winkeyer.rs`, `ptt_session.rs` | Arm/send/Stop, firmware validation, generation protection | Serial-aware macro context, ESM action plans, voice/digital arbitration and auto-CQ cancellation |
| `LiveWSJTXBridge.swift`, `WSJTXActivity.swift`, `WSJTXPanel.tsx` | Message parsing, reception and visible status | Its current import goes to normal logbook; destination routing is a mandatory shared change |
| `SyncEngine.swift`, `WavelogClient.swift`, online delivery service | Existing normal-log upload/conflict handling | Use only after explicit contest promotion; no second Wavelog writer or automatic live contest sync |
| `BackupManager.swift`, `BackupEnvelope.swift`, backup scheduler | Snapshot/verification/restore conventions | Versioned contest payload, assets and transfer journal; existing backup is not automatically contest-complete |
| `WorkspaceCredentialStore.swift`, `NativeCredentialStore.swift`, `CPlatformVault` | Platform credential interfaces | New service keys; verify Linux and Windows behavior independently; no credentials in imported preferences |
| `worker.ts`, Rust `worker.rs`, Swift `WorkerProtocol.swift`, `LiveWorker.swift` | Correlated, bounded IPC and process lifetime | Namespaced contest messages and surface permissions; keep scoring off the station response path |
| CSS tokens, icons, notices and stable feedback layer from the consolidated 1.1/`main` lineage | Same xLog look/feel and non-jumping layout | New UI fits existing density, themes, disabled/error states and resize behavior |

## 5. Proposed architecture

### Technology decision

| Option | Benefit | Cost / decision |
|---|---|---|
| Embed the Qt application | Quick access to source screens | Different UI, second lifecycle/settings/radio owner; reject for this product brief |
| Bundle Python as a runtime rules service | Initially retain more Python arithmetic | Most plugins still require extraction from Qt/SQL; adds interpreter/dependency packaging on three OSes; fallback only after a measured spike |
| Portable Swift contest core plus React/Tauri UI | Fits existing worker/data architecture and shared UI | Rules must be translated and verified; **recommended** |

Python may be used in development to generate reference fixtures from pinned source. It is not required on the user's computer. Data tables can be shared declaratively; exceptional rules remain typed functions. No downloaded arbitrary plugin execution in the production app.

Proposed new locations (not created in this planning stage):

- `Sources/XContestCore/`: portable models, repository, rules, score, serials and exporters; Foundation/SQLite-compatible, no AppKit, SwiftUI, Network.framework or Qt dependency.
- `Sources/XContestCore/Rules/` and `Resources/`: versioned rule families, registry and attributed reference data.
- `Sources/XLogPrototypeSupport/Contesting/`: worker adapter, import/export and service projections.
- `prototype/src/contesting/`: manager, desk, entry, log, score/rate/multiplier panels and settings.
- `prototype/src-tauri/src/contesting/`: scoped desktop session/navigation and integration adapters that call existing owners.
- `Tests/XContestCoreTests/`, `prototype/tests/contesting/`, and `docs/contesting/`: fixtures, acceptance records and user help.

Namespaced request contracts should include `contest_id`, `workspace_generation`, `expected_revision`, `request_id` and, for actions affecting the current contact, `draft_id`. Initial groups: contest list/create/open/archive; draft read/update/validate; serial reserve; QSO commit/edit/delete/restore; score/multiplier/rate read; import preview/commit; export preview/write; normal-log promotion. Replies return committed revisions and receipts. These are proposed contracts, not existing endpoints.

### Data ownership and persistence

Use a separate contest SQLite store under the existing workspace, with session IDs on every record. It should support multiple contests and archive old sessions. Keep a single repository writer per process; network mode uses an explicit authority instead of sharing a SQLite file over a network filesystem.

Proposed entities: `contest_sessions`, `contest_rulesets`, `contest_qsos`, `contest_drafts`, `serial_reservations`, `contest_operations`, `score_revisions`, `call_history`, `contest_assets`, `normal_log_transfers`, and later `network_outbox`/`network_receipts`.

Store raw and normalized exchanges; numeric serials plus exact transmitted text; operator/station/rover snapshot; band/mode/frequency/time; source QSO ID; claim/dupe state; rule and CTY versions; edit history; and import provenance. Derived points/multipliers are reproducible caches, not authoritative user input. Preserve source fields that are not yet mapped.

Serial numbers cannot be computed from QSO row count. Reserve against the draft, persist before sending, reuse the same reservation after uncertain outcomes, and never silently recycle a transmitted or uncertain serial. Cancellation/voids are recorded. Different contest serial scopes (whole session, band or transmitter) belong to rule configuration. Commit QSO and reservation transition atomically; a duplicate request returns its original receipt.

Normal-log promotion must work across two databases without pretending there is one atomic transaction: persist transfer intent, upsert by `(contest_id, contest_qso_id)` at the destination, return a durable receipt, then mark completion. Crash recovery queries/replays that stable identity. Preview existing matches and conflicts; do not deduplicate solely by callsign/time. Later contest edits propose an explicit reconciliation; normal-log/Wavelog edits do not silently alter the scored contest archive.

### Rule engine contract

Each rule declares identity/version, effective date/edition, supported categories/bands/modes, exchange schema/tab order, validation, duplicate key, serial scope, per-QSO points, multiplier identity/scope, bonuses and score formula, output mappings, and ESM recommendations. Evaluation consumes immutable QSO/context snapshots and returns results plus reasons. It must not access widgets, radio, credentials or arbitrary SQL.

Use source behavior as the initial comparison baseline, then check current sponsor rules. A disagreement is a recorded rule decision, not an automatic choice to preserve an upstream defect. Pin a contest's ruleset at creation; changing it requires a score-impact preview and explicit rescore. Imports retain the original claimed score alongside the recomputed score.

### Radio and event routing

Normal logging and contesting may both display station observations, but only one active operating context receives tune-to-draft, digital-contact and transmit intents. Switching contexts preserves both drafts and disarms CW/voice/ESM/auto-CQ. Stale windows/events cannot send, allocate serials or log into another contest.

Reuse existing station provider ownership, fresh-observation checks, Stop behavior and lost-acknowledgement handling. Contest UI is not a new CAT/PTT client. The Australia–Slovakia WAN path must remain distinct from local commit/scoring latency; do not make keyboard entry wait for remote station acknowledgements or weaken hardware freshness to mask WAN delays.

Legacy `RI:` CAT commands need an explicit capability policy and safe typed mappings. An unrestricted raw-radio-command bridge would bypass xLog's station owner. Unmapped commands remain visible in migration diagnostics and unavailable until supported; this is a proposed safety-driven compatibility exception requiring review, not an invisible omission.

## 6. UI/UX contract

Add a top-level native **Contesting** menu and a matching xLog navigation entry. Preserve **Logbook** and its current workflows. Proposed menu destinations:

| Destination | Purpose |
|---|---|
| Contest Manager / New Contest / Open Contest | Choose rule, edition, categories, station/operator and previous sessions |
| Contest Desk | Compact keyboard-first entry, Run/S&P, exchange, serial, dupe status, current score and shared station context |
| Contest Log | Search/edit/delete/restore with contest columns and score consequences |
| Score & Multipliers / Rate | Per-band/mode counts, needed multipliers, rates and audit reasons |
| Messages & Keying | Contest CW/voice/RTTY profiles, ESM, auto-CQ, preview and Stop |
| Call History & Check Partial | Local history, SCP updates and explicit suggestion selection |
| Contest Network | Network role, operator/chat/status; only when implemented |
| Import / Export / Add to Normal Logbook | Previewed migration, submission files and controlled promotion |
| Contest Settings | Session-specific settings; shared station/credential settings link to their existing owner |

Use existing typography, spacing, semantic colours, icons, tables, focus rings, dialogs and feedback layer. Keep Canvas and Separate Windows behavior, with independent contest layout persistence. The latest normal QSO editor's split into core/canvas components is the reference, not the old monolithic editor in this checkout.

The operating row prioritizes callsign, sent/received exchange, serial, Run/S&P and a persistent dupe/validation cue. Secondary fields belong in the established inspector/panel pattern. Contest-needed/dupe/multiplier colours need labels and a legend; normal lifetime worked/confirmed state must not masquerade as contest progress.

ESM is explicit opt-in per contest/profile. Show the next action before Enter executes it. Plain logging remains available without transmission. Imported action macros are disabled until reviewed. Stop stays reachable in the active desk and detached keying surface. Preview, editing and importing never transmit or spot.

No empty placeholder routes in released menus. Unavailable device capabilities show a truthful reason where relevant. Full parity is reported in the ledger, not inferred from menu visibility. Check compact windows, large/multiple monitors, 100–200% scaling, long exchanges, keyboard layouts, IME, screen-reader labels and focus restoration.

## 7. Parallel work with OM0RX-xLog main

Separate menus do not eliminate shared-file conflicts. Both modules touch navigation, drafts, device owners, IPC, backup and digital ingestion. Use these ownership boundaries after approval:

| Area | Default owner | Integration rule |
|---|---|---|
| Existing logger, release work and any unrelated local changes | OM0RX-xLog `main` owner | Contesting work does not edit, reset, stash, absorb or commit those changes |
| New contest core, rules, contest UI, fixtures and docs | Contesting chat | Isolated branch/worktree; new directories preferred |
| `Package.swift`, worker routing/permissions, `main.rs`, `LiveApp.tsx`, menu registry, build manifests | Shared integration seam | One bounded integration change at a time against an agreed base |
| Station/CW/rotor owners, WSJT-X destination, backup format, normal-log promotion | Main/shared owner plus contest adapter | Agree contract before edits; maintain normal-mode regression coverage |
| Packaging, credentials, deployment and installed user data | Main release owner | Test with isolated profiles; merge only reviewed commits; release from one owner |

The approved implementation followed the isolation intent with `codex/contesting-foundation` based on `c5059ea5798edc6e3094e3d204fd9270de34916f`. The last observed canonical-main milestone is `537557a`, release 1.2.2; build/signing and live acceptance were still in progress. A later integration checkpoint will select the corrected accepted main milestone, compare both histories and rerun affected normal-log tests. Oliver's direct test-packaging authorization is a bounded exception for this worktree; it does not convert a test package into a release or authorize installation.

Keep a narrow shared integration patch separate from rule/core batches. Rebase onto agreed main milestones, resolve behavior conflicts deliberately, and rerun affected normal-log tests. Do not bulk-replace normal files with contest versions. Upstream contest-sw stays a pinned read-only reference outside xLog; no repository-within-repository vendoring.

The original planning investigation sent no message to the main chat. This preserved document supplies the coordination contract; any separately authorized implementation must coordinate through the user's authorized channel and the canonical repository workflow.

## 8. Delivery stages and dependency plan

The fixture-scoped P1/P2 core foundation is approved at `71f71b2`, and P3 pilot persistence source is approved at `c105b61`. Full P1/P2 gates remain open for completed three-OS builds and current-rule review. Full P3 remains **in progress** for edit/delete, backup/restore, performance, platform and integrated runtime gates. P4–P12 remain pending their ordered dependencies and reviews. P0 is the completed planning investigation. No stage is complete until its documented build, fixture, review and platform gates pass.

| Stage | Work and ordered tasks | Depends on | Deliverable / exit gate | Effort |
|---|---|---|---|---|
| P0 — Discovery | Download/pin source; reconcile selector; inspect architecture; write this plan | User request | Reviewable scope, reuse map, backlog and risks | Done: planning only |
| P1 — Baseline and contracts (**fixture foundation approved; full gate open**) | 1. Agree main base/ownership. 2. Create worktree. 3. Audit licence/data notices. 4. Freeze rule/draft/serial/IPC/transfer contracts. 5. Build one portable target skeleton | Approval | Architecture record, clean three-OS build, scoped integration patch | 3–5 days |
| P2 — Rule extraction spike (**two pilot fixtures approved; full gate open**) | 1. Build source-fixture harness. 2. Extract CQ WW CW and CQ WPX CW. 3. Compare exchanges/dupes/score/exports. 4. Assess Swift vs Python fallback using measured results | P1 | Same fixture results; documented source defects/rule disputes; revised estimate | 5–8 days |
| P3 — Persistence and recovery (**pilot source approved; full gate open**) | 1. Session/schema migrations. 2. Draft and operation receipts. 3. Serial reservations. 4. Edit/delete/recalculate. 5. Close/reopen, crash/restart, and backup tests | P1; P2 contract feedback | Durable offline contest log; no normal-log writes; reservation recovery demonstrated | 5–8 days |
| P4 — First complete desk | 1. Menu/manager. 2. Compact entry and table. 3. Score/multipliers. 4. Shared cluster/station read path. 5. Export. 6. Operator walkthrough in both workspace modes | P2, P3 | Two pilot contests usable end-to-end with isolated data; normal workflow unchanged | 5–8 days |
| P5 — Full rule catalogue | 1. Port by families in Appendix A. 2. Sponsor/edition review. 3. Golden export and mutation tests per entry. 4. Finish special dupes/rover/bonus/EDI paths. 5. Review all 94 dispositions | P2; integrates through P4 | Catalogue complete with no unsupported entry mislabeled working | 20–40 days |
| P6 — Keyboard, ESM and keying | 1. Focus/action state machine. 2. Macro migration/preview. 3. Serial bindings. 4. CW/WinKeyer/network keyer adapters. 5. Auto-CQ/Stop. 6. Voice/audio and memories | P3, P4; shared station contract | Simulator failures covered; operator hardware tests recorded by capability | 10–18 days |
| P7 — Operating assistance | 1. SCP/history. 2. Contest cluster overlay. 3. Rates/stats/trackers. 4. HamQTH. 5. Rover/operator context. 6. USB knob and remaining provider gaps | P4; P5 family contracts | Keyboard-first assist workflow and device compatibility ledger | 7–12 days |
| P8 — Digital and outputs | 1. WSJT-X route ownership. 2. FLDIGI ingest/send. 3. N1MM-format packets. 4. Scoreboard reporting. 5. Error/retry/opt-in acceptance | P4, P6; digital rules from P5 | No duplicate/wrong-log digital contacts; verified wire payloads | 7–12 days |
| P9 — Migration and normal-log bridge | 1. Not1MM schema mapping. 2. Import preview/reconciliation. 3. Preferences/assets/history mapping. 4. Repeat-safe normal-log transfer. 5. Backup/restore and rollback | P3, P4; full export mapping P5 | Source hashes/counts and unmapped fields reported; interrupted transfer recovers | 5–9 days |
| P10 — Network contesting | 1. Inspect/pin renfield protocol and licence. 2. Decide compatible adapter vs replacement authority. 3. Station identity/chat. 4. Shared serials/dupes/edits. 5. Partition/recovery tests | P3, P5; relevant P6/P8 contracts | Three-host macOS/Windows/Linux session with no serial collision or silent loss | 10–20 days |
| P11 — Three-platform hardening | 1. Native CI from P1 onward. 2. Runtime/permission fixes. 3. Clean installs. 4. Hardware matrix. 5. Long-session/performance/restore acceptance | Starts P1; closes after P5–P10 | Per-OS evidence on exact release commits; blocker ledger empty for claimed features | 8–15 days |
| P12 — Product acceptance/release | 1. Full rehearsal. 2. Normal-log regression. 3. Final rule/export review. 4. Help/credits. 5. Backup/rollback package. 6. Staged release | P5–P11 | Oliver's operator acceptance and full completion checklist | 3–5 days |

Indicative total: **88–160 engineering days** across the work packages, before contingency; first pilot P1–P4 is roughly **18–29 engineering days** if mostly sequential. These are initial planning estimates, not a fixed quote. Plan an additional 20–30% reserve for upstream rule ambiguities, platform gaps and external network/device dependencies. Parallel work can shorten elapsed time but shared seams still serialize. This does not assume additional agents or staffing have already been assigned.

Critical path: approved baseline/contracts → rule extraction + persistence → usable contest desk → full rule/export coverage and advanced integrations → cross-platform/operator acceptance. Catalogue work, assistance and read-only reporting can overlap after their contracts stabilize. Device ownership changes and shared manifests must not be edited concurrently without coordination.

### Tracking template for implementation

For each F-row and each Appendix A plugin, maintain: owner; stage; status (`not started`, `in progress`, `source complete`, `fixture verified`, `native verified`, `operator accepted`, `blocked`, `approved exception`); pinned source; rule edition; dependencies; implementation commit; test/artifact links; platform result; unresolved discrepancy; and next action. An implemented file is not a completed ticket.

Hold a brief acceptance review at P2, P4, completion of each rule family, P10 and P12. Update this plan's companion implementation ledger with scope decisions; do not hide deferred features behind a percentage-complete figure.

## 9. Cross-platform delivery contract

Shared React UI and portable Swift arithmetic/storage are the foundation. Tauri owns native lifecycle and capability-scoped access. The current `Package.swift` still excludes multiple live components outside macOS; existing prototype Windows/Linux packages do not establish live contest parity.

| Area | macOS | Windows | Linux | Required evidence |
|---|---|---|---|---|
| App/runtime | Bundled Swift/Tauri helpers; signing and eventual notarization | Bundled Swift/DLLs and WebView2 installation checks | Swift runtime, WebKitGTK/system dependency checks | Clean machine launch without developer tools |
| Core rules/storage | Same fixtures | Same fixtures | Same fixtures | Byte-equivalent normalized results and export fixtures |
| Native UI | App menu, Cmd shortcuts, multi-monitor | Ctrl shortcuts, menu/function-key behavior, DPI | X11/Wayland, scaling/window restoration | Main + detached desk tests at supported sizes |
| Files/backup | Sandbox/path and chooser behavior | Unicode paths, drive letters, locked-file semantics | Case sensitivity, permissions and atomic replacement | Import/export/recovery on representative paths |
| Credentials | Existing Keychain adapter | Existing credential/vault contract | Verify usable secret store; missing vault fails visibly | No plaintext secrets in contest DB or exported preferences |
| Radio/keyer/rotor | Supported xLog provider capabilities | Serial drivers/COM names and provider portability | Serial permissions/udev and provider portability | Device-specific checks, no broad parity inference |
| Audio/digital | Audio device permissions/routing | Device selection and disconnect | PipeWire/PulseAudio/ALSA environment behavior | Stop/error/reconnect and logged-contact routing |
| Networking | Firewall/multicast and sleep/wake | Firewall and multicast interface selection | Interface selection and reconnect | Three-host exercise, packet duplication/loss and partitions |

Architecture coverage (Apple Silicon/Intel, Windows x64/ARM64, Linux x64/ARM64) must follow the main app's agreed support matrix. Do not advertise every architecture merely because an OS is listed. Record the actual tested combinations at P1 and P11.

## 10. Migration and compatibility checklist

1. Open the source SQLite database read-only; detect version/schema and take a verified copy. Never run Not1MM migrations against a user's original database.
2. Enumerate `DXLOG`, `ContestInstance`, `Station`, `CALLHISTORY` and relevant `Contest` metadata. The large static contest SQL catalogue is not equivalent to executable plugin support.
3. Preview sessions and categories, station/operator identities, record counts, time/frequency units, original IDs, serials, exchanges, multiplier flags and unrecognized fields. Identify invalid values without silently normalizing away source data.
4. Preserve source `ContestNR`, QSO `ID`, raw record and file hash. Distinguish source duplicate contacts from import retries.
5. Map relevant fields: `SNT/RCV` to reports; `SentNr/NR` to typed exchanges/serials where appropriate; `Sect/Prec/CK/ZN/Exchange1` to rule-defined exchange fields; `RadioNR/Operator/RoverLocation/CLAIMEDQSO` to explicit contest metadata. `Freq/QSXFreq/Band` require verified units per source path.
6. Import into a new contest session transactionally with a receipt and reconciliation report. Keep source points/multiplier flags for audit, then recompute using the selected versioned ruleset.
7. Offer mappings for CW/voice/RTTY profiles, keyboard bindings, call-history fields and audio assets. List unsupported commands and platform-specific paths. Do not transfer stored passwords automatically.
8. Export Cabrillo/ADI/EDI and compare to reference files. Record deliberate corrections to known upstream formatting or rule defects.
9. Promote to normal xLog only through preview and stable identity receipts. Test repeated imports, crashes, edits and subsequent Wavelog synchronization in isolated data.
10. Restore backup into an isolated workspace and verify contest counts, rulesets, serial ledger, assets and transfer receipts. Keep the source database unchanged and available for rollback.

## 11. Acceptance and test strategy

### Rule and export correctness

Every applicable plugin needs cases for exchange parsing, valid/invalid input, all duplicate scopes, point branches, multiplier scopes, score totals, rescore after edits/deletes, category differences, portable calls, unknown country, UTC boundaries, and supported output. Add special cases for repeat periods, rover grids, county-line exchanges, prefixes, mixed-mode groupings, distance/bonus rules and digital mapping.

Build reference fixtures from pinned Python code under a suitable development interpreter, with UI/database stubs or extracted pure inputs as necessary. The initial inventory script hit the host's Python 3.9 parser limitation on `match`; metadata counts were then obtained without importing/executing the source. Future differential tests need an interpreter compatible with actual source syntax, not merely the host default or an assumed minimum. Existing source tests are a seed, not full coverage: `test/` contains 14 Python files including a helper, far fewer than 94 independent rule suites.

Use independent expected arithmetic and current sponsor examples in addition to upstream comparisons. Two implementations agreeing on the same defect is not correctness. Verify Cabrillo header/category/claimed score, UTC, frequency units, modes, exchanged values and encoding; verify EDI units/locators and ADIF byte lengths/unknown fields. Reports show operator estimates rather than implying sponsor adjudication.

### Reliability, performance and ownership

Required failure cases: double Enter; Enter while send is uncertain; crash after serial reservation; crash after local commit before reply; full disk; migration interruption; delayed lookup for an old callsign; stale detached window; context switch during receive/send; lost digital packet acknowledgement; duplicated network packet; out-of-order edit; concurrent serial requests; scoreboard timeout; USB/audio removal; and shutdown while keying.

Initial measurable targets, to be confirmed on documented reference machines at P2/P4:

- Local typing/dupe projection: p95 under 50 ms; no network dependency.
- Durable local commit feedback: p95 under 100 ms on reference SSD; durability must not be traded away to meet it.
- Score update for an ordinary appended QSO: p95 under 100 ms at 50,000 contest contacts; full rescore runs cancellably in background.
- Exercise 100,000 contest contacts plus an existing large normal log; use paged tables and bounded IPC rather than full-log UI payloads.
- A 24-hour simulated contest soak, plus restart/recovery and a rehearsed contest session. Record CPU/memory growth, dropped/repeated contacts and p50/p95/p99 timings.
- Station and Stop requests remain responsive while imports/rescoring/scoreboard work run; report WAN separately from local processing.

### Definition of full completion

- [ ] Oliver has accepted the Contesting workflow and same-xLog UI behavior.
- [ ] F01–F33 have evidence-backed dispositions; any exception is explicitly approved.
- [ ] All 94 plugin entries are accounted for; every advertised rule passes its applicable tests.
- [ ] Current-rule discrepancies are resolved or visibly versioned; no silent scoring uncertainty.
- [ ] Contest database, serial recovery, exports and repeat-safe normal-log promotion pass fault tests.
- [ ] Normal logging, Wavelog, awards, backup, cluster and station ownership regressions pass.
- [ ] ESM/CW/voice/digital Stop and stale-context protections pass simulator and relevant hardware checks.
- [ ] Multi-Multi's supported topology and recovery semantics are tested, not inferred from the upstream README.
- [ ] macOS, Windows and Linux exact-build UI/runtime tests pass on the advertised architectures.
- [ ] Source/data licences, notices, packaging, help and rollback are complete.
- [ ] No open data-loss, wrong-contest logging, serial-collision, incorrect-score/export or unintended-transmit blocker remains.

## 12. Risks, decisions and scope boundaries

| Risk / decision | Proposed treatment | Owner / gate |
|---|---|---|
| Rules mixed with UI/SQL; 94 modules have uneven depth | Extract a stable contract, prove two contrasting contests first, then port by families | Contesting / P2 |
| Sponsor rules and upstream code disagree or change yearly | Pin edition/source, retain evidence, require explicit rule updates | Product + rule review / P5 |
| `main` advances after this provenance refresh | Reconfirm the current committed baseline; isolated worktree; narrow seam changes; use the directly authorized isolated test-package exception only for test evidence, while production packaging/installation remains canonical | Main + contesting / P1 and each integration |
| Current normal draft/sync/WSJT-X endpoints assume normal logging | Introduce explicit operating-context routing before contest use | Shared integration / P3–P8 |
| Serial sent before logging, uncertain send or network partition | Durable reservations; no automatic reuse; defined multi-station authority | Core/network / P3, P10 |
| Existing Linux/Windows live service gaps | Continuous native builds from P1; per-feature capability matrix and real acceptance | Platform / P11 |
| renfield is external and upstream Multi-Multi is experimental | Pin and inspect dependency at P10; characterize protocol before compatibility claims | Network / P10 |
| Raw CAT macros bypass current safety model | Typed mappings/capability allowlist; explicit unsupported-command report | Station owner / P6 |
| Source data/font/audio licences differ from code | Inventory each reused asset; retain provenance/notices; replace assets if needed | Packaging / P1, P12 |
| Source is GPL-3.0-or-later; xLog carries GPLv3 | Preserve attribution and applicable source/notice obligations; verify dependency combinations before release | Release / P1, P12 |
| UDC/SO2R/multi-op roadmap mistaken for implemented feature | F30–F32 explicitly distinguish helper/experimental/future scope | Oliver / plan review |
| Effort underestimated from archive size/language | Re-estimate from P2/P4 evidence; retain full ledger and contingency | Delivery / P2, P4 |

Recommended review decisions: approve the native xLog architecture; separate contest storage with explicit normal-log promotion; complete phased scope rather than treating the first pilot as the final port; conservative macro compatibility; and honest treatment of upstream unfinished features. Optional sequencing preference: the proposed pilot is CQ WW CW + CQ WPX CW, with Oceania/Trans Tasman/WIA/John Moyle included in the full catalogue. Different priority contests can be moved forward without changing the overall scope.

## 13. Source pointers

Pinned upstream: [contest-sw tree at 7c8b499](https://github.com/oliverbross/contest-sw/tree/7c8b499225a73f7f8f792246881bd7aefc05452f).

- Source inventory/contracts: `pyproject.toml`, `Working_Contests.md`, `Anatomy_Of_A_Plugin.md`, `not1mm/data/new_contest.ui`, `not1mm/plugins/`.
- Actual workflows: `not1mm/__main__.py`, `not1mm.tex`, `not1mm/actions.py`, `not1mm/lib/database.py`, `not1mm/lib/plugin_common.py`.
- Representative rule inspection: `cq_ww_cw.py`, `cq_wpx_cw.py`, `arrl_ss_cw.py`, `ca_qso_party.py`; source test examples in `test/plugin_ca_qso_party_tests.py` and the other plugin suites.
- External integration: `lib/cwinterface.py`, `lib/cat_*.py`, `lib/ft8_watcher.py`, `lib/fldigi_sendstring.py`, `lib/n1mm.py`, `lib/multicast.py`, `voice_keying.py`, `rtc_service.py`, `vfo.py`, `Multi-Multi.md`.
- xLog evidence: `Package.swift`; reuse-map paths above; `docs/CW_IMPLEMENTATION_STAGE.md`; `docs/MACOS_1_1_0_RELEASE_ACCEPTANCE_2026-10-17.md` at `347beee`, with release code at `ef9861e` and subsequent consolidated `main` follow-ups through `2f3086e` at this refresh.

## Appendix A. Complete source plugin inventory

The following inventory is extracted from the pinned source and reconciled against all 94 selector entries. All are **pending** implementation/equivalence review. Mode and duplicate type are source declarations, not independently certified contest rules. Dupe types: **1** once per contest, **2** per band, **3** per band/mode, **4** unrestricted, **5** custom. Digital hook means `ft8_handler` exists; it does not imply FT8 is permitted by that contest's rules.

Proposed batching: start with CQ WW/CQ WPX CW; follow with their mode variants and common HF families; then name/state/section and national contests; then VHF/distance/rover/time-block/bonus rules and generic/expedition mappings. Each module remains a separate acceptance row even when it shares implementation with another mode.

| # | Source module | Source display name | Mode | Dupe | Additional hook | Status |
|---|---|---|---|---|---|---|
| 1 | `10_10_fall_cw.py` | 10 10 FALL CW | CW | 1 | — | Pending |
| 2 | `10_10_spring_cw.py` | 10 10 SPRING CW | CW | 1 | — | Pending |
| 3 | `10_10_summer_phone.py` | 10 10 SUMMER PHONE | SSB | 1 | — | Pending |
| 4 | `10_10_winter_phone.py` | 10 10 WINTER PHONE | SSB | 1 | — | Pending |
| 5 | `aadx_cw.py` | AADX CW | CW | 2 | — | Pending |
| 6 | `aadx_ssb.py` | AADX SSB | SSB | 2 | — | Pending |
| 7 | `agcw_qrp.py` | AGCW QRP | CW | 2 | — | Pending |
| 8 | `ari_40_80.py` | ARI 40 80 | BOTH | 3 | — | Pending |
| 9 | `ari_dx.py` | ARI International DX | BOTH | 3 | ft8_handler | Pending |
| 10 | `arrl_10m.py` | ARRL 10M | BOTH | 3 | — | Pending |
| 11 | `arrl_160m.py` | ARRL 160-Meter | CW | 1 | — | Pending |
| 12 | `arrl_dx_cw.py` | ARRL DX CW | CW | 2 | — | Pending |
| 13 | `arrl_dx_ssb.py` | ARRL DX SSB | SSB | 2 | — | Pending |
| 14 | `arrl_field_day.py` | ARRL Field Day | BOTH | 3 | ft8_handler | Pending |
| 15 | `arrl_rtty_ru.py` | ARRL RTTY Roundup | RTTY | 2 | ft8_handler | Pending |
| 16 | `arrl_ss_cw.py` | ARRL Sweepstakes CW | CW | 1 | — | Pending |
| 17 | `arrl_ss_phone.py` | ARRL Sweepstakes Phone | SSB | 1 | — | Pending |
| 18 | `arrl_vhf_jan.py` | ARRL VHF JAN | BOTH | 2 | ft8_handler | Pending |
| 19 | `arrl_vhf_jun.py` | ARRL VHF JUN | BOTH | 2 | ft8_handler | Pending |
| 20 | `arrl_vhf_sep.py` | ARRL VHF SEP | BOTH | 2 | ft8_handler | Pending |
| 21 | `ca_qso_party.py` | California QSO Party | BOTH | 3 | — | Pending |
| 22 | `canada_day.py` | CANADA DAY | BOTH | 3 | — | Pending |
| 23 | `cq_160_cw.py` | CQ 160 CW | CW | 1 | — | Pending |
| 24 | `cq_160_ssb.py` | CQ 160 SSB | SSB | 1 | — | Pending |
| 25 | `cq_wpx_cw.py` | CQ WPX CW | CW | 2 | — | Pending |
| 26 | `cq_wpx_rtty.py` | CQ WPX RTTY | RTTY | 2 | ft8_handler | Pending |
| 27 | `cq_wpx_ssb.py` | CQ WPX SSB | SSB | 2 | — | Pending |
| 28 | `cq_ww_cw.py` | CQ WW CW | CW | 2 | — | Pending |
| 29 | `cq_ww_rtty.py` | CQ WW RTTY | RTTY | 2 | ft8_handler | Pending |
| 30 | `cq_ww_ssb.py` | CQ WW SSB | SSB | 2 | — | Pending |
| 31 | `cq_ww_vhf.py` | CQ WW VHF | BOTH | 5 | ft8_handler | Pending |
| 32 | `cqws.py` | CQ WORLD SCOUT | BOTH | 2 | — | Pending |
| 33 | `cwo.py` | CWOPS - Open | CW | 2 | ft8_handler | Pending |
| 34 | `cwt.py` | CWT | CW | 2 | ft8_handler | Pending |
| 35 | `darc_schwaben.py` | DARC SCHWABEN | BOTH | 3 | — | Pending |
| 36 | `darc_vhf.py` | DARC VHF | BOTH | 3 | edi | Pending |
| 37 | `darc_xmas.py` | DARC XMAS | BOTH | 3 | — | Pending |
| 38 | `dxpedition.py` | DX-Pedition | BOTH | 4 | ft8_handler | Pending |
| 39 | `ea_majestad_cw.py` | His Maj. King of Spain Contest, CW | CW | 2 | ft8_handler | Pending |
| 40 | `ea_majestad_ssb.py` | His Maj. King of Spain Contest, SSB | SSB | 2 | ft8_handler | Pending |
| 41 | `ea_rtty.py` | EA RTTY | RTTY | 2 | ft8_handler | Pending |
| 42 | `es_field_day.py` | ES FIELD DAY | BOTH | 5 | — | Pending |
| 43 | `es_ll_kv.py` | ES LL KV | BOTH | 5 | — | Pending |
| 44 | `es_manual_key.py` | ES MANUAL KEY | CW | 5 | — | Pending |
| 45 | `es_open.py` | ES OPEN | BOTH | 5 | — | Pending |
| 46 | `eudx.py` | EUDXC | BOTH | 3 | — | Pending |
| 47 | `euhfc.py` | EUHFC | BOTH | 3 | — | Pending |
| 48 | `general_logging.py` | General Logging | BOTH | 4 | ft8_handler | Pending |
| 49 | `hadx.py` | HA DX | BOTH | 3 | — | Pending |
| 50 | `helvetia.py` | HELVETIA | BOTH | 3 | — | Pending |
| 51 | `iaru_fieldday_r1_cw.py` | IARU FIELDDAY R1 DARC CW | CW | 2 | — | Pending |
| 52 | `iaru_fieldday_r1_ssb.py` | IARU FIELDDAY R1 DARC SSB | SSB | 2 | — | Pending |
| 53 | `iaru_hf.py` | IARU HF | BOTH | 3 | — | Pending |
| 54 | `icwc_mst.py` | ICWC Medium Speed Test | CW | 2 | ft8_handler | Pending |
| 55 | `jidx_cw.py` | JIDX CW | CW | 2 | — | Pending |
| 56 | `jidx_ph.py` | JIDX PH | SSB | 2 | — | Pending |
| 57 | `john_moyle_field_day.py` | John Moyle Field Day | BOTH | 5 | — | Pending |
| 58 | `k1usn_sst.py` | K1USN SLOW SPEED TEST | CW | 2 | ft8_handler | Pending |
| 59 | `labre_rs_digi.py` | LABRE-RS Digi | RTTY | 2 | ft8_handler | Pending |
| 60 | `lz-dx.py` | LZ DX | BOTH | 3 | — | Pending |
| 61 | `nac_vhf.py` | NAC VHF | BOTH | 1 | edi | Pending |
| 62 | `naqp_cw.py` | NAQP CW | CW | 2 | — | Pending |
| 63 | `naqp_rtty.py` | NAQP RTTY | RTTY | 2 | ft8_handler | Pending |
| 64 | `naqp_ssb.py` | NAQP SSB | SSB | 2 | — | Pending |
| 65 | `oceania_dx_cw.py` | Oceania DX CW | CW | 2 | — | Pending |
| 66 | `oceania_dx_ssb.py` | Oceania DX SSB | SSB | 2 | — | Pending |
| 67 | `ok1wc.py` | OK1WC Memorial Contest (MWC) | CW | 2 | — | Pending |
| 68 | `pacc.py` | PACC | BOTH | 3 | — | Pending |
| 69 | `phone_weekly_test.py` | PHONE WEEKLY TEST | SSB | 2 | — | Pending |
| 70 | `qso_party_rst.py` | QSO PARTY RST | BOTH | 4 | — | Pending |
| 71 | `qso_party_sn.py` | QSO PARTY SN | BOTH | 4 | — | Pending |
| 72 | `raem.py` | RAEM | CW | 2 | — | Pending |
| 73 | `randomgram.py` | RandomGram | CW | 4 | — | Pending |
| 74 | `rda_contest.py` | RDA Contest | BOTH | 3 | — | Pending |
| 75 | `rdxc.py` | RDXC | BOTH | 3 | — | Pending |
| 76 | `ref_cw.py` | French REF DX contest - CW | CW | 2 | — | Pending |
| 77 | `ref_ssb.py` | French REF DX contest - SSB | SSB | 2 | — | Pending |
| 78 | `rsgb_80m_cc.py` | RSGB 80M CC | CW | 1 | — | Pending |
| 79 | `rsgb_commonwealth_beru.py` | RSGB Commonwealth BERU | CW | 2 | — | Pending |
| 80 | `rsgb_iota.py` | RSGB-IOTA | BOTH | 3 | — | Pending |
| 81 | `sac_cw.py` | SAC CW | CW | 2 | — | Pending |
| 82 | `sac_ssb.py` | SAC SSB | SSB | 2 | — | Pending |
| 83 | `spdx.py` | SPDX | BOTH | 3 | — | Pending |
| 84 | `ssa_mt_cw.py` | SSA MT CW | CW | 2 | — | Pending |
| 85 | `ssa_mt_ssb.py` | SSA MT SSB | SSB | 2 | — | Pending |
| 86 | `stew_perry_topband.py` | Stew Perry Topband | CW | 1 | — | Pending |
| 87 | `ta_vhf_uhf_contest.py` | TA VHF UHF | BOTH | 3 | edi | Pending |
| 88 | `trans_tasman.py` | Trans Tasman | BOTH | 5 | — | Pending |
| 89 | `ukeidx.py` | UKEI-DX | BOTH | 2 | — | Pending |
| 90 | `vhf_sprint.py` | VHF SPRINT | BOTH | 3 | ft8_handler | Pending |
| 91 | `wag.py` | WAG | BOTH | 3 | — | Pending |
| 92 | `weekly_rtty.py` | WEEKLY RTTY TEST | RTTY | 2 | ft8_handler | Pending |
| 93 | `wia_remembrance.py` | WIA REMEMBRANCE | BOTH | 5 | — | Pending |
| 94 | `winter_field_day.py` | Winter Field Day | BOTH | 3 | ft8_handler | Pending |
