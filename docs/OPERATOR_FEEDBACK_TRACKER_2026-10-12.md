# Operator feedback delivery tracker — 12 October 2026

This is the acceptance checklist for the operator's screenshot and live-test
feedback. Source implementation, automated tests, installation, and live
acceptance are separate gates. A passing test is not proof of a hardware or
packaged UI result. Keep unresolved items here across releases.

## Current delivery boundary

- **UI-39 source verified, 14 October:** Traditional Desk now supports Map, Logbook, Logbook above map and Logbook below map, with a keyboard/pointer vertical divider and independent Desk column preferences. Default Map does not fetch the Logbook; panes retain state after first use. Current-QSO and original Delete-consent revisions are preserved. Intrinsic Logbook work blocks navigation/close/spot activation, and late file-picker admission plus same-file retry were independently reviewed and fixed. Final full frontend **1,033/1,033 across 126 files** and production TypeScript/Vite/detached bundle gates pass. An earlier overlapping run timed out in one existing simulated-rotor test; all 23 tests in that file passed in isolation before the clean full pass. Synthetic compact/desktop/4K finish review says **ship at visual-component scope**; native/package acceptance is still pending. Alpha.21 below remains installed. [Scoped evidence and limitations](DESK_MAP_LOGBOOK_SOURCE_ACCEPTANCE_2026-10-14.md). The next independent Settings safety prerequisite is recorded in the workspace plan; global Windowed mode remains disabled.

- **Alpha.21 installed, 14 October:** Exact source `99be2c23d235a08a01329738d1fa245621aeb4bb`; full frontend **1,000/1,000**, native **319/319**, production bundle gates and all **31 packaged native acceptance checks pass**. Developer ID signing, Apple notarization, stapling and Gatekeeper pass. Installed Integration replaced in place, binaries match candidate, one host/worker pair, no hardware actions. NJ9L draft fingerprint unchanged; 67,992 active/mapped QSOs, zero dirty/outbox/conflicts, SQLite quick_check ok. Nine native Window entries observed, live cluster reception resumed with radio offline. Automatic sync remains one-minute/on; completed live run reports zero failures/deletions and **six ambiguous remote contacts held safely**, so full convergence is not claimed. Global fully windowed mode remains disabled. Exact hashes and evidence: [alpha.21](releases/v0.4.0-alpha.21-macos.md).

- **Alpha.21 recovery fix, 14 October:** Alpha.20's isolated packaged report (`dist/alpha20-56c9a55-native-acceptance.json`) passed 29 checks, including actual visible native menu routes, Settings > Sync, map rendering and detached Logbook/Awards lifecycles. Its final Spot History Dock recovery failed: the newly recreated main renderer received the retained route before editor registration was ready, refused it safely, but incorrectly acknowledged it. The reviewed fix retains refused navigation and retries on session readiness without bypassing editor guards. Focused tests reproduce held native registration and verify no premature ACK. Alpha.20 is not installed; alpha.21 full validation and packaging are in progress. Installed Integration remains alpha.16 until all native gates pass.

- **Alpha.20 source freeze, 14 October:** Alpha.19's direct isolated report (`dist/alpha19-7bd4598-native-acceptance.json`) passes 25 checks, including nine-role placement, dirty Logbook hide/restore, both Logbook/Awards Dock lifecycles and Spot History archive queries. It fails because the harness still asks for the intentionally hidden Sync menu item. The corrected test verifies actual visible menu items and Settings > Sync, retaining strict native menu validation and unchanged settings/draft checks. Full frontend **998/998 across 123 files**, production build/bundle gates, and four focused menu tests pass. A reviewed pure three-field Follow Radio reducer is included as an unconnected prerequisite; full portable Swift **464 passed / 9 explicit skips**. Native source is unchanged from alpha.19's **319/319** passing run. Neither alpha.18 nor alpha.19 was installed. Alpha.20 packaging/native acceptance is next; no full-windowed or runtime Follow Radio completion claim.

- **Native execution unblocked; alpha.18 found a real layout defect, 14 October:** User explicitly approved adding only `xlog-prototype` to lean-ctx's executable allowlist; that additive change was applied without changing other security settings. The direct private-workspace run produced `dist/alpha18-24b88ff-native-acceptance.json`: 17 checks pass, including repaired editor focus, contact edit/delete/undo and detached Logbook. It fails at `Logbook placement choice`. Independent source diagnosis found native status includes nine supported window roles while the frontend validates only six, rejecting the whole status and hiding placement selectors. This production mismatch is being corrected with exact native-payload regression coverage; acceptance gates are not being weakened. Alpha.18 remains uninstalled. Fresh read-only live baseline: 67,987 active/mapped contacts, zero dirty contacts/outbox/conflicts, SQLite quick_check ok, NJ9L draft UUID `5A7A88C6-92CE-40C5-9AC9-2EBDA4971240` revision 137 unchanged. Live Cluster shows real reports while radio is offline; no control actions used.

- **Alpha.18 packaged, signed and notarized — native acceptance blocked, 14 October:** Source `24b88ffcacfb5cf79b6ac026a7c0990385a05cff` is pushed and the exact packaged metadata matches. Full frontend **988/988**, native **319/319**, production build/bundle checks and strict signing pass. Apple submission `bda2cc96-fae1-4068-857a-bb020a84d92f` is **Accepted**; stapling/validation and Gatekeeper pass. Host SHA-256 `07f6d9fd965c890a033ec256fea8cb0f4c980a752a1c3ff3fec0a9942ec28948`; worker `8cc80e510b5c8753d397fbe360da667c99f3e4adacf886aaeaf8af4c88e972a2`; ZIP `c7b23242db9f384fe7c0ba2d6525356ad5c53d202a51ac4dd82a959e08bd4e1d`. The executable allowlist still prevents the native acceptance launch; narrow permission to add only `xlog-prototype` has been requested, not applied. Do not retry the old failed report path. The next isolated report must be `dist/alpha18-24b88ff-native-acceptance.json`. **Not installed or published. Installed Integration was freshly verified as alpha.16.** No user logbook/settings/credentials or hardware was changed. Two initial test commands through the MCP shell were routed to its different project root and failed; they are excluded from evidence. The successful frontend/native runs above used the correct explicit xLog working directory through the CLI.

- **Remaining independent-window design audit, 14 October:** A standalone Rotor child can reuse retained native telemetry and serialized controls, but connection configuration currently lives in browser-local storage. Migrate it to shared revisioned rotor-only configuration and exact typed command admission; opening/restoring/browsing must not connect or arm hardware. Dock should route to Settings > Rotator. Follow Radio still mutates the canonical draft from the main renderer; moving it requires editor dirty/invalid-input admission and workspace/draft/selection fences, not a second poller. Preserve the current three-field frequency/band/mode behavior; do not silently import the original SwiftUI app's different QSY-clearing behavior. These are audited next steps, **not implemented features**.

- **Alpha.17 acceptance failed; alpha.18 correction under validation, 14 October:** The operator-run `dist/alpha17-a9100cb-native-acceptance.json` reports `failed`, `Timed out: full editor shortcut`, after 11 successful checks. The harness still dispatched a synthetic DOM Ctrl+L even though native CmdOrCtrl+L now opens the independent editor. The corrected acceptance uses the existing native main-editor route, verifies real Escape-to-callsign focus and unchanged canonical draft, and explicitly does not claim a physical accelerator test. Monitor now exposes compact native Auto Rotor Arm/Off controls with fresh owner/generation admission. Independent review caught and corrected delayed Arm versus later Off/manual Stop ordering using a single atomic permission/epoch transition; exhaustion fails closed. Full native tests pass **319/319** and TypeScript/Vite/detached bundle gates pass; frontend validation is running. **Alpha.17 was not installed; alpha.16 remains installed.** Native execution still requires the narrow local executable policy to permit the acceptance binary; no security setting has been changed.

- **Alpha.18 source validation:** Complete frontend suite **988/988 across 122 files**, native **319/319**, and production TypeScript/Vite/detached bundle gates passed. The unchanged portable Swift worker retains alpha.17's **457 passed / 9 explicit skips** evidence; it was not rerun for this UI/native permission-only stage. Monitor component captures at 780x600 and 390x680 show the controls without horizontal overflow; these are synthetic UI evidence, not hardware acceptance.

- **Next all-window prerequisite:** Nine child roles exist. Before adding a Settings child, replace unversioned whole-form settings saves with workspace-generation/revision checks and dirty-form/lost-acknowledgement recovery. Otherwise independent Settings editors can silently overwrite one another. Station Control, Chaser & DX, CW ownership and remaining panel roles still need migration; the global Windowed preset remains disabled.

- **Alpha.17 packaged — native acceptance still pending, 14 October:** Reviewed source `a9100cbe8ee5252eb0273ed041125a9ceb7cec12` is pushed and packaged as **0.4.0-alpha.17**. Packaged metadata matches that exact commit. Developer ID hardened-runtime signing, strict signature verification, Apple notarization (`79a2c7d8-04ef-4479-9a85-1b5207a6afb3`, Accepted), stapling/validation and Gatekeeper assessment all pass. Host SHA-256 `e669893234e04997f61da6f47542797352caaefdd3dcf892c9a04101194376b1`; worker `b87b55a80d6822e1cb027e43aa6afea28b46d0adc208adc5f91d03b11a1df581`; final release ZIP `400e79c9426516ae904d2251398c7fd38ab6e77b7c54fd6d240aba111dcaafce`. The first CLI package attempt hit its 120-second runner limit during release compilation; the supported background runner with a longer timeout completed successfully. This closes only the packaging portion of the source checkpoint below. **Not installed or published; alpha.16 remains installed and no user data/hardware was changed.** The earlier permanent native-launch restriction was not retried or bypassed. User has approved routine in-place updates and offered to run the exact isolated acceptance command below. Its report proves generated local workflows, Logbook/Awards singleton/Dock behavior and actual Spot History main-destroyed/read/Dock/recreated-main behavior; it does not prove main-absent World Map/Monitor/QSO operation, live click-to-tune, AutoRotor, QRZ, Wavelog convergence or physical hardware. Global all-window mode remains disabled.

  Run once in Terminal; the report path must not already exist. This uses the private acceptance workspace, not the operator logbook, and denies external services/hardware. After completion, inspect the report before replacing Integration; do not infer success solely from a process exit.

  ```sh
  "/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog Integration.app/Contents/MacOS/xlog-prototype" --acceptance-report "/Users/oliver/Documents/Projects/OM0RX-xLog/dist/alpha17-a9100cb-native-acceptance.json"
  ```

- **Next independent-window slice:** Add the existing native Auto Rotor Arm/Off action to Monitor, with exact owner/generation checks and no dependency on the Desk renderer. Then add a scoped standalone Rotor window; its configuration transport must not inherit radio or credential access. Station Control and Settings/Sync are still separate window migrations. The current candidate does not enable the global all-window mode.

- **Detached click-to-tune — source verified, alpha.17 candidate, 14 October:** Desk, Cluster, World Map and Band Maps now use a native, opaque report-identity activation path independent of the Desk renderer. Open editors freeze and acknowledge clean local state before a revision-checked draft write; unresolved input is retained and vetoes activation. Durable receipts grant each radio/rotor effect once. Lost writes reconcile through a transactional cancellation tombstone, never a missing-receipt assumption or replay. Provider/source and worker generations are checked at command admission. Automatic rotor following remains restart-off, requires confirmed spot tuning, and retains the existing verified QRZ coordinate/grid lookup with CTY fallback. Canonical-change wakeups are coalesced. Review also repaired same-draft frequency/UTC buffer refresh, navigation/layout/Hide, embedded historical-edit and close-time late-update races. Full frontend passes **975/975 across 121 files**; native Rust **311/311** (293 unit, 18 dummy-backend integration); portable Swift **457 passed, 9 explicit skips** (466 registered). TypeScript, production Vite build and detached bundle/CSS gates pass. The full frontend run used one worker and command-line 15-second runner deadlines, not altered application deadlines. Synthetic desktop/390px component captures retain unfinished input without horizontal overflow; these are not native or hardware evidence. The initial frontend run found one obsolete renderer-tune source assertion, replaced by behavioral native activation/lost-ACK/no-replay/no-false-confirmation coverage before the full passing rerun. Packaging and actual main-absent acceptance remain open. No hardware controls were exercised, no package installed, and alpha.16 is unchanged. This does not complete all-window mode, Clear after QSY, cloud backups or the remaining RUMlog workflow audit. The user approved routine in-place replacement; the existing native-launch execution restriction, not missing approval, is the remaining acceptance handoff constraint.

- **Independent Monitor — source verified, 14 October:** Monitor now reads retained native radio-selection, telemetry and independent rotor context without the Desk renderer. Optional map/lookup failures cannot disable owner-checked Stop. Radio actions bind to selection UUID/generation and native freshness/capability checks; old raw Monitor station actions are denied. Full frontend 914/914, native 255/255 and TypeScript/production bundle gates passed. Synthetic 780×600 normal/stale captures show Stop inside the viewport after shrinking the optional map; these are not native or hardware evidence. Serialized Goto→Stop order is preserved, but a pending driver reply can still delay Stop. All-window mode remains disabled. User explicitly requires detached click-to-tune to be finished before the next Mac installation; alpha.16 remains running while the activation prerequisites are implemented.

- **Bounded synchronization — source verified, 14 October:** Full remote JSON/ADIF/history verification is retained, then merge, remote-deletion/conflict and pending traversal run in at most 128 physical-row steps. Registered foreground database work gets admission before the next background step. Database run tokens and workspace leases fence overlapping runs, replacement, cancellation and late acknowledgements. Independent review passed; the complete portable Swift suite passed 445 tests with 9 explicit skips and zero failures. Both opt-in generated 68,000-contact benchmarks passed separately, including deterministic foreground-read-before-next-step and preservation assertions; per-phase timing output was not retained, so no quantitative speedup is claimed. This stage is not yet installed and does not prove live Wavelog convergence or whole-app logging latency.

- **Independent-window package gate — 14 October:** Source `4f029a6` built an ad-hoc-signed Mac candidate successfully and passed strict bundle signature verification. Host SHA-256 `12bd4f6bae357f586edf6406ac5239935347ff394be6fef6568a8943800e69fd`; worker `1ce99ca546552b3106cebc30a7cb30430566d39f7b582873f8bfb6a605d2fdeb`. The local command policy permanently denied the exact candidate executable before launch; no isolated acceptance report was produced and no bypass was attempted. Main-destroyed runtime acceptance remains open. This candidate was not installed or published; alpha.16's tested release source below remains running.

