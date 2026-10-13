# Configurable Operator Desk and native windows

Status: shared draft, revision-safe contact editing, initial native Cluster session and native menu routing implemented; detached Logbook is in source verification. Canvas and full independent-window acceptance remain open.
Request: 13 October 2026. Baseline: `0cc7ecc` / installed alpha.13.

## Product contract

The Operator Desk becomes a configurable workspace, with two complete modes and selective undocking between them:

- **Docked:** add, hide, move and resize individual panels on a canvas.
- **Undocked:** place the same panels in independent native windows, including across monitors. The main desk need not remain open.

User clarification: **everything, including Logbook, must be detachable**. Keep the existing docked layout available as a preset. An operator may keep that layout and undock only selected screens; fully undocked operation is optional, not a forced replacement. Each detached screen offers Dock back, restoring its prior placement where possible. Persist mixed arrangements as well as the two endpoint modes.

Replace sidebar navigation with native menus. Keep every existing destination reachable, including Settings, Sync, Awards, Chaser & DX, Station Control and Monitor. Preserve the existing navy/cyan/teal visual language, compact toolbars and keyboard-first operation. Do not add redundant title rows.

This request extends the ongoing parity programme; it does not mark earlier requests complete. No radio, amplifier, CW transmission or rotor-motion testing is authorized while the station is off.

## Tracked acceptance items

| ID | Outcome | Status |
| --- | --- | --- |
| WS-01 | Every desk panel can be shown/hidden, moved and resized | Planned |
| WS-02 | Settings → Workspace provides panel selection and named layouts | Planned |
| WS-03 | Native menus replace navigation links on all three desktop platforms | In progress: complete screen menu routing in source; sidebar removal/native review pending |
| WS-04 | Window menu opens/focuses individual native panel windows | In progress: existing four windows plus Logbook in source; all other screens pending |
| WS-05 | Docked, mixed and fully undocked arrangements share one live session | In progress: draft/contact foundations and Cluster owner only |
| WS-06 | Layouts and window geometry survive restart and monitor changes | Planned |
| WS-07 | Concurrent windows cannot duplicate logging or station actions | In progress: database/client revision and receipt checks; native multi-window gate open |
| WS-08 | Responsive, accessible and measured fast interaction at laptop/4K sizes | Planned |

## Interaction defaults

- Layout is locked during normal operation. **Edit layout** enables header drag handles, resize handles, add/hide and keyboard move/resize controls. Escape cancels the current manipulation.
- Use free placement with optional 8-point snapping, not a fixed top row. Support bring forward/back and a fit/recover action so covered panels remain reachable.
- Settings → Workspace manages enabled panels, Docked/Undocked mode, saved layouts, rename/delete and restore defaults. Hiding a panel never disconnects equipment or deletes its data.
- Start with the current arrangement as the default. Save wide-monitor geometry independently of temporary viewport changes. Compact layouts must preserve readable controls rather than merely shrinking text.
- Avoid normal page scrollbars through adaptive panel internals, paging and fit-to-window layouts. If a custom arrangement cannot fit at readable minimum sizes, offer Fit, another preset or undocking; retain keyboard-accessible recovery instead of silently clipping content. Temporary overflow is a recovery fallback, not the default operating layout.
- Band maps and Cluster can remain a tab group or be placed independently. Existing column choices, widths, filters and band-map preferences survive migration.
- Unconfigured rotor remains hidden by default; configured antenna/status can be selected instead. Preserve CW macro buttons, alerts, propagation, station metrics and station identity as available panels; do not lose sidebar information when removing navigation.
- Window menu includes individual panels, Show Operator Desk, Dock All, Undock Enabled Panels and Recover Windows. Opening an existing panel focuses its singleton window.
- Closing a detached panel hides it, not the station connection. Closing the desk while other windows remain does not end the session. Closing the last workspace window restores the desk; explicit Quit performs coordinated shutdown. Platform activation can always recover the desk.

## Findings that govern implementation

`OperatorDesk.tsx` uses a fixed top grid. `OperatorWorkspace.tsx` owns only the lower map/tools split and saves its state in localStorage. Existing native detached windows and `detached_geometry.rs` provide useful singleton and work-area-clamping foundations.

The Rust worker process is already a singleton, but this alone is insufficient: `LiveApp.tsx` owns polling, the QSO draft, lookup generations, follow-radio, auto-rotor and child-window projections. Detached Cluster requests are forwarded to the main renderer. Fully undocked mode must remove this dependency; a hidden main webview is not an accepted controller.

`workspace_preferences_save` currently replaces the full preference object. Layout and Settings writers need isolated revisions or scoped updates to avoid overwriting each other.

## Implementation sequence

### 1. Shared session and draft safety (WS-05, WS-07)

