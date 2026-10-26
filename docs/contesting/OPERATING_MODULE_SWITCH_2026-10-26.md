# Normal Logging / Contesting switch repair

Both Contest menu mode commands use the existing guarded application restart to close the complete outgoing window set, including manually opened windows, cluster, radio and rotor tools. The restart restores the selected module's saved connections through the existing station owners. It does not add tuning, rotor movement or transmit commands.

The previous transition required one particular renderer to exist, rejected any open normal Log QSO / Logbook / CW window, and omitted a destination for the two mode menu commands. Rejections could appear to do nothing because they were reported only through notifications and the contest Messages window.

The repaired transition:

- Prepares every surviving main, Contest Setup, Log QSO and Logbook editor. An absent controller is permitted; any open editor must acknowledge the exact request. A new editor arriving during preparation causes a retry.
- Retains existing incomplete-input, pending-action, retained-receipt, CW, PTT and voice guards. Detached editor input remains inert from acknowledgement until cancellation or restart. The contest owner flushes its current draft through its existing controller.
- Recovers a preparation request delivered before renderer listeners were installed and reports the actual editor veto reason.
- Allows an explicit workspace rebuild even if the target module is already selected, while rotating the operating context and retaining all admission fences.
- Finalizes recorder capture before retiring station services, then uses the existing worker shutdown to release radio and receive leases, cluster, rotor and other owners.
- Persists a default restart destination: normal Operator Desk or Contest Setup. Failures from the mode menu also show a native foreground dialog.

Validation passed in the canonical checkout: 72 frontend tests across six files, 18 native operating-module tests, five native restart-intent tests, and TypeScript checking. Commands:

```sh
cd prototype
npm exec -- vitest run src/operatingModulePreparation.test.ts src/live/normalModuleTransition.test.ts src/live/operatorDraftWindows.test.ts src/live/logbookWindows.test.ts src/live/DetachedQSOSurface.test.tsx src/live/DetachedLogbookSurface.test.tsx
npm exec -- tsc --noEmit -p tsconfig.json
cd src-tauri
cargo test --bin xlog-prototype operating_module --no-default-features
cargo test --bin xlog-prototype module_restart_intent --no-default-features
```

This is source/test evidence. No candidate was packaged or installed by this change, and no live radio, rotor or transmit operation was exercised. The coordinated release must include the readiness, Log Review and CW source gates before packaging, and the protected installation owner must perform final installed-app acceptance of both directions with the operator's actual layouts and connections.

## Combined frontend gate follow-up

The production graph includes a 1,341-byte shared editor-preparation chunk after this repair. The fresh Logbook startup graph measures 404,998 bytes (130,274 gzip). Its local byte budget is 405,200, an increase of 1,400 bytes from 403,800 with 202 bytes of headroom. Other budgets and all main-workspace, map, IQ panel and CSS graph exclusion checks remain unchanged; the complete `npm run build` gate passes for all 24 detached surfaces.

The combined gate also exposed a missing `cw-decode` entry in the TypeScript native-window status allowlist. The allowlist, public status type and expected-role test now include that existing Rust role in the exact native order; validation still rejects unknown roles. The 48 window-status/Workspace Settings cases pass, alongside all 29 rotor integration cases.

## Installed 1.3.28 handover boundary

Installed acceptance reached the normal-editor preparation guard. Read-only inspection of the application's WebKit local-storage journal found a retained normal-logging `clear` operation with base and expected revision 2915. Its local draft matches its saved base and contains a callsign; no callsign value is recorded here. The confirmed normal database has no receipt for that operation, and its canonical draft remains at revision 2915. No journal, receipt or database row was changed during diagnosis.

This is protected pending work, not evidence of an empty contest draft being rejected. Returning to Normal Logging remains blocked until the operator decides whether to retain the normal draft or complete the original Clear. Its inactive normal-window bootstrap also prevents reaching that review through the current UI; that recovery deadlock remains an acceptance limitation, not a reason to silently clear or replay the operation.

The guard now reports its specific pending-operation, unsaved-field, conflict, activation or radio-setup reason and uses direction-neutral wording. All original veto conditions remain in place. A software replacement may preserve this state, but must preserve the WebKit journal along with the database; replacement does not count as successful bidirectional handover acceptance.

## Passive incoming normal draft

After the original Clear receives its durable receipt, the normal draft becomes blank. A separate source-level failure path could then seed that blank from radio telemetry and queue a normal draft autosave while Contesting still owned mutation admission. The rejected autosave would manufacture a new pending Replace and block handover again.

The main renderer now verifies native operating-module authority before normal QSO editing, radio seeding, power editing or draft autosave. Contesting keeps that incoming normal draft passive; shared station observations and settings remain available. Receipt reconciliation still runs, so the original completed Clear can settle without another Clear or a replacement write. No existing pending-operation or station-output guard is relaxed.

Validation: 23 focused tests pass, including both inactive-radio seeding prevention and the exact completed-Clear receipt recovery without a second mutation; TypeScript, Vite and all detached-window bundle graph gates pass through `npm run build`. The original Clear recovery helper was separately rehearsed on a database copy through `XLogCore.LogbookDatabase.applyOperatorDraft`: the original operation advances 2915 to 2916 once, its repeat returns the same receipt, and all 24 tables were compared with only draft and receipt tables changed.