- **Sync/foreground contention reproduced — 14 October:** An opt-in generated 68,000-contact database test passed all identity, dirty-edit/deletion, conflict, remote-deletion/resurrection and idempotent-Save preservation assertions. Under concurrent package load, whole-snapshot unchanged reconciliation took 17.27 seconds and its concurrent draft read 17.29 seconds; a 1%-changed full snapshot took 11.76 seconds and blocked the draft read for 11.76 seconds. Post-lock draft replace/Save took milliseconds. An earlier lighter-load run measured 7.3/6.7-second holds. These are synthetic wall-clock observations, not speed thresholds or proof of the installed worker's retirement cause. Bounded reconciliation with foreground admission is the next source stage; full remote-ID/deletion verification must remain intact.

- **Independent-window source verification — 14 October:** The frozen next stage passed 895 frontend tests, 240 native tests (222 unit plus 18 dummy-backend integration), portable Swift's 222 XCTest cases (2 platform-gated skips) plus 221 Swift Testing cases, TypeScript/Vite and strict detached bundle/CSS-order checks. The full frontend run used one worker and a command-line-only 15-second runner deadline on the loaded workstation; default-deadline runs had timeouts whose original workflows passed isolated. Application safety deadlines/assertions were unchanged. This is source/fixture evidence, not a logging-latency benchmark or native main-absent acceptance; an isolated packaged run is next. Alpha.16 remains installed.

- **Next independent-window stage — source only, 14 October:** Callsign Intelligence now has a read-only native window following the canonical new-QSO draft. World Map/Band Maps read retained native context and save scoped, revision-guarded preferences without the main renderer. Map clicks currently inspect reports only: independent QSO/radio activation remains an explicit open gate, not a completed replacement for the existing main-mediated actions. The source also fixes owned draft-warning recovery and adds isolated Spot History main-destroyed/read/Dock/recreated-main acceptance. Full regression and bundle verification are in progress; none of this stage is installed. Alpha.16 below remains the testing baseline.

- **Current installed baseline — alpha.16, 14 October:** User explicitly requested installation of the tested changes. Source `03840acb055696d7311fe7c84508350902c119ad` is signed, notarized, installed in place and verified running with one host/worker pair. All 67,973 contacts and the NJ9L draft remain; native Spot History/Dock back and Logbook column controls were inspected. [Release and installed evidence](releases/v0.4.0-alpha.16-macos.md). Further parallel map ownership, Callsign Intelligence, draft-warning recovery and isolated main-absent acceptance work is not in this package. The alpha.15 and source-stage notes below are historical checkpoints.

- **Current installed baseline — 14 October:** Integration **0.4.0-alpha.15**, source `a2c04468909928f0a9a95372892582750e0f4eb0`, is signed, notarized, installed and published. Installed Mac checks confirm the revised intermediate-width desk, contained RST R, recovered cluster startup and real spot reception with the radio offline. The last verified local count was 67,970, with the NJ9L draft preserved. Detailed evidence is at the end of this document. Earlier checkpoints and “not installed” table entries are historical source-stage evidence, not the current package inventory; inclusion in alpha.15 does not imply every feature has received native/operator acceptance.
- **Current source-only Mac-first stage — 14 October:** UI-29 (country/DXCC context), UI-39's configurable Logbook-column foundation, an independent Spot History window, and native sync-completion notifications are implemented and undergoing combined verification. RADIO-05 (Clear after QSY) has a shared-draft safety/design review, not a working setting. Alpha.15 remains running while the user tests; this stage does not replace it. Full map/logbook stacking, all-panel undocking, cloud backup and remaining native acceptance remain open.
- **Full-list clarification — 14 October:** Alpha.15 is not fully windowed or RUMlog-parity complete. Its native inventory has seven supported windows versus 21 panel roles; the new source adds Spot History as the eighth. Maps/Monitor still depend on main-renderer projections. [RUMlog comparison](RUMLOG_WORKFLOW_GAP_AUDIT_2026-10-14.md) records actual native Window-menu observations, official-documentation comparisons and uninspected Settings/menu scope. DATA-10 has existing basic ADI import/export, not the requested complete preview/scope workflow. Performance and live sync acceptance remain separate from source fixes. A fresh read-only local snapshot has 67,972 active contacts, all mapped to Wavelog IDs, zero dirty rows, zero outbox entries and zero conflicts; the remote count was not independently checked.

- **13 October Mac refresh:** User explicitly requested updating the installed app and prioritizing macOS before further Windows/Linux work. Installed signed/notarized `df38763` (Mac resource-packaging correction over `5ab88fb`), with Spot History, shared draft/contact recovery, native menus and saved workspace settings. Verified the installed app loads 67,906 contacts, ShackCQ receives live spots, and the separate archive contains 101 reports. No RF commands were issued by the agent. See [Mac refresh evidence](MAC_REFRESH_2026-10-13.md); this is a bounded installed smoke check, not full parity acceptance. The unfinished native-attempt/status refinement remains uninstalled.

- **13 October Workspace settings / CI follow-up:** Settings now manages named layouts independently of connection settings: inspect, duplicate, rename, choose supported panels, lock/snap, explicitly activate, or delete an inactive custom layout. Traditional remains protected; Spot History is an optional canvas panel. Stale full-preset edits reject before writing and retain the draft. Source tests and synthetic compact/desktop/4K-scaled review pass; native installed verification and remaining windowed roles are open. Exact `6683d1b` CI failed on a Windows resolver test scheduling assumption and a missing Rust history acceptance allowlist; both are corrected in source, not yet runtime reaccepted. See workspace checkpoint Z and the corrected Spot History acceptance evidence.

- **13 October portability/acceptance follow-up:** First Spot History matrix `38373959406` exposed the Windows CoreFoundation import regression. Portable scalar validation is corrected and tested; new native acceptance now requires a generated retained archive/search/details/page-remount check. Full local frontend 590 tests, rebuilt portable Swift and TypeScript/Vite gates pass. Workspace schema v2 safely adds hidden Spot History/Monitor roles without resetting existing presets or revisions. Renewed exact-source CI and installed acceptance remain required; no live archive or operator layout was changed. See Spot History source acceptance and workspace checkpoint Y.

- **SPACE-13 (13 October):** Global “Tuning…” progress row removed in source. IOTA/POTA/SOTA/other reference verification now shares the Active QSO / Active contact heading, right-aligned, in traditional/custom desk and full editor. Errors and authoritative radio/rotor fences remain. Six new component/wiring checks pass alongside existing editor/desk tests (43 focused total); TypeScript/build/detached CSS gates pass. Production-component browser captures at compact, desktop and 4K sizes passed independent scoped review. Temporary fixtures removed. Not installed yet.
- **HISTORY-01 (13 October):** First Spot History source slice implemented using the audited `om0rx-radio-control` reference and [implementation contract](SPOT_HISTORY_IMPLEMENTATION_PLAN_2026-10-13.md). Separate SQLite archive retains individual reports before live grouping, original source/comment, arrival/report UTC provenance and durable recording-health evidence. Native View/menu route, main-only read API, bounded writer, stable paged search and full-scope statistics are integrated. Full frontend (579), Rust (154) and rebuilt portable Swift suites pass; compact/desktop/4K synthetic browser review passed. [Source acceptance](SPOT_HISTORY_SOURCE_ACCEPTANCE_2026-10-13.md) records exact counts, benchmark and limits. Advanced filters, export/retention, richer charts and detached history remain follow-up scope. New exact-SHA CI and installed acceptance are pending; the running app is not yet recording history.

- Working tree: shared cross-platform xLog; Mac-first delivery.
- Historical 13 October installed checkpoint: Integration alpha.13, source `df387639b77e55d92821560b0cdc5c54fbe2f945` (superseded by alpha.15 above). Earlier 21-check acceptance belongs to `e126d6f4`, not this package. Wider parity gates remain open.
- Individual runtime checks and remaining gates are recorded below and in the alpha.7 acceptance report.
- Restart of Integration was explicitly approved once the build passes.
- Preserve the latest operator draft, all logbooks/settings/credentials, and
  `/Applications/OM0RX-xLog.app` (the original native app).
- No PTT, RF Tune, CWX, OPERATE or RF transmission acceptance is authorized by
  this UI update. Do not tune a spot just to test layout while auto rotor is on.
- Commit and push reviewed source; sign/notarize the exact package; update the
  Integration app in place without extra archived app copies and publish an exact
  prerelease. Stable native release must remain available.

### Configurable workspace and native windows — 13 October

**Current priority: persistent Wavelog sync.** User approval is explicit. The installed manual run imported 60 contacts, including OE1TKS, with all 67,846 original active local identities retained. Three older remote IDs remain missing locally due to the now-fixed semantic-ID collapse. The 13 October Mac refresh installs the semantic-ID fix, automatic scheduling and explicit Sync controls, but automatic synchronization has not yet been enabled or verified on the account. See the active-priority section in the workspace plan for exact counts, protections and remaining live acceptance. Do not report “kept on” from a manual run or source-only tests.

Tracked in [the workspace implementation plan](WORKSPACE_CANVAS_AND_NATIVE_WINDOWS_PLAN_2026-10-13.md), WS-01 through WS-08. Preserve the existing docked layout, allow selective undocking of **every screen including Logbook**, and support fully undocked operation. All panels need show/hide, move/resize and saved arrangements. Native menus replace navigation links without dropping station information or existing destinations. RUMlogNG menu/settings/workflow comparison is queued as RUM-01 through RUM-03; its detailed audit is not complete.

The first source stage adds a durable revisioned operator draft and atomic Save/receipt transaction, with 10 focused tests and Rust boundary tests passing. It is not yet wired to the UI. Main-renderer polling/projection extraction, editable logged-contact revisions, canvas, menus, window lifecycle and native/OS acceptance remain open; no full-undocked claim is made.

Latest layout checkpoint V adds the renderer recovery/IPC client and native layout invalidations on top of U's portable SQLite layouts. Known detached windows receive read-only layout access; stale or uncertain writes preserve intended changes, and retries require fresh generation/revision checks. All 532 frontend tests and 136 native tests pass; build and detached bundle gates pass. A new isolated packaged preset read/write/readback/conflict check is required but not yet executed. Settings/canvas wiring and remaining independent windows are still open. The user's traditional, mixed and fully windowed choices remain one requirement; traditional layout is not being removed.

The next source checkpoint extracts Cluster polling and detached commands into a native shared owner, retaining last-good spots on service failure and rejecting command replay/late shutdown results. Scope and remaining renderer dependencies are documented under checkpoint B in the plan. Rust: 87 passed; frontend: 367 passed; TypeScript/Vite build passed. Isolated browser stale/recovery checks passed; compact all-column readability and full-height panel use remain open (WS-08). No new package installed. Prior draft checkpoint `bdeea58` passed all-platform CI `38317820765` and Mac `38317780404`; these do not cover the new Cluster changes.

Checkpoint C adds a tested frontend draft client and correlated IPC adapter: journal-before-write, revision conflicts retaining local text, receipt-first recovery, same-ID retry and duplicate-Save prevention. It was not connected to `LiveApp` until checkpoint D below. Existing installed editor behaviour is unchanged. See the workspace plan for the complete migration gate; all-screen undocking is still open.

Checkpoint B source `5670cd7` now passes all-platform matrix `38319902334`, including Windows/Linux runtime checks, and Mac push `38319864420`. Checkpoint C client tests: 20 focused and 387 full-suite frontend tests pass. These results do not close native main-window-absent, editor migration or physical hardware gates.

Exact installed alpha.13 source `e126d6f4ba7009494db76f9fbf49ed4ca44ff8a9` now has successful three-platform run `38314805976` (Mac/Windows/Linux build jobs plus Windows fresh-runner and Linux runtime-only acceptance). Push Mac run `38314721512` also passed. These results apply to alpha.13, not the new workspace source stage, and do not prove physical desktop or radio acceptance.

Checkpoint D connects the current Desk/full editor to the shared new-contact draft, with explicit conflict/receipt recovery, separate logged-contact editing, optional legacy-text recovery and a restore lock. Delayed pre-Save/Clear reads cannot introduce false conflicts. TypeScript, Vite and 398 frontend tests passed; isolated browser recovery checked at 1280/800/640 px with Rotor Stop outside the QSO lock. WS-08 additionally tracks clipped date/band controls at intermediate widths. Native/package acceptance remains pending; alpha.13 is still installed. Checkpoint C Mac CI `38321507510` succeeded, separately from these new changes. See checkpoint D in the workspace plan for limits and evidence.

Checkpoint E adds the existing-contact backend needed by detachable Logbook: per-contact revisions, atomic Update/Delete/Undo receipts, stale-edit conflicts, preserved identity/mapping and trigger coverage for every database writer. At E it was not yet wired into the editor. Ten focused tests, shared/native Swift regressions and Rust tests pass. On a generated 100,000-contact log, database-only p95 read/update were 0.064/0.553 ms; this is not whole-app speed evidence. See checkpoint E in the workspace plan. Checkpoint D Mac CI `38323200735` and `38323200520` passed; Windows/Linux runtime were skipped, not accepted.

Checkpoint F connects existing-contact Update in the main Desk/full editor to revision checks and durable receipt recovery, retaining the independent new-QSO draft. It covers renderer restart, conflicts/removal, unavailable receipt service, exact retry identity and backup-restore blocking. TypeScript and all 419 frontend tests pass; isolated browser recovery was checked at 1280/800/640 px with evidence under `/tmp/xlog-contact-qa-rOgMqL`. Native restore-generation fencing, table Delete/Undo migration and all-screen undocking—including Logbook—remain open. The old docked layout is preserved. No new package is installed; alpha.13 is unchanged.

Checkpoint G fences draft/contact edits and receipt recovery across backup replacement using a durable workspace generation outside the backup payload. Old and pre-generation journals retain text but cannot replay writes; explicit current-workspace recovery is required. Shared Swift regression tests (96 Swift Testing cases plus XCTest suites), TypeScript, 429 frontend tests and Vite build pass. Narrow/wide recovery UI and actions were checked in an isolated browser fixture. Table Delete/Undo migration and all-screen undocking remain open. See checkpoint G in the workspace plan for evidence and limits. Installed alpha.13 is unchanged.