Add an application-managed native session controller, reusing the existing worker and device owners. Move shared polling, selected-spot orchestration, lookup generations and automatic-action coordination out of renderer effects incrementally. Keep the current UI operational while migrating each responsibility; never run old and new owners simultaneously.

Store the canonical QSO draft with the workspace service. Use revision-checked mutations containing draft ID, operation ID and expected revision. A stale edit returns a conflict rather than replacing newer text. Preserve unacknowledged text in its initiating view until reconciled.

Make Save transactional with a durable operation receipt: saving, advancing the draft and recording the receipt succeed together. Repeating an operation after a lost response returns the original result, not another contact. Radio command uncertainty is different: reconcile observed state and do not automatically replay writes.

Expose validated, capability-scoped session operations and revisioned subscriptions. Snapshot/event handshakes recover gaps, renderer reloads and backend generation changes. Use actual native window identity, not caller-supplied labels. Service failures disable command controls and disarm automatic actions without replay on reconnect.

Critical files: `prototype/src-tauri/src/main.rs`, `worker.rs`, new `operator_session.rs`; `prototype/src/LiveApp.tsx`, `live/DetachedClusterBridge.ts`, `live/worker.ts`, new `live/operatorSession.ts`; workspace draft/logbook handlers under `Sources/XLogPrototypeSupport` and transaction support under `Sources/XLogCore`.

### 2. Panel registry and durable layouts (WS-01, WS-02)

Extract reusable panels with a registry defining stable ID, title, renderer, minimum/default size, singleton label and capability set. Render the same implementation docked and detached, avoiding divergent control behaviour.

Initial inventory: Active QSO/full editor, logbook, callsign intelligence, rotor/antenna, world map, band maps, cluster, station controls/status, station identity, CW/macros, alerts and propagation. Every remaining screen (including Settings, Sync, Awards and Chaser & DX) must also open in its own window; these do not need to become mandatory canvas widgets. Use a route inventory to prevent omissions.

Create a versioned layout document containing named presets, active preset, logical design size, per-panel placement (`canvas`, `window`, `hidden`), rectangle, stacking order, lock and snap preferences. Reject unknown IDs, duplicate singleton placements and invalid/unbounded geometry. Use a separate layout revision and scoped patch operations. Persist committed changes, not every pointer move.

Migrate existing lower-split preferences once after successful native persistence. Include portable layouts in backups; retain machine-specific display placement separately. Older backups receive compatible defaults.

Critical files: `live/workspacePreferences.ts`, `live/operatorWorkspacePreferences.ts`, new `live/operatorPanels.tsx`, `live/PanelFrame.tsx`, `Sources/XLogPrototypeSupport/LiveLogbookMethods.swift`, `Sources/XLogCore/BackupManager.swift`, Settings workspace section and associated Codable preference validation.

### 3. Canvas and responsive panels (WS-01, WS-08)

Add `OperatorCanvas.tsx` and replace fixed composition in `OperatorDesk.tsx`/`OperatorWorkspace.tsx`. Implement move/resize, snapping, keyboard equivalents, focus restoration, show/hide and recovery. Keep edit affordances absent from locked operating mode. Define the direction contract in the surface brief before UI edits and follow the Impeccable craft-floor/review workflow.

Use lightweight transforms during dragging, bounded resize updates for maps, and final persistence at interaction end. Subscribe each panel only to its necessary state; do not cause a whole-desk render or history query on each telemetry event. Maintain compact breakpoints for QSO fields, intelligence, rotor and toolbars.

### 4. Native menus and independent windows (WS-03 through WS-06)

Extend platform-default menus with Log/View, Station, Workspace and Window actions. Route commands through the backend regardless of focused window. Remove sidebar links only after a route inventory proves all destinations reachable. Retain navigation only for non-native browser fixtures where a native menu cannot exist.

Generalize singleton window construction and add a shared `DetachedPanelSurface.tsx`. Replace renderer-to-renderer projections with session subscriptions. Limit capabilities by panel rather than granting every window main-window permissions.

Extend geometry recovery to every window, including Monitor and the main desk. Preserve preferred display-relative logical bounds, scale/display identity, normal restore bounds and maximized state. Do not overwrite preferred bounds merely because a monitor was temporarily unplugged. Migrate existing physical geometry conservatively; always clamp a usable title bar into a current work area.

Critical files: `prototype/src-tauri/src/main.rs`, `detached_geometry.rs`, `capabilities/default.json`, `tauri.conf.json`, React entry routing, detached surfaces, menu/session tests.

### 5. Verification and release (all items)

Keep separate evidence for unit tests, browser interaction, native runtime, signed packages and each operating system. Do not label a canvas-only milestone fully undocked. Package from a clean committed source revision; test and identify that exact installed build.

Required gates:

