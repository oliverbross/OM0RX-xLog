# Q02 first-run equipment repair — 5 November 2026

Source starting point: `da6fefb394944b28be9533ab861be9026306fa8d`. This report records the original source/component and native unit-test work package; no app was installed or released by that repair. Later [1.5.20 hosted installer/runtime evidence](../audits/quality-2026-11-05/ci-1.5.20-original.md) has separate partial passes and an installed-worker failure. It skips equipment and does not qualify WIN-SETUP-01. Actual packaged equipment Browse/Save/restart/readback and physical device acceptance remain **NOT RUN**.

## Defect and repair

`FirstRunSetup` uses two intentionally different catalogue adapters. Radio goes through `stationSessionRequest("radio1", {action: "hamlib_catalogue"})`, whose native owner returns `{models}`. Rotator goes through `workerRequest("hamlib_models", {device: "rotor"})`, which returns `{id, ok, result: {models}}`. The rotator wizard passed that entire envelope to a loader expecting `{models}`, producing an empty picker despite a valid helper response. The repair unwraps `.result` at the rotator adapter.

The shared catalogue cache also retained normalized empty results indefinitely. It now retains successful nonempty lists and in-flight requests, and evicts empty, unusable or rejected lists so another Browse can recover. Radio and rotor cache entries remain independent. The reviewed handoff patch was applied to the unchanged affected source, then expanded with IPC-boundary and cache regressions.

## Radio trace, independent of the rotator fix

| Stage | Owning source and observed contract | Remaining native evidence |
|---|---|---|
| Provider availability | `firstRunSetupState.ts` admits direct FLEX/TCI/Agent/DCU-1 only for literal `health.platform_services === true`. Hamlib remains offered when false. `LiveWorker.swift` advertises broad platform services as false on unsupported/isolated runtimes. | Capture actual installed Windows health, provider choices and helper identity; do not infer a provider from a screenshot/version. |
| Browse transport | `stationSession.ts` invokes `station_session_request` with exact `radio_id`. `main.rs` validates the window/runtime, then `station_session::hamlib_catalogue` dispatches only `hamlib_models` with `device: "radio"`. The native adapter validates ID, success and an array before returning `{models}`. | Actual Windows catalogue from the installed `rigctld.exe`; retain failure stage/code and retry outcome. |
| Bundled helper | `hamlib::binary_path` locates `rigctld.exe`/`rotctld.exe` beside the running Windows executable; the UI cannot choose an executable. `models` runs only `-l`, with bounded output and a deadline. A missing binary, spawn/read problem, timeout or empty parsed list is a distinct helper failure. | Verify the installer payload and actual resolved helper paths under both scopes; enumerate without a radio/rotator endpoint. |
| Finish | `completeFirstRunSetup` creates a workspace only when eligible, saves identity with onboarding incomplete, snapshots radio state, sends `save_hamlib`, validates the matching saved receipt, then saves rotor configuration and marks onboarding complete. Session storage retains a pending radio operation identity if the result is uncertain. | Native Finish with both models selected; correction/retry after partial failure. Save is separate from Connect and physical readback. |
| Persistence | Native `station_session` writes passive Hamlib setup to its session file; the existing unit test reconstructs a new `Session` and verifies the same configuration. Settings/rotor sessions validate save receipts and independent loads. | Quit normally and relaunch the installed Windows executable as the same ordinary account; read both configuration screens and setup-completion state. |

The original Windows radio failure is **not classified as fixed** by this repair. Its installer hash, native helper outcome, provider and failing step still need to be recorded.

## Repeatable checks and their boundaries

Run with the repository-installed dependencies (Vitest `5.0.3`):

```sh
cd prototype
npm run test:vitest -- src/live/FirstRunSetup.catalogues.test.tsx src/live/FirstRunSetup.transport.test.tsx src/live/FirstRunSetup.test.tsx src/live/firstRunSetupState.test.ts src/onboardingAcceptance.test.tsx src/live/HamlibPanel.test.tsx
npx --no-install tsc --noEmit
cd src-tauri
cargo test --locked --bin xlog-prototype catalogue_ -- --nocapture
cargo test --locked --bin xlog-prototype shared_hamlib_setup_is_passive_durable_and_lifecycle_uses_only_saved_configuration -- --nocapture
```

Observed: 30 Vitest tests across six files passed; TypeScript passed. The catalogue Cargo filter passed three tests (two Station Control catalogue tests and one existing worker catalogue timeout test). The separate native passive Hamlib durability test passed. Existing Rust dead-code warnings remain. An initial unqualified `--exact` Cargo filter selected zero tests; that invocation is not counted, and the commands above are the corrected executed checks.

`FirstRunSetup.transport.test.tsx` mocks only Tauri `invoke`, leaving the production wizard, worker framing, station adapter, catalogue normalization, Finish transaction and settings/rotor session owners in use. It exercises Windows-style capability health, radio and rotor empty/error → Browse again → valid options → selected dummy model → explicit Finish, then new-owner readback. Unexpected connect/motion/sync IPC fails the fixture. Its persistence is an in-memory transport fixture, **not** an installed app restart. The native durability unit test uses a temporary session file and fake device dispatch, **not** real hardware.

The existing integrated isolated packaged route still skips equipment. Native Station Control deliberately rejects isolated runtimes, so that route cannot establish actual radio catalogue/save acceptance. No guard was weakened to make it pass. Framed empty/error recovery is repeatable through the focused component/transport fixture above; healthy bundled Browse must still pass in a real packaged Windows run.

## Native Windows handoff: WIN-SETUP-01

Use a disposable ordinary Windows account/VM with native WebView2 and fresh user data. Keep the installed daily logger and real station workspace out of this procedure. For each run record installer/source/artifact SHA-256, Windows build/architecture, WebView2 version, account/elevation, install scope, actual executable/helper paths and evidence directory. Mark each outcome PASS / FAIL / BLOCKED / NOT RUN.

1. Install interactively with normal defaults, separately for Just me and All users. Record actual offered/resolved paths, UAC, shortcut/uninstall scope and first non-elevated launch. Do not use `/D` to manufacture the expected path.
2. Enter `K1TEST` / `K1TEST/P` and synthetic station details. Select Hamlib radio, Browse the actual bundled catalogue and choose its advertised Dummy/test model. Record actual model ID/helper. Continue without Connect.
3. Select Hamlib rotator, Browse and choose its advertised Dummy/test model. A supported catalogue entry establishes inventory only. Continue without motion or connection.
4. Finish local-logbook setup; inspect both saved equipment configurations. Quit normally, verify exit, relaunch the same installed binary/account and inspect both configurations plus station identity and setup-completion state.
5. Create/find/edit a synthetic QSO, quit/relaunch and verify its fields/count. Repeat fresh profiles for radio only, rotor only and Skip both; retain input and actionable errors when correcting a failed Finish.
6. Record helper-missing/unavailable and recovery separately on a disposable installation. Run the injected empty/error transport fixture separately; do not label that as a native helper failure/recovery test.
7. Repeat keyboard-only navigation at ordinary and 125–150% scale with a constrained resolution. Record focus, reachable buttons, validation and retained input.
8. Upgrade a previous supported per-user installation and exercise supported All users migration/coexistence. Record the active executable, retained workspace/external media and uninstall/rollback result.

Physical follow-up is separate: identify actual model/driver/endpoint/helper build, explicitly Connect and observe read-only frequency/azimuth; record busy/unplug/permission error recovery. No TX or antenna movement is required to prove wizard persistence.