Checkpoint H moves table Delete/Undo off the legacy ID-only calls. Confirmation and Undo use exact contact revisions and workspace generations, durable receipts and journal-before-send recovery. The latest Undo survives navigation/restart; unresolved operations block backup replacement. Full frontend suite: 441 passed; TypeScript/Vite pass. Isolated browser recovery/action checks passed at 1280/640 px. See checkpoint H in the workspace plan; compact Logbook sizing, independent windows, native menus and exact packaged acceptance remain open. No new app installed.

Checkpoint I adds a shared complete screen inventory and native Logbook/Station/View routing, including Logbook. Window discovers the four already-implemented detached surfaces; the old sidebar remains until native routing/recovery acceptance. Native pending-route revisions survive early menu clicks and reject stale acknowledgements. Standalone Sync routes to Settings without service mutation. Source tests: Rust 90, frontend 450, TypeScript/build pass. The isolated native acceptance harness now also requires menu routes and logged-contact Update/Delete/Undo; actual execution and native visual review are pending. This is not all-screen undocking or an installed release.

Verification follow-up: H passed all five jobs in all-platform run `38328817888`. I (`1bc5e95`) passed Mac CI `38329953244` and general CI; its CI bundle has verified matching source metadata and an ad-hoc signature. All-platform I run `38331060293` is pending. Local isolated launch was blocked by the command runner and produced no acceptance report; native screenshot capture was unavailable. The briefly opened candidate was stopped, and installed alpha.13 was restored with one app/worker pair, 67,846 contacts and ShackCQ Connected. No new installation or RF test occurred. See checkpoint I in the workspace plan for the exact artifact and limitations.

I subsequently passed all five jobs in `38331060293`; downloaded Windows first/relaunch and Linux X11/Wayland reports verify its 19 integrated-local checks. J adds the actual detached Logbook in source: existing table/editor, isolated recovery journals, revision-safe Update/Delete/Undo, cross-window refresh, scoped permissions and protected Close/Dock. 459 frontend tests, 92 Rust tests and TypeScript/build pass. Its new native detached-window acceptance check, visual review and installation remain pending. The docked layout is retained, and all-screen/full-undocked completion is still open. See checkpoint J in the workspace plan.

### Alpha.8 installed checkpoint

The signed/notarized alpha.8 bundle passed all 21 generated large-log checks
and is installed. Logbook display measured 72 ms and cold/repeat Awards
697/31 ms in the isolated native test. The real 67,846-contact workspace and
automatic cluster reconnection were retained. Exact package and installed
observations are in `ALPHA8_INSTALLED_ACCEPTANCE_2026-10-13.md`.

**CHASER-01 was found in alpha.8 and is fixed in alpha.9:** KFF WWFF references
appeared as duplicate POTA rows. Reproduced with K5G / KFF-3017 and KE2CIE /
KFF-2099, repeated after Refresh view and confirmed with Programme POTA.
No row was loaded or tuned.

Alpha.9 source correction: the shared parser now excludes WWFF references,
SOTA reference tails and explicitly labelled castle references from POTA
candidates. Directory resolution uses the same rule. Chaser rows identify their
programme beside the reference without adding a column. The regression first
failed against alpha.8 source, then passed after correction. Full frontend
350/350, native core 73/73, worker 139 XCTest plus 59 Swift Testing cases, and
TypeScript passed. Installed alpha.9 shows KE2CIE / KFF-2099 once as WWFF;
Programme POTA excludes it. Refresh view adds the genuine POTA US-9309 spot
separately. Alpha.8 was not published as a GitHub release.

### Alpha.9 installed checkpoint

The signed/notarized package passed all 21 isolated native large-log checks with
100,002 generated contacts: logbook 69 ms, cold/repeat Awards 689/18 ms. These
are single-run observations, not app-wide median/p95 acceptance. ShackCQ
reconnected automatically after installation; the empty draft and 67,846-contact
workspace were retained. See `ALPHA9_INSTALLED_ACCEPTANCE_2026-10-13.md`.

Exact alpha.9 CI `38298414791` passed Mac, Windows and Linux builds, Windows
fresh-runner runtime acceptance and Linux runtime-only container acceptance.

### Portable live cluster follow-up

Windows/POSIX socket transport and shared worker routing are implemented in the
next source stage. Six owned-loopback tests cover login, framing, IPv4/IPv6,
reconnect, cancellation and no command replay. Workspace tests cover Chaser,
configuration persistence, unavailable secure storage and terminal shutdown.
Capability messages retain the existing compact cluster settings layout; browser
fixtures at 1280×800 and 1920×1080 confirm readable messages and disabled controls.
This does not replace native WebView acceptance. Windows/Linux secure password
storage and FLEX forwarding remain open. DNS follow-up now bounds the full
connection deadline and outstanding resolver jobs, releases stopped connections
before OS resolution returns, and rejects late answers; six additional tests and
AddressSanitizer pass on Mac. Exact follow-up OS acceptance remains open. The
installed alpha.9 has not been replaced. See `PORTABLE_CLUSTER_STAGE_2026-10-13.md`.

### Shared public services follow-up

Weather and propagation now route through one workspace-owned shared service,
using the native parsers and bounded credential-free HTTP downloads. Portable
callsign lookup resolves offline CTY and geometry instead of rejecting the whole
operation. QRZ authentication and portable secure stores remain open, not silently
substituted by CTY. Shutdown cancellation, changed-grid rejection, retained stale
propagation and concurrent request coalescing have fixture coverage. This source
stage has not replaced installed alpha.9. See `PUBLIC_SERVICES_STAGE_2026-10-13.md`.

### Windows cluster credential follow-up

The source now wires Windows Credential Manager into the cluster vault using an
exact namespaced service/account adapter, bounded UTF-8 blobs and no plaintext
fallback. Mac Keychain is unchanged. Local validation tests do not prove the
Windows API branch; a dedicated CI-only random-identity round trip is required.
Linux vault support and authenticated portable services remain open. See
`WINDOWS_VAULT_STAGE_2026-10-13.md`.

### Cluster settings save regression (CLUSTER-02)

Reported 13 October: saving colours disconnected every cluster and erased all
received spots. The cause was an unconditional disconnect and history reset in
`ClusterSessionService.configure`. The correction preserves sockets, spot IDs,
timestamps and console history for display edits; reprojects colours and special
rules; reconnects only added or changed enabled endpoints in a running session;
and leaves explicitly disconnected sessions offline. Retry/skimmer options update
in place. Credential lookup failure leaves the existing connection untouched;
late callbacks from replaced sockets are rejected independently per server.

Regression coverage includes multi-server replacement, retained history, palette
and rules, offline saves, credential failure, terminal shutdown, worker Save
dispatch, and owned-loopback live option changes on both Mac and portable socket
implementations. Local tests: 159 XCTest (one Windows-only skip), 68 Swift Testing,
353 frontend, TypeScript and five worker-process tests pass. Spot retention
here means across settings saves and reconnects, not a new disk-backed history.

Alpha.10 installed acceptance: source `5ecf265e1684939aebc2e6de5d90cc82da68afff`,
Developer ID team `4WCMQ4U946`, notarization
`008f827a-313f-4a21-8fd8-57afacb79095` Accepted. Strict signature, staple and
Gatekeeper passed. Archive SHA-256
`15b1a241416987195b4564216c53710fad309fa7642cb14b14e0743b6a8d4998`.
All 21 isolated packaged checks pass in
`evidence/native-ui-alpha10/mac-signed-large.json`, including 100,002 records and
70/70 map probes. Single-run logbook 82 ms; cold/repeat Awards 717/33 ms; history
219/213 ms, render 32 ms. These are not p95 measurements.

Installed live Save pressed twice: ShackCQ remained Connected; the second retained
11 received / 8 shown spots before and after Save. No colour or endpoint was changed
in the operator's configuration; those cases have automated regression coverage.
Latest H49A / 24.911000 MHz / 12m / SSB draft survived restart, as did 67,846 contacts.
Original native app hash remains
`7a2b244545c9eb2639cde5f0a152c9cfaf40e2e06fde9ad97fd3184e37efdb97`.
No radio/rotor command was sent. Exact-source OS matrix `38307750798` is pending.

### Chaser usability and parity follow-up (CHASER-02)

CHASER-03 (13 October follow-up, installed and verified in alpha.13): move DXpeditions immediately after All;
make map follow programme/filter selection and show supplied coordinates or
clearly marked reference-area locations. Include recent IOTA-tagged cluster
spots and dated calendar operations carrying IOTA references in the IOTA tab.
Separate scheduled operations from live spots, show dates and location evidence,
and explain unlocated rows instead of inventing precise markers. Calendar rows
without frequencies must remain mappable when defensible location data exists.

New operator screenshots, 13 October: automatically load and refresh public feeds;
remove per-feed Check requirements; replace Programme dropdown with programme
tabs below source health; use the full available table area; remove the duplicate
Chaser page/manual-sync header and bottom public-source prose. Explain that source
health is live-feed status, not the complete reference directory. Add an optional
map below the table for references with authoritative coordinates. Compare actual
ShackCQ source and record missing functionality; do not call the current surface
full parity. CLUSTER-02 installed acceptance is complete; this is the next stage.

Initial read-only comparison: ShackCQ/Nexus `PotaSotaView.tsx` at
`12efe3d2970729465add40d62cecd76bbaf5b63f` already has automatic 60-second refresh,
programme tabs, persistent per-surface band/mode/sort filters, hide-worked-today,
new-park status, and detached boards. The alpha.11 source now implements automatic
refresh, programme tabs, saved band/mode/sort filters and the optional map. It
still lacks worked-today filtering, hunted-reference CSV import, detached Chaser
boards, and complete activator/contest workflows; those parity gates remain open.
Its existing reference-history counts are lifetime reference totals, not proof of
the same activator/reference being worked today. That distinction must remain
honest. Public spot posting and station tuning are separate safety-gated actions,
not side effects of opening or refreshing Chaser.

Source checkpoint for alpha.11: full frontend suite 357 passing, TypeScript
passing; shared Swift suite 159 XCTest cases (one Windows-only skip) and 70 Swift
Testing cases passing; five worker-process checks passing. Final WWFF epoch-time
fix passes the nine focused Chaser tests. Browser fixtures checked at 1280x800,
1440x900 and 2560x1440: table pagination follows available height, optional map
fits beneath it, programme filters persist, full-cluster columns retain hidden
state and widths. Impeccable layout detector reports no findings. Evidence in
`docs/evidence/chaser-cluster-alpha11/`; these are source/browser results, not
installed alpha.11 or hardware acceptance.

### Cross-platform local logbook work after alpha.7

The non-macOS worker previously rejected all workspace/logbook requests with
`platform_pending`. The shared SQLite logbook, settings, CTY/awards and verified
backup paths now compile into its portable core and route through the same
handlers. Linux and Windows packaging must include the Swift resource directory.
`--local-logbook-self-test` exercises a disposable workspace, unknown ADIF fields,
editing, deletion/undo, CTY/awards resources, backup/restore and reopen. It never
opens the operator's workspace, credentials or hardware.

Mac regression: 73 core tests, 138 worker XCTest tests and 42 Swift Testing cases
passed. The two CTY identity assertions were also rewritten to avoid a Swift
Testing macro incompatibility in CI's older Mac toolchain. Native Windows/Linux
build and runtime results remain pending; network services and credential stores
remain explicitly unavailable on those worker platforms. This is not full
cross-platform parity, and the installed alpha.7 app is unchanged.

First native matrix run: `38280083999`, source `3a4147a`. Linux and Windows found the omitted
`ClusterSpotFeed.swift` dependency that owns Maidenhead decoding; Mac passed
Swift tests and all 344 frontend tests, then failed TypeScript because clean
installs lacked `@types/node`. Both source issues are corrected for the next
run. Backup import now accepts native Windows drive/UNC paths while rejecting
traversal and device namespaces; three portable path tests plus fifteen local
logbook tests pass on Mac. Local frontend build and 344 tests pass with the
explicit Node types dependency. That run still used the earlier synthetic UI
harness; the current LiveApp driver below replaces it for the next run.

Matrix run `38281076782` at `04ecbc4` found unresolved CoreFoundation type IDs
in the station bridge. Run `38281893795` at `f588213` confirmed the explicit
import fixes Linux compilation, but Windows does not expose that module. Numeric
validation now uses Foundation's JSON scalar representation to reject Booleans
without platform-specific type IDs. Tests cover JSON true/false, numeric ports,
small integer NSNumber values, NaN and infinities. Linux also exposed an xCat
import outside the existing macOS-only rotor test guard; the import now shares
that guard. Matrix run `38282914334` at `1e8a14d` passed the Mac source job.
Linux compiled and passed Swift tests, then stopped at the missing native Hamlib
sidecars. Windows compiled and ran its portable tests; one alias-path rejection
returned a bootstrap error instead of the common `unsafe_workspace` IPC error.
The rejection remains intact and its error is now normalized. These latest
corrections require another native matrix run.

Linux now has a checksum-pinned Hamlib/libusb build recipe; Windows stages the
checksum-pinned upstream Hamlib archive and records its DLL provenance. Both
portable packages include radio/rotor helpers, upstream notices and their native
dependency audits. CI runs model-1 loopback dummy tests, never physical-device
tests. Linux shell syntax and two runtime-permission tests pass locally.
PowerShell execution is blocked by the local tool policy; Windows CI must verify
that staging and packaging path. No compatibility claim for every radio or rotor
model follows from a dummy-device pass.

Follow-up matrix: `38285494988`, exact source
`c4e0562c8e74a23ef23d15ba1e051b59826ffa45`. Mac and Linux source/package jobs
passed, including Linux Hamlib compilation and model-1 dummy tests. Windows
passed portable Swift tests, then failed one frontend test whose background poll
could update the rendered rotor owner before its simulated Stop click. The test
now captures the old button before changing the preflight response and clicks
without yielding; its no-redirect/no-command assertion remains intact.

Linux runtime acceptance stopped before the UI: its framing harness assumed
completion order for independent correlated worker requests. Both OS harnesses
now require exact response IDs/error coverage without assuming completion order.
Two new harness tests cover all response permutations and reject missing,
duplicate or incorrect replies; the real-worker framing harness also passes on
Mac. Windows native packaging and Linux/Windows native UI acceptance remain open.

### Shared local contact intelligence follow-up