- Two editing surfaces observe one draft; conflicting edits are handled, acknowledged edits survive restart, repeated Save/double-click/lost response creates exactly one QSO. Logging retries never tune or transmit.
- Close or deliberately fail the main renderer: all remaining windows continue receiving updates and processing permitted operations. Instrumentation shows one device owner, one polling owner and no duplicate automatic actions.
- All former sidebar routes and Window actions work with main and child focus on macOS, Windows and Linux. Unsupported platform evidence remains explicitly pending.
- Add/hide/move/resize/dock/undock, keyboard manipulation, preset/reset, restart, backup restore and simultaneous layout/Settings edits retain correct state.
- Test 1280×800, 1440×900 and 3840×2160, UI scaling, mixed-DPI/negative-origin displays, unplug/reconnect, maximize/restore and window recovery. No unreachable controls or routine outer overflow.
- Record drag frame-time, input latency, lookup time, renderer CPU/memory and subscription/poll counts against alpha.13 with generated 100,000-contact data and dense spot fixtures. Target fluid 60 Hz manipulation and under 100 ms local control feedback; separate remote lookup/network delay from UI latency. Do not claim speed without measurements.
- Existing cluster reconnect/spot retention, maps, awards, Chaser, standalone/Wavelog mode, CW safety, rotor ownership and offline behaviour remain covered by regression tests. Use fixtures/instrumented backends while hardware is off; no RF acceptance claim.

## Delivery checkpoints

1. Shared-session and draft safety proven behind existing UI.
2. Configurable docked canvas and backed-up layouts accepted.
3. Native menus and independent panels accepted with main renderer absent.
4. Exact packaged cross-platform verification and performance evidence recorded.

No user answer is needed for these defaults. This plan records the requested endpoint; implementation and release gates remain open.

### Checkpoint A — durable draft foundation

Implemented in source, not connected to the installed UI: `OperatorDraft.swift`, transactional database methods and three bounded worker operations (`logbook_operator_draft`, `logbook_operator_draft_apply`, `logbook_operator_draft_receipt`). Replace, Clear and Save require the current draft ID/revision and a unique operation ID. Conflicts return the current snapshot without applying the stale request. Save atomically inserts a new QSO, advances the draft and writes a durable receipt; a retry returns that original result without resetting a newer draft. Reusing an operation ID with different input is rejected.

Only new-contact drafts are covered here. Logged-contact editing still uses its existing path and needs its own revision contract before becoming multi-window. Existing frontend draft/localStorage behaviour is deliberately unchanged until session migration; no independent-window gate is closed by these methods alone.

Recent non-save receipts retain a 256-revision retry window; older retries fail the revision fence. Save receipts do not expire. Receipt responses are historical operation results, not fresh snapshots. Drafts are limited to 24 KiB and request parameters to 32,000 bytes beneath the native IPC limit. Existing native window permissions are not expanded: only `main` can call these operations until the panel capability registry is implemented.

Evidence: 10 focused Swift tests pass, covering separate database connections, simultaneous saves, restart/lost acknowledgement, operation-ID misuse, injected receipt-write rollback, logged-contact identity protection, validation, bounded transient receipts, backup recovery, worker conflict responses and terminal shutdown. The shared Swift regression suite passed before the final shutdown-fence addition (80 Swift Testing cases plus XCTest suites); the focused 10-test rerun includes that addition. Native core regression tests pass (73). Rust worker boundary tests pass (15), as do local acceptance boundary tests (9). Cross-platform CI on this new source and renderer migration remain pending.

### Checkpoint B — native Cluster session extraction

Implemented in source, not installed: `prototype/src-tauri/src/cluster_session.rs` now owns one background snapshot poller, a revisioned last-good projection, bounded command admission and the existing Swift worker transport. Main-window snapshot reads reuse that projection. Detached Cluster commands go directly to the native owner; the main-renderer request-ticket relay and full-snapshot publisher are removed. No command is retried after an uncertain response. Service failures retain spots and mark the projection unavailable; shutdown rejects late results. Explicit window capabilities keep Cluster away from credentials and station/logbook writes, and unknown labels no longer inherit main-window permissions. Local-only acceptance's history reads bypass this owner so they cannot activate live polling.

This is **not** complete shared-session ownership: spot selection/tuning still reaches the QSO renderer; draft UI, lookup generations, follow-radio, automatic rotor logic, connection restart intent and other detached projections have not migrated. Closing the main renderer is not yet a supported whole-app workflow. Native menus, all-screen windows (including Logbook), canvas and geometry/lifecycle acceptance remain open.

Evidence: 87 Rust tests pass, including 9 native Cluster-owner tests and scoped worker-boundary checks. Full frontend suite: 367 tests across 57 files; TypeScript and production Vite build pass. The existing large-bundle/ineffective Map dynamic-import warning remains a performance follow-up. An isolated browser fixture checked loading, last-good/stale state and Refresh recovery at 1180×800 and 640×480; no browser exceptions, and compact document width equals viewport width. The fixture performed no live IPC or station/network action. Screenshots are retained in `/tmp/xlog-cluster-session-8vB0Ls`. The temporary harness was removed after verification.