The `cluster_history` IPC name is retained, but the database-only handler now
runs on the shared logbook lane on all operating systems. It reuses the same
indexed candidate query and exact projection for prior-QSO counts, confirmations,
country band/mode matrix and latest entity QSO. It no longer constructs the
Mac-only cluster/vault service to answer an offline history request. The three
history projection tests now compile for portable targets; a new isolated-worker
test verifies this route while live cluster requests remain denied. Integer
parameters reject Booleans, fractions and out-of-range values rather than
truncating NSNumber values.

Acceptance workspace creation now explicitly disables native-preference
inheritance. The earlier native passes used separate writable workspaces but
could read safe native station defaults during creation; they did not alter
native preferences. The stricter deterministic setup needs another native pass.
Current Mac source verification: 139 XCTest cases, 48 Swift Testing cases, 94
Rust tests and 19 focused rotor UI tests pass; TypeScript/Vite also passes.
The planned 100,000-QSO native UI benchmark is still open; harness failures were
addressed before extending performance acceptance.

### Native Windows runtime and large log follow-up

Matrix `38287723409`, source `bd90b6d7e6d0e0ccb3ca4fe2e5502a53cab551c2`,
passed all three source/package jobs. Windows fresh-runner runtime job
`114946041508` passed without a Swift installation: worker framing/recovery,
local database round trip, module-origin checks and two native GUI launches.
Both GUI reports contain all 16 checks, detached band maps at 110% and 71/71
matching map framebuffer probes. The 1024×768 screenshot shows the application
rendering with stacked, vertically scrollable desk panels; compact/4K polish is
still an open acceptance item. This is Windows Server CI, not a Windows 11
consumer-desktop or physical-device pass. Reports are in
`docs/evidence/native-ui-bd90b6d/`.

Linux runtime-only job `114939996239` passed local logging, shortcuts, settings
and awards, then failed detached projection. Its screenshot shows the detached
page saying “The URL can’t be shown”. In the pinned Tauri/Wry code, GTK
incognito creates a fresh context per view while Tauri deduplicates scheme
registration by the shared context key. The acceptance-only correction assigns
separate temporary keys to detached views, retaining incognito and cleaning up
owned directories on exit. Matrix `38290139344` at `c49d456` now passes all
three build jobs and both fresh runtime jobs. Linux completed four native GUI
launches (three X11 and one nested Wayland), each with 16/16 checks, detached
projection and 70/70 map probes. Debian installation, relaunch and relocated
archive launch passed in a non-root, network-disabled Ubuntu container without
development toolchains. This closes the observed isolated detached-window
failure, not physical Linux desktop or network/hardware parity. Reports are in
`docs/evidence/native-ui-c49d456/linux-*.json`.

The 100,000-record acceptance extension uses generated ADIF through the shipping
bounded import API, then measures rendered logbook, first/repeat awards and
local history. During setup, SQLite confirmed `SCAN qsos` for every semantic
duplicate lookup because the existing case-insensitive index excluded deleted
rows but that lookup intentionally includes them. A new all-record composite
index retains duplicate/deletion semantics. The regression verifies indexed
query planning, case-insensitive matching, deleted-record suppression and the
existing one-second boundary. Native timings are now recorded in
[`NATIVE_LARGE_LOG_PERFORMANCE_2026-10-13.md`](NATIVE_LARGE_LOG_PERFORMANCE_2026-10-13.md).
Both indexed runs passed all 21 native checks. The history follow-up reduced
entity-history requests to 260/252 ms in the comparison run; repeat Awards and
rendered callsign history were 18 ms. First logbook display (1,800 ms) and first
Awards open (845 ms) remain above the near-instant target. Source tests alone
do not close that requirement. Matrix `38291686192` tests the follow-up source
`51307464d229afbbdd43c6268e0243d477a542f9` on all three platforms.

The aggregate-index follow-up also passes all 21 native checks: first logbook
display is now 80 ms, first Awards 698 ms, repeat Awards 25 ms and rendered
local callsign history 17 ms in the generated 100,000-contact run. Index-backed
stats/progress/map totals remove the preceding seconds of serialized database
work. Cold Awards, live-service contention and target-machine measurements are
still open. The installed signed alpha.7 remains unchanged until packaging.

### Shared Chaser and DX public feeds

The public-opportunities worker path now compiles outside the macOS-only service
router. POTA, SOTA, WWFF, WWBOTA and the 425DXN calendar use the shared parser,
installed activation references and local worked/confirmed history. Snapshots
read cached evidence; only explicit refresh contacts a publisher. On Windows
and Linux, this does not yet include the separately pending live cluster
transport or authenticated reference-download/vault services.

The same delegate-based downloader runs on every platform: HTTPS GET, no
redirects or credential/cookie storage, validated JSON response, bounded
2 MiB streamed body and cancellation. Failed refreshes retain the previous
validated feed with a stale status. The isolated native acceptance mode still
denies both opportunity methods before dispatch.

Local Mac verification passes 139 XCTest cases, 57 Swift Testing cases and
73 native core cases. Nine feed/projection tests cover all public programmes,
calendar parsing, no-network snapshots, worker routing, known and unknown
response lengths, invalid origins/content, redirects, cancellation and stale
cache fallback. The release worker build and its synthetic self-test pass.
Windows/Linux native compilation and runtime results for this source are
pending; no publisher, credential, radio or rotor endpoint was contacted.

### Isolated current UI acceptance foundation

The native acceptance launch now selects a dedicated worker session with a
random disposable support directory. Rust rejects hardware and external-service
requests before direct device dispatch; Swift independently allows only local
logbook workflows and pure diagnostics. Native-logbook copying, external backup
import, network services and credentials are excluded. Local mutations do not
refresh the operator's cluster history. EOF drains admitted local requests,
closes the database and removes the session's preferences and directory; later
requests cannot reopen it.

The foundation checkpoint passed 139 XCTest cases, 47 Swift Testing cases and
five real NDJSON process tests on Mac. The current driver now exercises LiveApp:
empty-workspace creation, keyboard QSO save/readback, editor focus, draft clearing,
settings persistence, bundled awards, detached band-map projection and final map
GPU evidence. Acceptance windows use private browser storage, avoid saved window
geometry and restrict external content through their CSP. Ordinary launches do
not wait for an acceptance IPC check.

Current local verification: 346 frontend tests, TypeScript/Vite build, 94 Rust
tests and 13 isolated local-logbook tests pass. Two native Mac release-executable
launches now pass all 16 current-UI checks with independent workspaces/private
browser state; see `NATIVE_LOCAL_UI_ACCEPTANCE_2026-10-13.md` and its raw reports.
Signed-package and Windows/Linux runtime acceptance remain open. The main JS
bundle remains 1.66 MB minified and produces a size warning, so startup/performance
acceptance is still open. The installed alpha.7 app has not been replaced; it was
reopened after testing with 67,846 contacts and ShackCQ reconnected.

### Latest alpha.7 checkpoint (CW integration, 13 October)

- CW settings, native persistence, optional desk row and guarded radio/WinKeyer
  controller are integrated and installed in signed/notarized alpha.7. Full frontend **344/344**,
  TypeScript/Vite, Rust **91/91**, Swift core **72/72**, and Mac portable-worker
  **138 XCTest + 40 Swift Testing** pass. No physical device traffic was used.
- Independent CW finish review found mismatched preview length limits; the shared
  backend-aware limit and nine boundary tests address this. The reviewer scored
  that single fix resolved, disposition **ship** at verdict-pass scope.
  Documentation handoff is complete without changing the incumbent design.
  Details: `docs/CW_IMPLEMENTATION_STAGE.md` and
  `docs/CW_UI_DOCUMENTATION_2026-10-13.md`.
- Alpha.7 native settings Save/restart and disarmed desk-row persistence passed.
  Restored the default hidden row, CQ label, radio output and unassigned keys.
  No serial probing, arming or sending occurred. Native shortcut/error-state,
  hardware/driver and alternate OS acceptance remain open. Exact package and
  qualified Awards observations: `docs/ALPHA7_INSTALLED_ACCEPTANCE_2026-10-13.md`.

### Earlier alpha.6 equipment / CW foundation checkpoint

- Full shared frontend: 311/311 tests, TypeScript clean; `git diff --check` clean.
- Rust desktop backend: 68/68 tests passed before the version-only alpha.6 bump.
- Swift core: 67/67 tests. Mac portable-worker build/test: 136 XCTest tests
  (17 station, 86 worker, 33 cluster) plus 40 Swift Testing cases, all passed.
- UI-26 source/fixture review disposition: **ship**, followed by documentation;
  no claim of installed-app or hardware acceptance. Browser fixture server closed.
- CW-02 pure rules are tested. CW-01 now has a guarded Rust serial actor and 19
  fake-transport/protocol tests (full Rust suite 87/87). Settings, main-window
  controller, CW-03 desk row, installed and physical acceptance remain open.
  See `docs/CW_IMPLEMENTATION_STAGE.md` before continuing.
- Alpha.6 source is frozen, pushed, signed, notarized and installed. Broader parity
  and performance gates remain open.
- Reference follow-up: Wavelog catalog semantic schema validation and cancellation
  of an already-running catalog check when changing to standalone mode remain open.

## Checklist

Performance follow-up after alpha.6: persisted revision-fenced award/stat/map
caches and indexed history UNION are implemented, tested and installed in alpha.7.
Optimized isolated 67,846-contact catalogue reopen measured 22–52 ms, versus
1.88 seconds for its initial calculation; first post-change calculation remains
open. See [performance evidence](PERFORMANCE_STAGE_2026-10-13.md). This does not
close PERF-01's packaged UI, cold-start or median/p95 acceptance requirements.

Later source-only cluster projection cache: full data equality, 73 core tests and
138 XCTest + 40 Swift Testing worker tests pass. Seven isolated fresh-connection
reloads measured 145 ms median / 155 ms p95, versus 1.63 seconds for first scan and
cache write. This is backend evidence with warm OS caches, not packaged UI timing;
first post-mutation work remains open. No installed app or live-log changes.