**WS-08 remains open:** all 14 selected Cluster columns become over-compressed at 640 px; the retained table also does not yet use the full detached-window height. Address these in the panel sizing/canvas pass, not by hiding inaccessible overflow. These screenshots are not native runtime or whole-feature acceptance.

Checkpoint A source `bdeea582da377378df3874fb2d73f175d34b0d73` passed matrix `38317820765` (three builds, Windows fresh-runner and Linux runtime-only container acceptance) and Mac push `38317780404`. These results do not cover this subsequent Cluster extraction. Exact checkpoint B native runtime, cross-platform CI and packaged evidence remain pending. Installed alpha.13 is unchanged.

Checkpoint B source is committed and pushed as `5670cd72144323531b60a4c79bd732c9e73ab9de`. All-platform matrix `38319902334` passed all three builds, Windows fresh-runner runtime acceptance and Linux runtime-only container acceptance. Mac push `38319864420` also passed. These checks do not exercise closing the live main renderer with Cluster still operating, and are not physical desktop/hardware acceptance. No new package has been installed or released.

### Checkpoint C — draft client recovery contract

The new `operatorDraftSession.ts` client targets the existing durable draft API. It retains local text and the precise pending operation in a recovery journal before sending a write, serializes Replace operations, deduplicates concurrent Save, and requires explicit conflict resolution. Lost acknowledgements are reconciled from receipts; only an explicit Retry reuses the original operation ID. Even a definite worker error checks the receipt first, because aggregate refresh can fail after a committed Save. Historical receipts are followed by a fresh draft read. The IPC adapter correlates response IDs and distinguishes explicit worker rejection from lost transport. UUID casing, ISO timestamps and omitted Swift optional fields are compared semantically.

**At checkpoint C this was not enabled in the editor; checkpoint D below integrates it in source.** Its migration gate requires recovery/conflict controls, preserved or explicit migration of legacy browser draft text, fenced backup/workspace changes, and existing keyboard/rotor/readback UI tests exercising the new Save path. Logged-contact editing needs a separate revision contract; do not silently treat an existing contact as a new shared draft. The client has no station, tuning, CW or rotor operations. Full independent-window acceptance remains open.

Migration must also block backup restore while a draft operation is unresolved and invalidate pending client state when the workspace changes. Before granting multiple windows restore authority, introduce a native workspace-generation fence so a receipt removed by restoring an older backup cannot authorize stale command replay. This client alone does not establish that restore boundary.

Client evidence: 20 focused tests cover conflicting windows, duplicate Save, journal/storage failure, lost and mismatched acknowledgements, restart, not-delivered retry with the same ID, definite worker rejection after commit, newer typing during Replace, historical receipt reconciliation, Clear, reset/late loads and conflict-resolution races. Full frontend suite: 387 passed across 59 files; TypeScript and production Vite build pass (existing bundle-size/Map chunking warnings remain). An initial transport-test hook accidentally returned a mock function, which the test runner invoked as cleanup; that test defect was fixed and the full suite rerun successfully. No native or UI-migration acceptance is inferred from these isolated client tests.

### Checkpoint D — existing editor uses the shared draft

`LiveApp` now uses the durable draft client for new contacts in both Operator Desk and Log QSO. Save is receipt-backed and advances the canonical draft without a second Clear request. Logged-contact edits remain separate from that active draft and use their existing update path; this does not grant them multi-window write authority. A 350 ms debounce persists typing, and a 1500 ms read refresh observes shared updates. This refresh is still renderer-owned, so main-window-independent orchestration remains open.

Recovery controls appear only when needed: check the pending receipt, explicitly retry the same operation, use the shared draft, retain same-draft local text, or copy local text. Uncertain terminal actions lock QSO entry only; rotor Stop stays outside that lock. Normal Save retains Follow radio; uncertain Save/Clear or a conflict disarms follow/automatic rotor intent. Legacy localStorage text is not silently logged or substituted: the operator can copy, discard, or recover it explicitly into a blank new draft with a new identity and no Wavelog mapping.

Backup creation flushes the draft first. Restore refuses unresolved operations/conflicts and logged-contact edits, locks entry through the initial flush and restore, and clears the journal only after success. An uncertain restore remains locked until reopening. The native workspace-generation fence is still required before granting other windows restore authority. Delayed draft reads from before an acknowledged write are ignored, preventing false conflicts after Save/Clear.