| ID | Requested result / acceptance | Source and test state | Installed / live verification |
| --- | --- | --- | --- |
| UI-17 | Band-map upper/lower frequency tick numbers fully visible, including enlarged text | Edge tick labels inset from chart clipping bounds | Alpha.6 at 1440×940 with 120% band labels: all four visible charts show complete upper/lower tick labels |
| UI-18 | HF propagation centered in available header space, separate from radio/status and weather | In progress | Pending wide/laptop check |
| UI-19 | Callsign/Country matrix same size and aligned; table + C/W/— legend only, no extra status chips | In progress | Pending packaged visual check |
| UI-20 | QRZ photo twice current size with full-size viewer; aligned previous-QSO columns, orange Worked and green Confirmed at mode text size | In progress | Pending packaged visual check |
| UI-21 | Operator workspace uses one toolbar: tabs + band controls or cluster status; no duplicate Band maps heading; green connected/red disconnected | In progress | Pending packaged visual check |
| UI-22 | Remove Operator Desk title and isolated-logbook/manual-sync header row entirely | Source implemented | Pending packaged visual check |
| UI-23 | Main Band Maps: remove duplicate page header and separate Undock row; Undock beside Add band map | Source implemented | Pending packaged visual check |
| UI-24 | Refine rotor instrument with readable scale, single observed needle, separate rim target and short-path arc; no fabricated motion | Source implemented; geometry and offline tests | Pending packaged visual check; hardware off |
| UI-25 | Move independent rotator configuration into Settings → Rotator; browsing settings leaves connections unchanged | Source implemented | Pending packaged navigation check |
| UI-26 | Hide unconfigured rotor; optional fixed-antenna type/name/bands or no equipment panel; reclaim its grid track | Implemented; 21 focused UI tests, settings migration/round-trip tests; full frontend 311/311 + TypeScript and Swift core 67/67. Fresh narrow UI review: ship | Alpha.6: saved temporary vertical/20–10m card, verified on Desk and persisted across navigation; restored automatic/empty-band preferences. Existing ARCO configuration correctly retains offline rotor. Synthetic no-equipment/wide/laptop fixtures passed. Relaunch of changed equipment, high-DPI and assistive-technology checks remain |
| SYNC-02 | Explicit standalone local vs local+Wavelog logbook mode; local mode blocks sync network, keeps all data, switching back never auto-syncs | Backend and UI in progress | Test saved mode/restart/no-network guards; current user mode unchanged |
| CW-01 | Cross-platform WinKeyer configuration and transport, separate from supported-radio CW route | Integrated in alpha.7: explicit saved-port connection/consent, serial actor, radio routing, 60-second arm, generation/intent gates, priority Stop and uncertain-output retention; 19 protocol + 19 controller tests; full Rust91/91 | Installed disconnected settings show consent/connection gates. No serial probing or RF tests; physical WinKeyer, driver, radio and Windows/Linux acceptance required |
| CW-02 | Up to20 editable macros, safe substitutions/preview, named colors and assigned keyboard shortcuts | Settings/native persistence/preview/keys implemented; shared80/128-character output limits; nine preview boundary cases; full frontend344/344, core72/72 | Review fix resolved; alpha.7 native label/display Save and full restart passed. Native shortcut and armed/error acceptance open |
| CW-03 | Optional customizable row of selected colored CW macro buttons under Active QSO | Implemented: one row, chosen colors/keys, More menu, explicit Arm/Stop and uncertain-output recovery; six laptop/wide/2x synthetic captures | Alpha.7 native five-button row appeared and persisted disarmed across restart; all sends disabled. Default hidden row restored. No physical4K or transmit claim |
| CLUSTER-01 | Restore live cluster after update; resume saved connected session on restart, respect explicit Disconnect; independent of offline radio | Startup resume implemented; intent/race regression tests passed | Alpha.6 automatically reconnected ShackCQ after installation/restart without pressing Connect; 12 live spots observed, radio/PA/rotor offline. Explicit-disconnect persistence covered by tests, not repeated against live feed |
| PERF-01 | App-wide cold/warm performance audit: typing-to-intelligence (reported slow again for VK8NSB), tab opening, startup, awards, spot/classification, background requests and large-log behavior | Required final acceptance, not closed by caches or unit tests; cold award calculations still multi-second | Measure representative packaged runtime, record median/p95 and distinguish remote QRZ latency from local history/paint |
| UI-01 | Operator Desk Active QSO, intelligence, rotor match supplied information and colors | Implemented; component tests | Recheck updated package |
| UI-02 | Log QSO full fields match supplied editor; no large empty right column; matrices span below details | Implemented; component tests | Pending alpha.5 |
| UI-03 | Logbook layout, status colors, search/edit/import/export match reference | Previous implementation | Recheck final parity; do not infer from screenshot |
| UI-04 | Colored DX-cluster filters retain existing behavior | Implemented | Recheck updated package |
| UI-05 | Undock/dock cluster, map, band maps; preserve selection ownership | Implemented; detached projection tests | Recheck updated package |
| UI-06 | Cluster Console and Settings beside Refresh; Dock back last | Implemented; component tests | Pending alpha.5 |
| UI-07 | Remove detached cluster duplicate header and redundant connection row; show cluster name beside Connected | Implemented; component tests | Pending alpha.5; keep failures visible |
| UI-08 | Band maps occupy full available height AND width, with no empty right strip | Adaptive width/height and overflow pagination implemented; 15 BandMaps tests pass, including retained zoom | Pending resize checks |
| UI-09 | Avoid horizontal/vertical scrollbars through responsive layout, not inaccessible clipped content | Operator workspace and band maps in progress | App-wide audit still open; long records/forms must remain accessible |
| UI-10 | Multi-select CW/Data/Phone filter; persist and synchronize detached changes | Implemented; component/preference tests | Pending alpha.5 |
| UI-11 | Wheel/drag pan zoomed band maps; never tune from drag | Implemented; regression tests | Pending pointer check |
| UI-12 | Detached band maps: no duplicate top header/footer prose; Dock back beside Add band map | Implemented; component tests | Pending alpha.5 |
| UI-13 | App logo/larger brand; bold frequency/mode; propagation in header with Day/Night and colored SFI/A/K; no update row | Implemented; component tests | Pending wide/laptop layout check |
| UI-14 | Hide routine spot tune-success prose without hiding failures/unconfirmed state | Implemented | Pending alpha.5 |
| UI-15 | Resizable map/right pane; Band maps and Cluster tabs; compact cluster configurable columns and widths, independent of full cluster | Implemented; focused component/integration tests; full frontend 255/255 | Pending splitter, persistence, tab and column checks |
| UI-16 | Rotor dial shrinks automatically to available space; it must not enlarge the top row and leave blank space in QSO/intelligence; bottom edges aligned | Traditional middle-width transition fixed in source; 18-width synthetic geometry checks with/without equipment and visual review pass; not installed | Equipment-present desk stacks Active QSO at 1840px content width; proportional rotor dial preserves target space. Wide and equipment-free layouts retained. Custom canvas, display scaling, offline/long status and native operator acceptance remain open; no hardware commands |
| UI-27 | Center station callsign and grid horizontally in the sidebar footer beneath Monitor | Source and isolated rendered fixture pass; not installed | Existing Monitor/call/grid order and text sizes retained; inherited center alignment, no station value or action changes |
| UI-28 | QRZ image fills the intelligence card content width; move the current right-side name, country and QRZ source below the image | Source, focused tests and isolated landscape/portrait/missing-image checks pass; not installed | Full-width natural aspect ratio, right-aligned details below, safe URL/failure handling and full-size modal preserved. Portraits remain uncropped and therefore taller; existing Station website link is not relabeled as QRZ |
| UI-29 | Show country/DXCC name below callsign and above UTC, on the RST Sent label line: green confirmed, orange worked, red new | Requested 13 October; queued | Use actual DXCC history with confirmed taking precedence over worked; unresolved entities remain neutral rather than falsely new. Verify alignment and stale-lookup protection |
| UI-30 | QSO note must wrap naturally without a horizontal scrollbar | Source, text-preservation regression and isolated 400/640/1600/3840px checks pass; not installed | Soft wrapping plus pre-wrap/anywhere; long unbroken text scrollWidth equals clientWidth without clipping, controlled value retains explicit newlines and spaces |
| UI-31 | Narrow band-map spot labels to remove excessive callsign/status whitespace while keeping both edges aligned | Source, 25 focused tests and isolated responsive screenshots pass; not installed | Common compact width per chart; portable/long calls, composite status codes and scaled text retained. Packaged operator check remains |
| PERF-02 | Chaser initial load shows the selected programme promptly (POTA first when default), other feeds load in background | Source, 12 frontend and 10 Swift tests pass; not installed | Independent feed completion with cached data, freshness/error and race guards. Synthetic selected-feed fixture renders at 100ms rather than waiting for 15s polling; actual network latency not measured |
| UI-32 | Awards library shows five programmes per page, keeping overall section compact | Source, 10 focused tests and isolated responsive screenshots pass; not installed | Five entries per page, bounded detail pane, search/filter/pagination and keyboard access preserved |
| UI-33 | Move Sync into Settings; remove dedicated main navigation/menu entry | Source and navigation/settings tests pass; not installed | Settings Sync tab; legacy routes redirected. Schedule, outbox and conflicts retained; navigation does not change synchronization |
| UI-34 | Mask saved Wavelog token visibly and distinguish saved from successfully validated; correct stale manual-sync copy | Masked saved presence and honest unverified state implemented; actual validity verification remains open | No saved secret returned to renderer; empty edit never overwrites token. Do not label saved credentials valid without a destination-bound successful response |
| UI-35 | Compact QRZ username/password/Save and Club Log CTY URL/API-key/Save onto one row each | Source and 12 settings tests pass; not installed | Responsive wrap, independent credential saving and unsaved drafts preserved |
| DATA-09 | Reference databases check at startup and hourly, update automatically in background and display available version/revision metadata | Native scheduling and cache recovery source-verified 13 October; installed acceptance and source semantic versions remain open | All seven supported sources use hourly deadlines; persisted opt-out/migration, native startup/wake ownership, last-good validation, conditional-cache recovery and restore-safe exclusion tested. ETag/source/check/download dates remain distinct; app-binary update/restart remains separate |
| DATA-10 | Discoverable ADIF import and export in integrated xLog | Requested 13 October; audit/reuse existing ADIF implementation before extending | Import preview, validation and duplicate policy; retain unsupported fields where possible, dates/UTC/modes/references and confirmation data; export scope selection; fixture roundtrip and no unintended sync |
| BACKUP-01 | Optional cloud backups: Google Drive, OneDrive, Dropbox and FTP destination | Requested 13 October; queued | Explicit destination/account setup, secret-free consistent backup, secure credential storage, upload verification, retention and restore verification; protect existing remote backups. Prefer encrypted transfer (FTPS/SFTP where supported), explicitly disclose plain FTP risks. No account connections or uploads authorized merely by adding this feature |
| RADIO-04 | Optional Use radio-reported power populates QSO power and ADIF TX_PWR when supplied | Default-off native capture, setting, explicit manual-intent UI and durable power-only merges source-verified; packaged/live acceptance remains open | Qualified KPA500 output through the direct remote agent only; legacy mixed drive/watt fields are never accepted. Requires companion actual WS receipt timestamp. Native provider/session/contact authority, independent power revision and atomic Save/provenance are tested together. No RF tests or deployment; other power sources remain unsupported |
| RADIO-05 | Optional Clear after QSY setting clears the previous unlogged QSO on confirmed frequency change | Requested 13 October; design in progress | Default off; no clear on initial/reconnected/stale/failed radio read, no clearing existing-contact edits, no erasure of a newly selected cluster spot or newer draft input. Revision/selection fences and shared-draft tests required; never tune merely to test |
| SYNC-06 | Automatic sync fails before uploading or importing contacts | Source repair, full portable Swift suite and final exact-source read-only preview pass; not installed | Hold entire ambiguous groups and pending edits without guessing IDs; preserve complete-snapshot deletion safeguards. Matched live group proved JSON zero versus omitted ADIF RX; exact decimal-zero equivalence only, positive/malformed/underflow contradictions still rejected. Final 5277847 source preview passed in 113.524s: 67,935 remote IDs, 67,929 unambiguous, six held, 29 IDs not local, zero absent clean/dirty local IDs; three held IDs already local. No live reconciliation/deletions performed |
| UI-36 | Detached Logbook and DX Cluster tables fill available window height with clean lower edges | Source, 41 focused tests and isolated desktop/compact screenshots pass; not installed | Detached caps removed; Logbook capacity uses actual body-row height. Paging and cluster final-row access verified in synthetic browser fixtures; native window check remains |
| UI-37 | Compact Callsign/DXCC band labels and counters | Source and focused tests pass; not installed | Display metre bands without m; keep canonical units accessible. Counts use thousands separators and wkd/cnf abbreviations, one line |
| UI-38 | RST R stays inside Active QSO; exact callsign/band/mode duplicate warning in header | Source, 83 frontend and 3 Swift tests pass; isolated 795px/336px card screenshots pass; not installed | Responsive fields; red right-aligned Dupe date from full indexed local history. Deleted/current edited contacts excluded; advisory only with stale-response guards |
| UI-39 | Operator Desk can replace map with logbook or stack both above/below with adjustable divider | Source verified 14 October; 1,033 frontend tests, component/source review and production build passed; native package acceptance pending | Persisted four-way choice/divider; shared Logbook with independent Desk columns/widths; retained panes and guarded mutations. See source acceptance document; not installed in alpha.21 |
| UI-40 | Empty QSO fields have no placeholder text | Desk and full-editor source/focused tests pass; not installed | External labels and date/UTC/frequency/band/mode/RST defaults retained; actual entered or looked-up data unchanged |
| UI-41 | Portable callsigns must fit the Active QSO input | Source and isolated compact/enlarged-text screenshots pass; not installed | Callsign width prioritized; other fields reflow with RST R inside card; native operator check remains |
| DATA-11 | Typed programme references automatically show verified full names under their fields | User subsequently confirmed existing POTA lookup works; audit delayed feedback rather than duplicate implementation | Preserve existing lookup path; small green verified names, neutral unknown/loading/unavailable states; fence stale responses and never replace operator input with guessed references |
| PERF-03 | Log QSO should acknowledge a durable local save almost immediately | Fixed in source commit 75d7022; fresh review and full portable Swift suite pass; not installed | Worker previously awaited whole-log cluster classification after durable commit. Seven controlled tests hold publication while verifying durable receipt/row from a separate SQLite connection, idempotent retry, coalesced bursts, successful/rejected restore, shutdown, refresh failure and destination revision fences. 29 frontend receipt tests pass. Actual installed latency and contention not yet measured |
| MAP-01 | Fit complete path between home and target, including antimeridian and SP/LP | Implemented; geometry tests | Pending packaged map check |
| MAP-02 | Light-grey night hemisphere, correct date/time, toggle with Greyline | Implemented; seasonal/dateline tests | Pending packaged map check |
| MAP-03 | Show spot callsigns earlier while zooming; prioritize them over country labels | Implemented; zoom threshold test | Pending packaged map check |
| MAP-04 | Both endpoint callsigns; distance above route midpoint, observed frequency below; readable tangent orientation | Implemented; geometry/format tests | Pending packaged map check; retain location provenance |
| DATA-01 | QRZ details/photo populate current callsign and empty fields; preserve deliberate manual edits | Implemented; enrichment/profile tests | Pending authenticated lookup; no credentials in evidence |
| DATA-02 | Wrong inherited England/country/DXCC cleared and corrected; ignore stale lookup completions | Implemented; draft/selection regression tests | Pending live callsign change |
| DATA-03 | Fast callsign/DXCC intelligence independent of remote lookup/full log scan | Indexed history and cached resolver/session implemented | Measure real packaged latency; not yet instant-certified |
| DATA-04 | Cluster POTA/SOTA/IOTA/WWFF/castle references transfer and validate installed databases; unknown/missing directory explicit | Implemented; parser/selection tests | Pending real selected-reference verification without unintended tune |
| DATA-05 | Settings top tabs and grouped service URL/account/credentials | Implemented; component tests | Pending alpha.5 |
| DATA-06 | Per-dataset downloaded/checked/attempt dates, count/version, cache/error freshness; no fabricated legacy dates | Implemented; updater/component tests | Pending actual cache display |
| DATA-07 | Reject malformed CTY/LoTW downloads and cached 304 success; preserve known cache; correct Wavelog catalog index.php URL | Implemented; 5 focused updater tests | LoTW real-feed compatibility remains to verify |
| DATA-08 | Awards opens immediately with retained/cached results | Warm caches and retained view implemented | **Partial:** first cold calculation measured 6.7–27.3 seconds; further cold-path work required |
| RADIO-01 | Auto rotor turns resolved typed calls; selected spots wait for confirmed radio tune; Stop/reconnect disarm | Implemented; fence/regression tests | Pending packaged/hardware acceptance, not claimed by synthetic tests |
| RADIO-02 | Browsing Station Control provider tabs must never disconnect/change active radio; explicit Save/apply action | Active/view provider separation implemented; 19 focused tests and full 242-test frontend suite pass | Pending live tab-only check |
| RADIO-03 | Frequency/mode and callsign remain coherent after spot selection, including remote latency | Existing guarded tune/readback plus stale-selection fences | Real radio/Maestro acceptance remains distinct |
| SYNC-01 | M7KOD reaches Wavelog without duplicate/lost edits | Previously verified remote ID 178693, dirty=0, outbox=0 | Complete for that QSO; no blanket sync parity claim |
| SHIP-01 | Preserve native app/data/latest draft; one Integration running; exact signed/notarized release and GitHub source | Awaiting final freeze/build | Pending |

### RADIO-04 measurement prerequisite — 13 October

The existing `tx_power_watts`/`rfPowerWatts` fields can contain FLEX drive
percentages; they remain untouched for compatibility, but must not feed automatic
ADIF power. `RadioSnapshot.measuredTransmitPower` and the native
`measured_tx_power` projection now admit only qualified KPA500 amplifier output
with explicit `W` units, positive finite bounded power and source timestamps.
They require the new `meter_sample_observed_at` field, not legacy
`meter_observed_at`, whose full-status timestamp could be advanced by a later
firmware query. Companion source corrects both timestamps at WS query completion,
propagates the measurement atomically through caches, retires failed samples and
does not let a delayed full poll replace a newer fast sample. No companion
service was deployed or restarted.

The radio context uses retained ISO `observed_at`, not `updated_at` (which can
advance on an empty poll). This is radio-context age, not proof of a separately
timestamped MOX field. Actual positive output comes from the qualified meter.
Meter/receipt/radio-context age is bounded to two seconds; the amplifier status
envelope to fifteen seconds. These context ages do not prove independently fresh
MOX/fault fields and must never authorize transmission. Future timestamps and
pre-session readings are rejected.
Synchronous connection-event sequence/attempt identities survive reordered or
entirely delayed actor callbacks. Snapshot/tune projection reconciles the latest
event after awaits before checking identity or publishing power evidence.