Verification: TypeScript, production Vite build and 398 frontend tests across 59 files passed, including the existing rotor/keyboard/readback cases and explicit update/cancel of a logged-contact edit while preserving the active draft. Browser fixture checks at 1280×800, 800×650 and 640×720 showed reachable recovery controls, no horizontal overflow at 640 px, QSO-only inert state and available Rotor Stop. Explicit Use shared draft displayed OTHER; receipt recovery returned the blank next draft without another Save. No browser errors were reported. Synthetic evidence is under `/tmp/xlog-draft-qa-IEIRtA`; the temporary fixture was removed. No real station command was sent. Existing clipped date/band controls at intermediate desk widths are recorded under WS-08, not silently accepted. Existing large-bundle/ineffective Map split warnings remain open performance work.

Checkpoint C Mac CI `38321507510` passed; it does not cover the subsequent editor integration. Checkpoint D native transport/UI, packaged acceptance, all-screen undocking, native menus and actual desktop OS gates remain pending. Installed alpha.13 is unchanged.

### Checkpoint E — existing-contact concurrency boundary

The backend now exposes `logbook_contact`, `logbook_contact_apply` and `logbook_contact_receipt` for existing contacts. Update, Delete and Restore require a contact ID, that contact's revision and an operation ID. A SQLite write transaction checks the revision, applies the change, advances the revision through a trigger and writes the receipt atomically. A stale operation returns a conflict snapshot (or null for a removed contact). Reusing an operation ID with different input is rejected; repeating the same operation returns its historical receipt without overwriting newer data.

Per-contact revisions are separate from the aggregate-cache revision: an unrelated QSO edit does not invalidate the open contact. SQLite INSERT/UPDATE/DELETE triggers cover existing native, import, sync and external database writers. Legacy rows read at revision zero without a backfill scan or QSO rewrite. Revision history survives physical removal/reinsertion of an ID. Updates preserve the local ID and Wavelog mapping, validate bounded contact data and mark the contact dirty through the existing save path. No credentials, station policy or connection behaviour changes.

**This API is not yet wired to the existing-contact editor or detached Logbook.** The old `logbook_save` path remains for current logged-contact edits. Next gates are the contact-edit recovery client/UI, native workspace-generation fencing across restore, and explicit detached-window capabilities/lifecycle. Only the main surface may use the new methods; unknown labels and current detached windows remain denied. Shutdown rejects new contact requests. The active new-contact draft is unaffected. The fully undocked gate remains open.

Evidence: 10 focused Swift tests pass (separate connections, competing editors, unrelated edits, generic writers, lost-ack restart, operation-ID misuse, Delete/Undo, physical removal, migration, mapping/data validation, receipt-write rollback, backup receipt retention, bounded worker responses and shutdown). The shared suite passed with 90 Swift Testing cases and the XCTest suites (17 station, 92 prototype, 50 cluster cases; Windows Credential Manager skipped on macOS and two optional benchmarks disabled). That full run preceded the added backup-specific case; the final focused 10-test run covers it. Native core: 73 passed. Rust: 87 binary tests passed; final worker-boundary rerun: 16 passed. Initial test macro `try` errors were corrected; an invalid `cargo --lib` invocation was replaced with the actual binary test target.

Generated 100,000-contact database benchmark, debug build on this Mac: 100 contact reads p95 **0.064 ms**, 25 transactional updates p95 **0.553 ms**; first list 2 ms, stats 21 ms, award progress 225 ms, map statuses 17 ms, award catalogue 604 ms, callsign/country history 247 ms. Fixture import took 31,910 ms and derived-index migration 1,295 ms. These are backend-only measurements, not end-to-end UI, network or RF performance and not a cross-platform claim. Aggregate/lookup/UI performance gates remain open.

Checkpoint D source `0d4358056646562437f0f77cc686497bc4bd826f` passed Mac CI `38323200735` and Mac prototype job `38323200520`; Windows/Linux runtime jobs were skipped in that push workflow. Those results do not cover checkpoint E. No new package is installed; alpha.13 remains the sole installed Integration build.

### Checkpoint F — existing-contact editor recovery

The main Desk/full editor now uses `LogbookContactSession` and a correlated contact-only IPC adapter instead of `logbook_save`. Typing remains local; explicit Update journals the exact operation identity before dispatch. Concurrent Update requests share one operation. Lost acknowledgements and post-commit worker errors are reconciled using durable receipts, including after renderer restart. Retry preserves the same operation ID; a stale/deleted contact retains local text without overwriting or resurrecting it. Recovery offers Copy my edits, Load latest contact where available, or Cancel edit. The separate new-QSO draft remains intact.

Only QSO entry is locked while an update is unresolved; unrelated navigation and rotor Stop retain their existing boundaries. Recovered edits disable Follow radio and automatic rotor intent. Backup replacement is blocked while a contact edit or update is retained. A failed contact-receipt read no longer prevents the workspace and recovery controls from opening. Slow refresh reads are shared, and unchanged conflict state does not rewrite the recovery journal repeatedly.

Evidence: TypeScript, production Vite build and all **419 frontend tests across 61 files** pass. New coverage includes 14 contact-session tests, 2 transport tests and rendered restart/conflict/deleted-contact/unavailable-receipt/backup-restore workflows. The first full run exposed an incomplete preferences test fixture on remount and a 5-second monitor-test timeout; the fixture was corrected, the monitor test passed independently, and the complete single-worker rerun passed. No timeout was increased to mask a failure. The existing large-bundle and ineffective Map dynamic-import warnings remain open performance work.

Isolated browser checks of production recovery/editor components at 1280×800, 800×700 and 640×600 verified readable wrapping, pending recovery, explicit conflict resolution and zero reported browser exceptions. Compact document width was 640 px at a 640 px viewport. Evidence: `/tmp/xlog-contact-qa-rOgMqL/report.md` and screenshots there. The synthetic harness was removed and its browser session closed; it did not access the real workspace or station. This does not close full-editor vertical sizing/WS-08 or native/package acceptance.

**Still pending:** native workspace-generation fencing across backup restore, revision-safe table Delete/Undo UI, capability registry, detachable Logbook/all-screen routes, native menus, canvas/layout persistence, main-renderer-absent session ownership and exact packaged tests. The contact service remains restricted to `main`; no detached edit authority is granted by this checkpoint. Installed alpha.13 is unchanged.

Checkpoint E source `980e1c4a91a5f1631a664e2be2e61d346abcbeed` passed Mac prototype CI `38324231294`. Matrix `38324265409` has passed the Mac/Windows/Linux build jobs; its separate Windows/Linux runtime acceptance jobs were still queued at this checkpoint's local verification. Those results cover E, not F.

### Checkpoint G — workspace generation across restore

Draft/contact snapshots, mutations and receipt lookups now carry a workspace generation. A validated, protected sidecar outside the backup payload retains it across normal restarts and rotates before database replacement under the existing worker lock. Old operations are rejected even when an older backup reproduces the same contact/draft ID and revision or contains the old receipt. Invalid restore confirmation leaves the generation unchanged; an invalid identity fails before database replacement. A later restore failure may still invalidate clients, intentionally requiring explicit recovery.

Both clients retain old text and uncertain operations, block automatic replay, and offer Copy plus explicit Load current workspace recovery. Pre-generation journals are retained but cannot write until explicitly resolved. Contact cancellation remains available. Follow-radio/automatic rotor and spot-loading paths cannot act on the retained old draft. Table Delete/Undo migration and detached-window capabilities remain separate gates; this does not yet grant detached editing authority.

Evidence: shared Swift regression suite passed (96 Swift Testing cases plus XCTest suites), including five new generation/restore tests. TypeScript, all 429 frontend tests across 61 files and production Vite build pass. Tests cover identical IDs/revisions after restore, lost Save acknowledgement, restored receipts, restart persistence, malformed identity and legacy journal recovery. The final frontend result was rerun after an earlier completed tool result was lost; no still-running duplicate was started. Existing large-bundle/ineffective Map import warnings remain.

The isolated browser warning/action check passed at 1280×800 and 640×600, with no reported exceptions. Evidence: `/tmp/xlog-restore-qa-oHYcVQ/report.md` and screenshots. Impeccable hardening preserved the existing recovery styling, made old-workspace actions explicit and kept them wrapping on narrow windows. The temporary harness was removed; no live workspace or station was accessed. Native/package and physical desktop acceptance remain open; alpha.13 is unchanged.

Checkpoint F source `839aa696b3c246a65d913bc82ab49b19579676a8` passed Mac CI `38326095246` and prototype `38326095238`. Checkpoint E all-platform run `38324265409` is now fully successful, including Windows fresh-runner and Linux runtime-only acceptance; Mac `38324231294` and `38324231297` also succeeded. These results do not cover checkpoint G or prove physical Windows/Linux desktop operation.

### Checkpoint H — revision-safe Logbook Delete/Undo

The Logbook table no longer calls ID-only `logbook_delete`/`logbook_undo`. Delete first loads a verified generation/revision snapshot for confirmation. Confirmation applies exactly that revision; Undo uses the committed deletion receipt's revision, never a fresh revision silently read at Undo time. Concurrent changes produce an explicit conflict without overwriting or resurrecting a contact. One latest Undo is retained across view changes and renderer restarts.

A main-view mutation owner journals the exact operation before dispatch, blocks conflicting table writes while unresolved, checks durable receipts and reuses the same operation ID only on explicit Retry. A failed local journal write sends nothing; failure to clear a committed receipt retains the pending identity for reconciliation. Recovery remains visible across navigation. Backup replacement is blocked during an unresolved Delete/Undo; generation checks reject prior Undo after a restore. No radio method or detached permission is added.