Twenty focused Swift tests pass (eleven new observation/session fixtures and
nine existing station-method tests). Independent review identified and then
verified corrections for callback reordering/delivery delay and source timestamp
semantics. Companion verification passes 71 meter/protocol tests and 56 remote
agent/tray tests; these use mocks, not a physical station.

Final shared Swift suite passes (`XLOG_PORTABLE_ONLY=1 swift test`, including
168 Swift Testing cases in 26 suites and the XCTest suites). Companion source
`8b90634` was merged with four already-published latency commits without conflicts;
published merge `5c94b87c4f87259aebbb5dcc3e07cad029130e4f` passes all 210 focused
meter, protocol, remote-agent/tray and station-coordinator tests. This merge
preserves the other work; it is not new live hardware or latency acceptance.
The notarized `a1fb4b2` Mac artifact predates this observation-contract stage and
does not include it; see `MAC_REFRESH_2026-10-13.md` for its exact evidence.

This is not the finished automatic-power feature. The next stage must add a
default-off persisted setting and native capture ownership on the logbook lane,
with a separate power revision so samples do not conflict with contact typing.
Explicit manual intent (including entering the same value or clearing it) must
survive samples. Call/draft/workspace/provider/session transitions must retire
queued samples; Save must resolve and store the exact effective value and
provenance in its existing atomic receipt transaction. Renderer-only capture
does not satisfy main-window-absent operation. Detached new-QSO editing and its
least-privilege capability path remain separate open workspace gates.

### RADIO-04 durable canonical power state — 14 October

The portable core now persists power state beside the shared operator draft,
with its own revision independent of typing. Qualified readings accumulate a
session peak behind native-issued scope identities. Contact, draft, workspace,
provider and session changes retire eligibility; reopening a database retains
the selected value but cannot revive capture authority. A newly armed session
starts a fresh peak. Manual intent is explicit, including the same value and an
empty value; unrelated stale text replacements cannot overwrite newer power.

Save resolves TX_PWR and APP_OM0RXXLOG_POWER_* provenance inside the existing
QSO/draft/receipt transaction. Retries return the exact original receipt.
Manual values carry no measured-power provenance; comments and notes remain
unchanged. Meter values export as decimal text, not scientific notation.
Stored snapshots validate the association between QSO identity/value and power
state before use. Legacy drafts/receipts without power metadata still decode;
unfinished legacy values are preserved as manual intent when configured.

Verification: 14 reducer tests and 10 database tests, including stale typing,
manual intent, A-to-B-to-A changes, restart/rearm, concurrent capture/Save,
receipt/sample-write rollback, rejected arm/configuration, corrupted snapshots,
and actual ADIF round trips. Full `XLOG_PORTABLE_ONLY=1 swift test` passes,
including 192 Swift Testing cases in 28 suites plus the XCTest suites.
Independent review found and verified fixes for authority loss on failed arm,
overly strict amplifier-context fencing, and unchecked restored snapshot
consistency. Amplifier context retains its separate fifteen-second age limit;
only meter/radio/receipt evidence must follow the new scope/session.

At that checkpoint this remained a prerequisite, not an enabled feature. No live draft, logbook,
radio or installed application was changed. The next block must wire native
sample ownership onto the logbook lane, add the persisted default-off setting,
and ship explicit manual-intent transport/UI plus power-only renderer merges
together. Main-window-absent capture and detached new-QSO editing remain open.

### RADIO-04 native owner and compact controls — 14 October

The next source stage wires the authoritative Remote Agent callback before
optimistic display overlays into a native FIFO delivery lane. The native
selection has a persisted UUID and sequence-fenced publications; renderer IPC
cannot publish selection authority or measured readings. Old startup messages
cannot supersede newer handover fences. Optional startup publication and
selection reads never wait for a power RPC; failure is nonfatal and exposes an
unavailable status. Connect/reconnect/handover still require their safety fence,
while disconnect and shutdown bypass optional power notification.

Capture checks current observed transmit frequency/mode, source/session,
workspace, draft and contact. After acquiring the service/SQLite transaction,
freshness is evaluated against the current clock and a short permission check
admits the write. Revocation never waits for database I/O: an already admitted
transaction is ordered before a later revoke, whereas later queued old readings
are rejected. Successful durable peaks suppress subsequent lower/duplicate
work; failed writes never establish a speculative peak. Save drains the already
emitted callback prefix before its atomic QSO/draft/receipt transaction.

Station settings now includes Automatic measured power beside Default power,
default OFF. Explicit TX power edits (including identical or empty values)
persist manual intent even before the feature has ever been enabled. Use
automatic resumes capture; logged-contact edits retain their original behavior.
Power-only revisions merge into an open draft without overwriting newer notes
or creating false text conflicts. The compact controls preserve the existing
console design; synthetic browser checks at 1650 and 1024 px show the settings
and editor controls fitting, and Use automatic visibly restores the fallback.

Verification: full frontend suite 742 tests in 92 files; TypeScript/Vite build
and window bundle budgets pass. Full portable Swift run passes 215 Swift Testing
cases in 32 suites plus 222 reported XCTest cases (two explicitly skipped).
Full offline Rust tests pass 196 cases, including 21 native selection tests.
New regressions exercise authoritative callback ordering, database/service lock
contention, prompt detach/termination, admission-before-revocation, post-wait
freshness, failed writes, manual intent, native selection ordering, and actual
React draft refresh. The full-suite concurrency fixtures suspend their waits
instead of starving Swift's cooperative executor. The unrelated canvas CI race
now waits for each control to be enabled before clicking; runtime busy guards
are unchanged.

Boundaries: no installed application, live logbook, settings, credentials or
radio changed. Real companion timestamp deployment, exact packaged macOS
acceptance, physical telemetry and other operating systems remain unverified.
Worker-owned capture is tested without a renderer, not claimed as a real
main-window-closed station acceptance. Detached new-QSO editing remains open.
Before the first durable peak or during repeated database failures, delivery
still preserves FIFO rather than coalescing speculative readings.

### RADIO-04 worker replacement recovery — 14 October

Follow-up source correction: a replacement Swift worker now receives the saved
native selection metadata without depending on a renderer read or reconnect.
Each worker has a monotonic generation and a per-session announcement barrier;
every caller crosses the barrier after registry unlock, so concurrent reuse
cannot observe the old generation's ready acknowledgement. Metadata invalidation
never takes the selection-state lock. Background bootstrap reads a separately
mirrored native selection and waits cancellably for native controls without
taking that lock either, then addresses that exact child, not whichever worker is
current later. Both generation and sequence fence status completions.

New Rust regressions cover exact-child replacement, concurrent reuse,
saved/unset startup, first-start handover and reconnect null fences, stale
acknowledgements, cancelled obsolete tasks, prompt disconnect and nonfatal
failure coalescing. Independent review identified the announcement race; a full
test rerun also exposed optional bootstrap briefly competing with Disconnect's
state lock. The separate metadata snapshot removes that competition, with a
regression requiring bootstrap to complete while that state lock is held.
Five consecutive complete native-unit runs passed 190 tests each; the final
offline Cargo run passed all 208 tests across its unit and integration suites.
This is metadata recovery, not automatic radio reconnection or proof of renewed
measured samples.
It is not included in the staged `cd25718` package. Native packaged restart and
physical telemetry acceptance remain open; the running app was untouched.

### PERF-03 generated large-log save check — 14 October

An opt-in `PostCommitContactRefreshTests.generatedLargeLogSaveTiming` builds a
new disposable 68,000-contact database, then measures 50 canonical saves through
`LiveWorker.response`. Each successful reply is checked against its committed
receipt and contact count through a separate SQLite connection. Contact
projection is deliberately held throughout; these measurements isolate the
durable response rather than claiming aggregate-contention or UI timing.

On this Mac, `XLOG_PORTABLE_ONLY=1 XLOG_SAVE_PERF=1 swift test --scratch-path
.build/power-service-tests --filter PostCommitContactRefreshTests` passed all
eight tests. Save response median was **1.308 ms**, p95 **2.977 ms**, maximum
**8.203 ms**; fixture import plus tests completed in 19.815 seconds (build
excluded). This confirms the local durable-save path need not wait for whole-log
projection. Webview/IPC latency, realistic simultaneous background work and the
installed app remain separate acceptance gates. No live log or service was used.

## Longer-term parity gates (not silently closed by this release)

### 14 October — middle-width Operator Desk clarification

The operator confirmed that the wide three-panel layout and narrower stacked
layout look correct; only the intermediate width needs correction. Keep both
working layouts. The existing `a3296d2` source change gives Active QSO the full
row at container widths 1420–1840 px and scales the rotor compass; no additional
redesign is indicated by the new screenshots. A fresh synthetic browser check
passes all 18 fixture widths with the rotor and all 18 without it, including
fractional widths around both breakpoints. The rendered 1650 px fixture keeps
both RST fields inside Active QSO and the rotor inside its panel.

Installed alpha.13 remains `df387639` with its retained `5ab88fb` frontend; it
predates this correction. The staged `a1fb4b2` package includes the correction,
but neither these fixture checks nor the staged package claim an installed-app
refresh. The running operator session was not interrupted.

13 October source verification (not an installed-app acceptance): all 707 frontend tests across 88 files pass; TypeScript/Vite build and detached-window bundle budgets pass. A paging race exposed by the full run was fixed: the unchanged initial Awards search no longer schedules a delayed reset to page one. Full `XLOG_PORTABLE_ONLY=1 swift test` exits successfully, including the final post-commit publication fences, duplicate lookup and strict sync identity/RX regressions. Existing large-main-chunk and mixed static/dynamic Map import warnings remain. The installed Mac app remains the earlier `df387639` refresh until a separately verified package/restart.

- Full native logging/awards/sync/import-export behavior versus the original
  app and the awards master brief.
- Standalone local Hamlib radio AND rotor, embedded remote xCat, integrated
  xCluster; no standalone macOS xCat dependency for cross-platform operation.
- Real local Hamlib device acceptance; direct FLEX and remote station/300 ms+
  transport behavior, safely verified separately.
- Clean-machine Windows and Linux packaging/runtime acceptance. The user will
  test Windows later; Mac delivery remains the current priority.
- Existing original applications and original native macOS release preserved.

## Overnight instruction — station intentionally powered off

At approximately 22:39 Darwin / 13:09 UTC on 12 October, the operator authorized
eight hours of independent work and reported the radio switched off. Treat
missing radio/amplifier telemetry as expected, not an incident. Do not request
routine decisions or run hardware acceptance while the operator sleeps. An
hourly continuation is scheduled in this thread, bounded to 21:10 UTC.

| ID | Additional requested result | State / acceptance boundary |
| --- | --- | --- |
| NIGHT-01 | Full parity review with exceptionally fast navigation, lookup and awards | Cold award performance investigation; measure representative isolated log, cold/warm and concurrent workload separately |
| NIGHT-02 | Polished responsive experience on laptop and large/4K displays; selectable readable UI scale | Audit planned; use effective window size/DPI, not resolution detection alone; test saved scale and keyboard access |
| NIGHT-03 | Clear Hamlib manufacturer/model choices, independent radio and rotor settings | Audit planned; bundled supported catalogue, capability-driven controls, dummy protocol tests; physical compatibility remains unverified |
| NIGHT-04 | Automatic freshness checks for every configured reference feed, with visible state and reliable cached fallback | Scheduler audit planned; bounded retries, valid payloads, no credential exposure, respect source availability/licensing |
| NIGHT-05 | Custom alerts with condition rules, dashboard, optional popup/bell/spoken delivery | Architecture/reuse research; opt-in sound, deduplicate/rate-limit, test action, no RF commands from alerts |
| NIGHT-06 | POTA/SOTA/IOTA/WWFF/etc chaser view based on user's ShackCQ project | Read-only source research; integrate existing classifications/reference validation, preserve notices |
| NIGHT-07 | DXpedition and contest information from user's ShackCQ project | Read-only source/feed research; dated source attribution, freshness and offline errors; no fabricated events |
| NIGHT-08 | Same shared UX on macOS/Windows/Linux, Mac-first package verification | Real local logbook/CTY/awards/settings/backup handlers enabled in portable core; package resource staging and disposable runtime round trip added. Native CI pending; network/vault/hardware and complete UI acceptance still open |

### Pre-package automated checkpoint

255 frontend tests and TypeScript checking passed after workspace integration,
provider Apply separation, multi-pointer drag protection and manual reference
clear protection. Shared Swift suite passed, including 30 Swift Testing cases
and the URL-free QRZ transport error fixture. Exact total and package evidence
are recorded with the release checkpoint, not inferred from these source tests.

## Closing a row

### Follow-up: all-screen title strip and full cluster columns (13 October)

- UI-HEADER-ALL: remove the redundant first title/logbook-status strip on every
  main screen, including Log QSO, Logbook, World Map, Station Control, Sync,
  Settings, Awards, DX Cluster and Chaser. Central wrapper removed; accessible
  main-region label remains. Operational warnings and section controls remain.
- CLUSTER-03: match Newest selector height to the filter buttons; add full-table
  show/hide columns, numeric widths, pointer and keyboard resize, reset and saved
  preferences independent of the compact Operator Desk table. Source and tests
  implemented; installed-app verification pending next package.

Installed alpha.11 verification: Log QSO opens directly at Active contact;
Logbook, World Map, Station Control, Sync, Settings and Chaser no longer show
the redundant logbook-status strip. DX Cluster has one title and reconnects
automatically; show/hide controls work without disconnecting. H49A draft and
67,846 contacts retained. Native numeric width entry exposed premature per-key
clamping; alpha.12 keeps an editable draft and applies bounds on blur/Enter.
Regression covers partial typing, empty input, out-of-range input and persistence.
All 21 signed-app checks passed on 100,002 generated contacts; report in
`docs/evidence/native-ui-alpha11/mac-signed-large.json`. Notarization
`8d246f6b-c1a4-4b1b-8c68-ec31efb97e52` accepted. No RF commands used.

Installed Chaser automatic refresh verified without pressing Refresh: POTA 82,
SOTA 6, WWFF 10, WWBOTA healthy zero, DX calendar 56; 154 total observations.
Programme tabs are present and the table reaches the bottom pagination rail.
All 358 frontend tests and TypeScript pass after the numeric-entry correction.