Evidence: TypeScript, the complete frontend suite (441 tests / 62 files) and Vite build passed. Ten new operation tests cover stale confirmation/Undo, lost acknowledgement/restart, exact retry, concurrent admission, post-commit errors, invalid receipts, journal failures and restore invalidation. Rendered tests cover keyboard confirmation, navigation/restart/receipt-based Undo and the backup replacement gate. After aligning the journal key with the versioned main-view naming convention, the final 41 focused tests, TypeScript and build passed. An initial final-check invocation collided with removal of the temporary browser fixture and failed with a missing fixture file; it was rerun successfully after fixture removal completed. Existing bundle-size/Map import warnings remain open.

Isolated browser recovery and actions passed at 1280×800 and 640×600, including restored-workspace rejection and explicit discard, with no reported exceptions. Evidence: `/tmp/xlog-restore-qa-oHYcVQ/mutation-report.md`. Impeccable hardening kept recovery controls in the existing wrapping warning style. The table's existing compact minimum-width overflow and compact height utilization remain WS-08 work, not accepted by this check. Temporary fixtures were removed; installed alpha.13 is unchanged.

Checkpoint G is committed/pushed as `b136867e1811ed560f7496cc95cbd039006c1a29`. Mac CI `38327892878` and prototype `38327892886` succeeded. Independent panels/Logbook, all-screen capabilities, remaining shared-session ownership, native menus, canvas/layouts and exact packaged/OS desktop acceptance are still open. The existing docked layout is retained throughout.

### Checkpoint I — native menu routing and screen inventory

One bundled screen registry now supplies the main navigation inventory and native Logbook/Station/View menu destinations, including Logbook, Settings and Sync. Platform-default app/Edit/Window/Help items and existing workspace sizes are preserved. Window exposes the four existing detached surfaces (Monitor, World Map, Band Maps and Cluster); no unavailable Logbook window is falsely advertised. Cmd/Ctrl+1…4 navigate Desk, QSO entry, Logbook and Cluster; Cmd/Ctrl+, opens Settings. These modifiers cannot trigger the existing function-key-only CW macros.

The native owner retains the latest menu request until the main view acknowledges its revision. Subscription-before-read recovers early clicks; coalesced reads, monotonic revisions, exact acknowledgements and unmount checks prevent stale replay. Only the actual main webview can consume/acknowledge routing. Menu navigation invokes no worker operation; standalone-mode Sync goes to the mode setting without starting synchronization or mounting its service panel. The sidebar stays until complete routing, window recovery and OS-native interaction are accepted.

The isolated desktop acceptance harness now requires actual native menu entries and the production native-state/IPC/rendered-route path for every screen, plus rendered logged-contact Update and revision-safe Delete/Undo. Its hardware/network isolation is unchanged; the Rust local allowlist adds only the three already-isolated contact methods. This path proves menu model and routing when executed, not physical OS menu clicks or keyboard accelerators.

Source evidence: 90 Rust tests pass, including three registry/retention/authority tests; TypeScript, 450 frontend tests across 63 files and the production build pass. Seven bridge tests and two rendered tests cover early notifications, coalescing, stale revisions, acknowledgement failure, cleanup, retained draft and zero equipment/sync mutations. The final 33 focused tests also pass after the standalone-mode early-routing guard. Native packaged execution, native screenshots/finish review and documentation verdict are still pending. The new native-navigation surface brief records those gates; the established design system is not replaced.

Checkpoint H `66e177898679c476923bbf6389c0d713cabb01dd` passed all-platform run `38328817888`: Mac/Windows/Linux build jobs and Windows fresh-runner/Linux runtime-only acceptance. This is evidence for H, not I.

Checkpoint I is committed as `1bc5e9587df47928f3403e18d7f9cc8114f6dd05`. Mac CI `38329953244` and general CI `38329953284` passed. The Mac artifact's embedded source metadata matches I; its ad-hoc signature passes deep/strict verification and its archive SHA-256 is `a853a64ce7d67de201763bb8ea7b12b53f83e0932926d39b54f922d83ca57a9a`. It is not a notarized release. All-platform run `38331060293` is in progress; its result remains a separate gate.

Local packaged acceptance is **not executed**. The local build wrapper repeatedly stopped compilation at its 120-second limit; a background build did not complete. The CI artifact was retrieved instead. The shell runner then permanently rejected direct `xlog-prototype` invocation, so no isolated report was created. The native inspector inadvertently launched the CI candidate normally before that asynchronous rejection was observed; it was stopped without contact edits or station commands. Its native accessibility tree exposed the Logbook menu and its five destinations, but screenshot capture was unavailable. That limited observation is neither isolated acceptance nor visual/accelerator approval. Do not retry the blocked invocation through another execution route.