Alpha.12 installed checkpoint: notarization `5f077292-3e2d-4de1-bfd9-86254a05a882`
accepted, staple/signature verified; archive SHA-256
`d130a881cf1ce1a5ae7b01d7c29c3c144963a45a78665dd715e26bbeef518d5b`.
All 21 signed native checks passed on 100,002 generated records. Live native
typing now reads Callsign width 180 after Tab, cluster stays Connected. Defaults
restored after test; no radio, rotor or transmit command. Exact-source all-platform
CI `38312294786` remains separate and pending at this checkpoint.

HEADER-04 (installed and visually verified in alpha.13): move Monitor
from the top station rail to the bottom-left sidebar footer; enlarge the configured
station callsign and grid without changing their values or Monitor behaviour.

Alpha.13 candidate: DXpeditions second; IOTA includes explicitly referenced calendar
operations and recent tagged cluster spots. Reference-area pins remain visibly
approximate; no coordinates are invented for unlocated expeditions. Calendar dates,
exact-call fresh cluster frequencies, frequency-free map entries, date-line-safe
centres/bounds and filter-driven camera fitting have regression coverage. Selecting
an island expedition carries the IOTA reference into a draft, without station I/O.
Browser fixture checked at 1440×900. Impeccable layout detector returned no findings.
Shared Swift suite passed (71 Swift Testing cases, XCTest suite also successful).
Frontend full run: 363 passed with one worker; the initial concurrent build/test run
had timeouts and was not accepted. Expanded LiveApp follow-up: 9 passed. TypeScript
and Vite build passed; existing large-bundle warning remains a performance follow-up.

Alpha.13 installed verification: Monitor visibly in bottom-left footer, above larger
OM0RX and JN88TQ. H49A draft and 67,846 contacts retained; ShackCQ reconnected.
Live IOTA tab: 21 matching/located operations, explicitly approximate group areas.
DXpeditions second tab: 26 matching, 21 located and 5 without published coordinates.
No spot selected and no radio/rotor command sent during native verification.
All 21 packaged checks passed; report `docs/evidence/native-ui-alpha13/mac-signed-large.json`.
The first acceptance invocation exited because the normal single-instance app was
still running and produced no report; after closing Integration, the actual isolated
run completed and its report was checked. Apple notarization
`bb8f10cb-ed8f-4293-adb4-7a9351649811` Accepted; staple, Gatekeeper and installed signature
verified. Archive SHA-256 `180b27815c2a299a78d9862bc43b5f2c512f3b69a989cc467dda72e7b7363e41`.
Previous alpha.12 all-platform CI `38312294786` succeeded. Exact alpha.13 matrix
`38314805976` remains running and is not claimed passed.

Record the source SHA, exact test evidence, installed version, and observed
result. Leave partial or failed gates visible. Add newly reported issues here
before implementation; do not replace this list with a generic “done”.

## 13 October — responsive Logbook and native verification follow-up

The new detached Logbook source (`bfccefa`) built on Mac, Windows and Linux, but both packaged runtime checks stopped at a main Logbook Delete control after an edit refresh; the detached test was not reached. This is tracked as a failed gate, not successful undocking acceptance. Refresh now retains an existing selected contact, backed by a regression test; native acceptance waits for controls to become ready.

The shared Logbook table now fits rows to available height, removes its fixed minimum width, retains all columns on wide windows and exposes compact hidden fields through Details. A selected lower row remains anchored when Details reduces row capacity. Isolated browser checks cover 640×480, 1280×800 and 4K, including long data and lower-row Details; a fresh reviewer scored its one selection finding resolved. Full-editor sizing, native lifecycle, all-screen undocking/canvas and full application performance remain open. Exact-source native recheck and installation remain pending. No station actions or live contact edits were used.

The next matrix (`38335488098`, source `4138e15`) passed its Mac build but Linux stopped before native runtime checks on a timing-dependent weather fixture. That test now holds the download until the grid change is saved instead of assuming it finishes within 100 ms. Full local portable-core tests pass (96 Swift Testing cases plus XCTest suites); the new cross-platform rerun is still required. Main-desk closure remains an explicit open gate, not a supported fully undocked workflow yet.

Windows first-launch and relaunch reports from that same matrix are now inspected: all 20 native checks pass, including detached Logbook contact editing. The corrected weather-test revision passes Mac/Linux builds; remaining runtime gates are tracked by exact run, not assumed.

The next ownership step moves periodic rotor status to one native read-only poller, with stale-stream fencing and no duplicate rotor reads from Hamlib radio refresh. Explicit motion/Stop and fresh command readbacks remain unchanged. This removes one main-renderer dependency; full station/session independence, every-screen undocking and the canvas are still open. No installed app or equipment has been changed for these tests.

Periodic radio status has now also moved to a native read-only owner. Command/provider changes fence old reads, and explicit Tune/Read radio still use authoritative backend readbacks. Local Rust/client/rendered regression tests cover these boundaries; packaged verification is separate and not yet complete.

Linux runtime for corrected-test source `ef624b9` passed its first launch (all 20 checks) but failed on relaunch waiting for Delete confirmation. Track the suspected confirmation/page-capacity invalidation race in `LogbookPanel`; reproduce and fix without bypassing confirmation or weakening native acceptance. Evidence: `/tmp/xlog-logbook-fit-18G8qM/linux-ef/ui-2.json`. Windows passed first launch/relaunch for that source. Original alpha.13 remains installed.

The Delete resize race is now reproduced by two failing-before/passing-after regressions: both an already visible confirmation and a pending contact read survive geometry-only capacity changes. Selection, search and data refresh still cancel pending consent. All 486 frontend tests pass. Isolated synthetic browser checks retain the same confirmation at 640×480, 1280×800 and 3840×2160, then delete/undo restores all 501 fixture contacts; no live log or equipment was touched. The later rotor-only matrix `38337551455` also failed Windows relaunch at that confirmation step, and Linux runtime failed separately; neither is accepted. Radio-telemetry source `11de47a` passed its Mac build (`38338765330`). The corrected source still requires a fresh packaged cross-platform run.

The resulting `63bd46e` matrix `38340075754` passes all three builds and Linux native first launch, relaunch, relocation and Wayland (20 checks each). Windows still times out waiting for Delete confirmation on its first launch. Its report/screenshot is retained under `/tmp/xlog-logbook-fit-18G8qM/windows-n`; further diagnosis remains required, not a completed cross-platform gate.

Cluster startup intent now moves from the main renderer into the shared native service. A one-time migration retains explicit Disconnect, subsequent starts do not depend on browser storage, and stale windows cannot overwrite a newer native intent. Native startup honors the existing reconnect setting and does not issue radio/rotor operations. Original docked/mixed layouts and all-panel/full-windowed delivery remain the target; installed alpha.13 is unchanged.

Further Logbook hardening: focus-triggered refresh no longer cancels pending/visible Delete confirmation. This supersedes the earlier blanket refresh-cancellation rule above. Consent remains bound to the originally reviewed contact revision; an intervening edit conflicts rather than deleting changed data. Selection/search/paging/Cancel still invalidate consent. Three failing-before regressions now pass, the full 498-test frontend suite and build pass, and synthetic focus/resize/Delete/Undo checks pass at compact, desktop and 4K sizes. This is a local correction; the previous Windows timeout remains an open packaged gate until the new revision runs. Checkpoint O's Mac package build passed; installed alpha.13 is unchanged.

That exact source `de8bda4` now passes matrix `38342874205`: all builds and all 20 native checks on Windows first/relaunch and Linux X11/Wayland, including detached Logbook and Delete/Undo. Reports were downloaded and inspected; no station I/O. This closes the observed package regression for P, not all-window completion.

Awards is the next independent screen in source: native Window entry, existing-header Undock/Dock back, direct local totals/catalogue reads and shared logbook refresh, with a read-only native allowlist. All 501 frontend and 107 Rust tests plus build pass; scoped UI review approves proceeding to native acceptance. The new packaged child test is still unexecuted. Actual Dock/repeated-open native interactions, existing Awards scrolling/4K utilization, remaining screens, canvas and fully windowed session ownership remain open. Original docked/mixed layouts stay supported; installed alpha.13 is unchanged.

Q source `31c8096` passes its Mac push build; matrix `38344154933` remains running. The next test-only stage adds same-renderer challenge/readback after repeated native opening, real child Dock back clicks, observed native closure and main-screen routing for both Logbook and Awards. All 507 frontend tests, 109 Rust tests and TypeScript/Vite build pass locally. Native menu-model/route verification is not a physical menu-click test. These two new required packaged checks are still unexecuted; all-screen/canvas/full-session gates remain open and installed alpha.13 is unchanged.

Q's matrix has now passed all five jobs. Downloaded Windows first/relaunch and Linux X11/Wayland reports each pass 21 checks, including detached Logbook/Awards, with no station I/O and manifests naming `31c8096`. R `314bd33` has passed its Mac push build; stronger lifecycle matrix `38345134374` is still running.

The next ownership stage makes radio selection durable in the native session, using the browser value only as a one-time migration hint. View creation reads it; tab browsing still cannot disconnect. Explicit Apply is generation-checked, retires only the active radio, preserves the rotor and never auto-connects. Radio writes exclude handover but preserve concurrent urgent-control arbitration; corrupt state and failed saves do not silently choose a different radio. All 512 frontend/117 Rust tests and build pass with fake transports, including rendered hydration/Apply coverage. Hardware and exact-source packaged evidence are still outstanding; full-windowed/canvas completion is not claimed, and installed alpha.13 is unchanged.

R lifecycle matrix `38345134374` now passes all five jobs for `314bd339`: inspected Windows first/relaunch and Linux X11 first/relaunch/relocation plus Wayland reports each pass 23 checks, including same-renderer repeated opening and actual Dock back/closure/main-route recovery for Logbook and Awards. No station I/O. This strengthens the mixed-mode acceptance evidence; all-panel detachment, full-session lifecycle, canvas and local Mac runtime remain separate gates.

S `03abfe5` now also passes all five jobs in `38346387247`; inspected six native GUI reports each pass 23 checks with station I/O disabled. Radio handover uses fake-transport tests, not physical equipment verification.

T reduces independent-window startup JavaScript from 1.72 MB to 274 kB Awards, 326 kB Logbook and 288 kB Cluster by loading the requested surface without Main/Map. A 400 kB production graph budget and eager-style-order check prevent regression. All 515 frontend tests/build pass. A fresh UI review scored the two CSS-order regressions resolved after correction; supplied compact/desktop captures and failed-load recovery are browser evidence only. Exact-source package verification and native startup timings remain pending. This is a concrete performance improvement toward many lightweight windows, not completion of every-screen undocking or the configurable canvas.

U adds the shared portable layout foundation: 19 panel/screen IDs, canvas/window/hidden placement, named presets, validated logical-point geometry and SQLite revision-checked scoped edits. It survives restart and backups, follows the restore-preferences choice, and rejects stale writes after restore. Settings/canvas UI, legacy split migration, layout subscriptions and window reconciliation are not yet connected. Eleven new Swift tests pass; full portable Swift and 118 Rust tests pass. Testing also found and fixed timestamp-only recovery-file collisions during rapid database/reference restores. No real user data, equipment or installed application was changed. T's separate matrix `38348642953` has passed its three builds and is still running native runtime checks.

T's matrix has now passed all five jobs. Downloaded/inspected manifests name exact `a701a6e`; Windows first/relaunch and Linux X11 first/relaunch/relocation plus Wayland each pass 23 native checks, including Logbook/Awards lifecycle, with no station I/O. This accepts the startup-split package's isolated behavior, not actual launch latency or U's later source.

## 13 October — Spot History and supported saved-window placement

Spot History is implemented in source with a separate archive, full report detail, indexed station/date/band/mode/source search, stable historical paging and full-filter statistics. Its bounded capture queue, persistence/coverage limits and remaining advanced features are explicit in `SPOT_HISTORY_IMPLEMENTATION_PLAN_2026-10-13.md` and `SPOT_HISTORY_SOURCE_ACCEPTANCE_2026-10-13.md`. Exact `4b4df8d` Linux packaged acceptance now passes all 27 checks in four isolated launches, including the 137-report archive workflow. Windows reached frontend testing but timed out in one resize test; fake-clock correction is now tested locally and awaits a new exact-source run. Installed alpha.13 and the live archive are unchanged.

Checkpoint AA connects custom saved layouts to the six existing native windows and adds supported placement selectors in Settings. It restores desired windows, hides only prior layout-owned windows, preserves mounted drafts, keeps manual opens independent, and exposes native application errors separately from Save success. This is not full undocked mode: remaining panels, dirty-edit native hide/reveal acceptance, main-window-absent ownership, and real monitor tests are still pending. The traditional layout remains available and the unfinished built-in Windowed preset stays disabled. Source test/review evidence is recorded in the workspace plan and surface brief; installation remains separate.

## 13 October — intermediate-width Operator Desk correction

The operator confirmed that wide three-panel and narrower stacked views are good; the intermediate-width range is the defect. The equipment-present traditional desk now moves Active QSO onto its own row at 1840px of desk content width instead of waiting until 1420px. The rotor dial's default column is capped at the smaller of 160px and 42% of its body. Existing narrow/canvas overrides, the equipment-free breakpoint, and the 840px Active QSO field-wrap rule are retained. No field data, logging, station or rotor behavior changes.

Independent review caught an incorrect proposed minimum-width calculation and unnecessary earlier wrapping for equipment-free/canvas panels; those changes were removed before final verification. The final browser geometry fixture checks 18 content widths from 360 to 3840px in each equipment state, including fractional values on both transitions. All 36 cases pass panel containment, no horizontal overflow, expected stacking and compact top-row height checks. Final wide, middle and equipment-free 1450px screenshots were inspected under `.impeccable/review/desk-responsive-*.png`. The committed fixture and `prototype/tests/visual/desk-responsive-geometry.js` use only synthetic state and never connect to the worker or devices.

The 19 OperatorDesk/StationEquipment tests, full 707-test frontend suite and TypeScript/Vite/window-bundle checks pass. This is source and Chromium presentation evidence, not native WebKit or installed-app acceptance. UI-16 remains partial for custom canvas, display scaling, offline/long status and operator verification. The separately staged 5277847 Mac release does not include this later CSS correction.

## 13 October — compact full-editor context