Installed alpha.13 was reopened from `/Applications/OM0RX-xLog Integration.app`; one app/worker pair was verified, its 67,846-contact count remained intact, and ShackCQ showed Connected. No candidate was installed and the original native apps were untouched. Native screenshot/finish review remains open. All-screen independent windows, main-view-absent session ownership, canvas/layouts and Windows/Linux desktop acceptance remain open.

I follow-up: all five jobs in `38331060293` passed. Downloaded Windows first/relaunch reports and Linux X11/Wayland reports each confirm all 19 integrated-local checks, including `native_menu_routes`, `contact_edit` and `contact_delete_undo`, with `station_io:false`. Evidence is under `/tmp/xlog-native-menu-Fs5x1I/{windows,linux}`. These are real isolated WebView2/WebKit runs for I, not physical menu/keyboard or radio acceptance, and not evidence for J below.

### Checkpoint J — independent Logbook surface

Logbook now has an Undock action in its existing toolbar and a singleton Window-menu entry. Its detached surface directly reuses `LogbookPanel` and `QSOEditor`, with search, ADIF import/export, Update and Delete/Undo. It does not mount `MainLiveApp`, radio polling, CW controls or Follow radio. Contact and mutation journals use distinct `logbook` keys, leaving the main journals and active new-QSO draft separate. Revision/generation conflicts retain local text; reopening resolves a lost acknowledgement from its receipt without a new write.

Native authority is scoped to local logbook operations and contact lookup/history; station actions, configuration, secrets, sync, new-contact draft mutations and legacy ID-only writes remain denied. Detached country-history reads go directly to the worker and do not start Cluster polling. A native invalidation wakes the other logbook view after possible writes (including failed partial imports/sync), excluding the initiating view. Burst notifications are debounced, focus recovers missed events, and draft typing does not invalidate the logbook.

Close and Dock are protected while an edit or operation is unsettled. The close listener invokes a native command that can destroy only its own Logbook; no generic cross-window destroy permission is granted. Dock uses revisioned native navigation rather than a lossy renderer-to-renderer event. Existing geometry restore/watch is reused; full display-relative layout persistence remains WS-06 work.

Source evidence: 459 frontend tests across 65 files, TypeScript and Vite build pass; 92 Rust tests pass. The final nine focused tests and build also pass after using the scoped native close command. Four rendered detached tests cover journal separation/no radio controls, cross-window edit conflict, lost acknowledgement/reopen and Delete/Undo/reopen/Dock. Five bridge tests cover desktop gating, invalidation coalescing, focus recovery, cleanup and close protection. The local Tauri implementation was checked to confirm that registering a native close listener defers default closing.

The isolated native acceptance harness now requires a real detached Logbook to edit and restore the synthetic contact, report the absence of radio controls, and complete native closure before final map evidence. This new check is not yet executed. Native packaging, visual screenshots/finish review/documentation verdict and installation remain pending. The existing compact table minimum-width/scrolling issue is still WS-08; it is not hidden. This checkpoint is not fully undocked mode: main-window recreation, the other independent screens and migration of all shared station/session ownership remain open.

## Follow-on: RUMlogNG workflow and feature comparison

User added this reference pass after the canvas/native-window request. Confirmed installed app identity through the native app inventory: `de.dl2rum.RUMlogNG`; it was not running at inspection. Its menus/settings have not yet been audited in this pass. Do not represent remembered features as current observations.

Track as **RUM-01: reference audit**, **RUM-02: evidence-backed gap matrix**, and **RUM-03: prioritized independent implementations**, all pending. Finish the requested workspace changes before expanding into the broader RUMlog parity programme; inspect menu conventions early enough to inform our menu naming and grouping.

Audit the installed app's menu hierarchy and shortcuts, preferences categories, separate windows and layout recovery, log editing/search/import/export, QSL/LoTW/Club Log, awards, cluster/band maps, station/rotor/CW, contest workflows and useful integrations. Record the installed version and observed behaviour, distinguish disabled/unconfigured capabilities from missing features, and avoid changing its configuration or logbook. Do not open secret fields, trigger sync/import, select tuning spots, connect hardware or run station controls as part of the comparison.

Produce a matrix with the observed workflow, xLog counterpart, status (equivalent/partial/missing/not applicable), concrete user benefit, priority, implementation scope and acceptance test. Inspect existing xLog code before declaring a gap. Use the findings to reproduce familiar user-facing conventions and capabilities in our own architecture, not to clone every menu item blindly.

Implement independently from observed behaviour and public documentation. Do not copy proprietary source, icons, artwork or manual text. Do not assume licensing or patent status from the user's general statement; evaluate any specific third-party reuse separately. Keep the modern cross-platform UI, responsiveness and single-session safety contract intact.