UI-27/28/30 and the full-editor remainder of UI-40 are implemented without changing logging or lookup semantics. Sidebar station identity is centered beneath Monitor. The existing safe photo fills the inspector content width at its natural aspect ratio; identity and source are right-aligned beneath it. Photo failure collapse, stale-profile rejection, external-link validation and full-size modal focus/keyboard behavior remain covered. Tall portraits intentionally remain uncropped. Notes use soft visual wrapping, including unbroken words, without changing stored newlines or spaces; blank generic fields no longer repeat their external labels as placeholders.

The 42 focused QSOEditor/OperatorDesk tests, full 708-test frontend suite and TypeScript/Vite/window-bundle checks pass. An isolated production-component fixture uses a fixture-directory-scoped service worker to supply local landscape/portrait test images; no QRZ requests, credentials, live contacts or device connections are used. Rendered checks at 1600px (landscape and portrait), 640px (portrait), 3840px and 400px (missing image) pass full photo width/aspect, identity placement, centering, horizontal note containment and exact note-text preservation. Screenshots are in `.impeccable/review/qso-context-*.png`; reproducible fixtures are `prototype/tests/visual/qso-context-*`. Native installed acceptance remains separate. The notarized 5277847 package excludes this later stage.

## 13 October — native hourly reference checks and cache recovery

DATA-09 audit confirmed the old renderer polled hourly but the planner delayed actual checks for one day (CTY) or seven days (other sources). All seven supported sources now use one-hour successful-check deadlines and bounded one-hour failure retry. Missing or invalid caches and changed source identities become due without treating old legacy timestamps as successful checks. Source-provided semantic version extraction is not implemented; unavailable versions remain explicitly unreported. Wavelog catalog validation still checks JSON structure only, not a stronger catalog schema.

The persistent worker owns a native timer, independently of mounted/suspended renderer views. Existing browser preference migrates once to isolated workspace preferences; an unmigrated workspace does not initiate background reference network traffic. Native status is authoritative thereafter, including after restart. Ordinary settings saves cannot overwrite the immediate preference. Native deadlines avoid repeated Keychain work while sources are fresh, retry after sleep, and are fenced against stale results from workspace/configuration changes. Manual and automatic refreshes share serialization. Disabling stops subsequent scheduled sources (an already-running source may finish); shutdown/restore cancels and joins active downloads before workspace replacement. No reference preference enables QSO sync.

A nonblocking advisory lease in the stable workspace parent excludes competing new-version updater owners and protects reference-inclusive backup/restore. It is outside the replaceable Reference Data directory and backup payload. Missing/corrupt cache requests suppress retained HTTP validators so they cannot become trapped in repeated unusable 304 responses. Validated last-good files survive bad responses and cancellation; cached file identity avoids repeated parsing on unchanged native checks. Older app versions that do not participate in this lease are not made safe concurrent writers: the one-app rule remains.

Settings reads its confirmed native choice, reports save failures, and polls reference status while its tab is open even when a background task began elsewhere. Activation metadata now uses the actual source filenames. Successful check, last download, source date, ETag and legacy cache dates are kept distinct. The renderer no longer owns an hourly interval.

Verification: full frontend 719 tests in 89 files passed with one worker; TypeScript/Vite/window-bundle checks passed (existing large main-bundle/static-map warnings remain). Full portable Swift suite passed on macOS, including 9 automatic-reference lifecycle/lease tests, 12 planner tests (parameterized across all seven sources), and existing integration suites; two opt-in live probes were skipped. Core ReferenceDataUpdater suite: 14 tests passed, including 14 missing/corrupt recovery combinations and four held-response cancellation cases. Rust worker boundary suite: 23 passed, including main-only scheduling authority. Independent review found and drove fixes for the stale-validator loop, restore lock identity, and stale tick deadline race. `git diff --check` passed. Repository-wide `cargo fmt --check` reports existing formatting differences across multiple Rust files; no broad formatting rewrite was performed.

Final held-download regression also verifies that a settings revision change or disable/re-enable cycle stops an obsolete batch before it starts the next source. This adds one native test with two controlled variants, alongside the nine lifecycle/lease tests. All requests use an isolated URLProtocol fixture; only the newly created empty workspace's credential service is read, with no Keychain writes.

This is source/test evidence only. No live reference download, QSO sync, station action, credential change, installed-app replacement or restart was performed. Earlier source bddcd67 Mac CI 38404583850 and general CI 38404583757 are now successful; this later reference stage requires its own package and native/operator acceptance.

## 14 October — independent Log QSO window and alpha.14 review

The new native Window > Log QSO command (Command-L on macOS) opens a lightweight independent editor of the same canonical new-contact draft. The embedded editor remains available. Dock back can recreate a closed main window without starting a second worker or rerunning station setup. Child IPC is restricted to draft operations and read-only context; opening Monitor remains main-only. No radio or rotor controls were added to the child.

Independent review drove corrections for stale concurrent reads, reciprocal main/child protection of unfinished input, same-ID remote replacement of previously acknowledged editor buffers, and the closing/docking edit race. Save receipts and idempotence remain authoritative. Native Close/Dock guards protect unfinished inputs; explicit application Quit still does not promise preservation of invalid editor-only text. Valid canonical drafts and recovery journals retain their existing durability guarantees.

Native tests pass: 197 unit tests plus 18 integration tests. Final independent focused frontend review passes 63 tests. Production frontend compilation and window bundle budgets pass; the new QSO entry is 311,923 bytes (97,498 gzip) without importing Main/Map. Existing main-bundle size/static-map warnings remain. Synthetic actual-component captures at 640x480 and 1280x800 show no horizontal document overflow and reachable Save/Clear controls. Compact vertical scrolling remains a supported fallback, not completion of every sizing requirement. Fixtures use isolated browser storage and fake IPC; they provide no live logbook or hardware proof.

Alpha.14 package/install acceptance is in progress. Pre-update installed alpha.13 showed 67,912 contacts, six dirty local records, the NJ9L draft (revision 136), and live ShackCQ reception independently of the intentionally offline radio. Do not treat source tests as installed, sync, hardware or Windows/Linux acceptance. Remaining list includes map/logbook stacking and columns (UI-39), Clear after QSY (RADIO-05), country/DXCC context (UI-29), cloud backups, and all-panel canvas/window parity.

Final frontend suite: all 776 tests in 94 files pass with one worker (121.54 seconds). The first four-worker run during Swift compilation hit the existing five-second power-test deadline; its isolated rerun and final full suite pass without test/source relaxation. One incorrectly rooted test invocation was cancelled and is not acceptance evidence. Release Swift worker build and self-test pass (fixture-only networking, no file/station I/O), as do all three macOS worker/resource-packaging checks.

Installed alpha.14 acceptance: exact source `74f643e0680c28ae30eb4e47c7b707671f87ab4b`, Developer ID signed, Apple submission `e7dc3cb6-e74d-4637-b67b-767914ffe9ca` Accepted, stapled and Gatekeeper accepted. ZIP SHA-256 `468ba277f0607acd9e5f60c80a71a7fa7eaa7d46fcd80c395cba3ef0a151851e`. Integration was cleanly quit, updated in place, and relaunched with exactly one host/worker pair; no archived app copy was made and the original app was untouched. Installed host/worker hashes match the verified candidate. Command-L opened the real new Log QSO window with NJ9L, and Dock back returned to the embedded editor without logging or clearing it. Main-absent recovery remains untested because the operator resumed using the app.

Live acceptance preserved all 67,912 contacts and NJ9L draft ID across restart. Subsequent normal app activity brought the log to 67,970 contacts, dirty records from six to zero, draft revision 137 with the same NJ9L ID, and SQLite quick_check returned ok. ShackCQ independently received new spots (0 to 3 to 8) with radio offline; no station controls were used. Startup exposed a persistent cluster preference warning despite successful reception; this is under correction before release publication. The operator also reports the 1840px desk breakpoint stacks Active QSO too early. A follow-up alpha.15 will narrow that responsive correction rather than accepting alpha.14's breakpoint as final.

## 14 October — operator-tested breakpoint and startup-warning follow-up

UI-16 correction removes only the equipment-present 1420–1840px full-width Active QSO override. Above 1420px of desk content, all three panels remain side by side; the existing 840px card query reflows fields within Active QSO, keeping RST R contained. Existing narrow stacking and equipment-free rules remain. At the operator's approximately 1730px desk width, Active QSO has 795px of inner width and six primary tracks. Synthetic actual-component geometry passes 37 widths from 360 to 3840px for offline-rotor and equipment-free states, including fractional transitions. Long portable callsigns and 9,120 worked / 7,087 confirmed totals are included. Five inspected captures are retained under `.impeccable/review/desk-alpha15-*.png`; these are browser evidence, not the installed WebKit acceptance.

The cluster warning was reproduced with deterministic tests: startup background resume temporarily holds the native command lock, rejecting preference initialization before worker transport. The client now retries only that exact raw native busy rejection, at most three attempts with 50/150ms waits per initialization RPC. Native choice remains authoritative; the optional legacy-import second phase has its own bound. Unknown/worker errors and Connect/Disconnect are never retried. Confirmed recovery clears only its owned warning, preserving newer unrelated errors. Native production connection policy is unchanged. Focused verification: 22 responsive tests, 47 startup frontend tests, 10 native cluster tests, and 50 independent-review tests pass; two startup regressions failed before the fix. Alpha.15 packaging and installed confirmation follow final tests.

Final alpha.15 source verification: all 787 frontend tests in 95 files pass (one worker, 125.31 seconds), all 216 Rust tests pass (198 unit plus 18 integration), TypeScript/Vite/window-bundle checks and diff check pass. Subsequent read-only live alpha.14 inspection confirms 67,970 active contacts all mapped to Wavelog IDs, zero dirty records, zero outbox entries and zero conflicts. This is local reconciliation evidence; no direct remote count or synthetic live save test was performed.

Alpha.15 installed and published: source `a2c04468909928f0a9a95372892582750e0f4eb0`; Apple notarization `27706580-8b99-4dda-8460-48d99495d939` Accepted, ticket stapled and Gatekeeper accepted. ZIP SHA-256 `3a8b3f6d1a28c57db7f41c89c7d311fa38dc3e9c29a56b7dfc5534474612a351`. Release: https://github.com/oliverbross/OM0RX-xLog/releases/tag/v0.4.0-alpha.15 . Exact installed host/worker hashes match the candidate, version is 0.4.0-alpha.15, and one host/worker pair runs with no Hamlib helper processes. The original app and user data/settings/credentials were not replaced; only Integration was updated in place, without another archived app copy.

Installed WebKit inspection at the operator's current width confirms the three top panels on one row, Active QSO fields reflowed with RST R contained, and no cluster preference warning. ShackCQ received new real spots (0 to 3, including CE2II, H49A and FS5GL) while radio remained offline. Post-restart SQLite: 67,970 contacts, zero dirty, same NJ9L draft ID/revision 137, quick_check ok. No test QSO was inserted, no manual sync or station command issued. CI `38475678099` passes for the release source; cross-platform run `38475678109` is still in progress at handoff and is not claimed as accepted. Broader canvas/all-panel undocking, native main-absent recovery, hardware/Windows/Linux parity and the remaining feedback entries remain open.

## 14 October — continued Mac-first source stage while alpha.15 is tested

Three Sol-high agents implemented and independently reviewed bounded slices in
parallel. The installed alpha.15 application was not restarted or replaced.

- UI-29: the shared full editor now places compact country/DXCC context above
  UTC, aligned with the reports. Confirmed/worked/new uses green/orange/red only
  after matching complete DXCC history is available; stale, missing or failed
  evidence stays neutral. Logbook-change events invalidate same-call results and
  fence late replies. Synthetic geometry covers 40 state/width combinations.
- UI-39 foundation: Logbook has visible-column selection, bounded pointer and
  keyboard width controls, and separate docked/detached preferences. Callsign
  remains visible and pinned while the table scrolls. Compact column controls,
  selection and mutation protections remain tested. This does not implement
  map replacement, stacked map/logbook rows, column ordering or desk-specific
  preferences; UI-39 is still partial.
- Spot History is the eighth independent native window in source, with its own
  lightweight entry and four read-only archive methods. It reuses the existing
  archive owner, creates no recorder/cluster connection, and supports Dock back.
  Scoped IPC denial, singleton planning and frontend recovery tests pass.
  Desktop, compact and minimum-size actual-component fixtures have no horizontal
  document overflow or forbidden service access. Main-absent packaged lifecycle
  and native Dock-back recreation remain unverified.
- Automatic-sync completion observation moves from the main renderer to a
  single native owner. It reads only `sync_summary`, waits five seconds after
  each response, emits payload-free invalidation and fences late shutdown replies.
  Existing-worker-only transport cannot start/restart a worker and retains the
  existing generation-announcement barrier. Browser-only fallback remains.
  This is a notification fix, not a change to reconciliation or deletion policy.
  Existing 45-second transport-failure retirement behavior remains unchanged;
  the monitor itself does not recover a retired worker.

The first combined frontend run found one obsolete single-listener test mock;
it was changed to model independent subscriptions and cleanup, with no deadline
or production-safety relaxation. Final full frontend run passes **839 tests in
100 files**, one worker, 156.64 seconds. All **225 Rust tests** pass (207 unit
plus 18 integration). TypeScript, Vite production build and every detached
window bundle budget pass. Spot History's complete entry closure is 277,890
bytes (86,917 gzip), without Main/Map. Existing large-main-chunk and static/dynamic
Map import warnings remain. No Swift production source changed in this stage;
its full test suite was not rerun. These results do not replace packaged native
main-absent, live sync or hardware acceptance.

RADIO-05 remains design-only: clearing after QSY requires authoritative fresh RX
observations and a native generation/draft/revision fence, plus acknowledgements
from every active editor protecting unsaved input. First observations,
reconnects, stale telemetry, unresolved spot tuning and missing acknowledgements
must not clear a draft. No non-working setting or telemetry-triggered manual
Clear shortcut was introduced.

Read-only live evidence: 67,972 active local QSOs, all with Wavelog IDs, zero
dirty rows, outbox entries or conflicts. No manual sync, synthetic live QSO,
remote write, credential change or hardware action was performed. The direct
remote count, end-to-end save latency and full-window operation are not proved
by this snapshot. The [RUMlog gap audit](RUMLOG_WORKFLOW_GAP_AUDIT_2026-10-14.md)
records partial native menu inspection, primary documentation and remaining
import/export, Settings, cloud backup and workflow scope.
