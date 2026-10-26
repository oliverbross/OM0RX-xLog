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

## Authorized original Clear completed

The operator explicitly chose “Complete the original Clear of that draft.” After a normal protected Quit, verified application/worker quiescence, a fresh four-root backup and separate exact WebKit local-storage backup, the original journal's generation, draft identity and expected revision were rechecked. The existing `XLogCore` transaction API completed that exact retained mutation once, producing a matching Clear receipt and a blank draft at revision 2916. No new operation identity was created.

Post-recovery comparison checked all 24 normal-database tables: only `xlog_operator_draft` and `xlog_operator_receipts` changed. Logged QSOs and every other table remained identical. The WebKit `ItemTable` remained identical too; no manual journal or local-storage edit was used. A read-only check of the original operation returned its completed receipt at revision 2916.

The application remains closed for the corrected candidate. Reopening requires the passive-normal-draft fix in `83a3927f`; 1.3.28 must not be reopened after this recovery. Startup must reconcile the retained journal from the existing receipt, leaving it blank with no pending operation. Both installed mode-switch directions still require acceptance after that corrected installation.

## Installed 1.3.29 retirement diagnosis

The corrected 1.3.29 startup reconciled the exact original Clear receipt: blank revision 2916, no pending operation or power intent. The first Return to Normal Logging passed editor preparation but failed station-worker retirement. Normal and contest database comparisons remained unchanged. A normal protected Quit and one restart of the same signed 1.3.29 restored usable Contesting input and the retained 775 QSOs; no mode retry was performed.

The native error incorrectly called every retirement failure a deadline failure. It also represented nonzero child exit, missing accepted replies, malformed output and an already-retired process. The observed fast failure cannot establish an eight-second timeout. The worker now exposes fixed retirement exit codes for online-log recovery (70), contest radio spot withdrawal (71), or both (72), and native shutdown preserves the distinct timeout, process, reply and stream outcomes. No arbitrary service error, callsign or credential crosses this diagnostic boundary. All original rejection conditions and the eight-second watchdog remain unchanged.

Disposable real-worker process checks cover immediate EOF with accepted requests, full correlated replies and clean exit; a retained fresh contest spot with no available radio produces exit 71, while an expired receipt retires locally with exit zero. Every process uses a separate HOME/CFFIXED_USER_HOME and, on macOS, the bundle-bound Contesting Test profile with external I/O disabled. These checks reproduce the fast spot-retirement failure family but do not prove the cause of the production occurrence, whose exit status was discarded by 1.3.29. Both installed mode directions remain unverified.

Validation: 23 Swift cluster/shutdown-outcome tests, all 79 native worker tests (including seven real child-process shutdown cases), and all eight real Swift worker process tests pass. The worker process suite passes against both debug and release builds. The missing-reply native fixture now decrements its manual writer reservation, so it proves missing-response rejection rather than accidentally timing out while withholding EOF.

## Passive status reads incorrectly held operating-action admission

Installed 1.3.30 passed startup, then its single Return to Normal attempt was
rejected before retirement with “Wait for the current operating action to finish
before changing module.” The same contest context remained usable; the original
Clear stayed settled at blank revision 2916, and logged/core data remained
unchanged. Immediately before the attempt, two contest-owned Radio 1 forwarding
receipts were still under 600 seconds old; a future pass must not be attributed
to this fix merely because those receipts aged out.

The native Contest Setup digital routing stamp was also acquiring mutation
admission for its recurring `wsjtx_snapshot` and `fldigi_snapshot` reads. Analytics,
recorder-change and RTC status reads were omitted from the operating-module
passive list; RTC status was omitted from the worker's passive gate too. That
caused idle background reads to look like active operator work. RTC status is
polled every five seconds and only returns retained reporting state.

The digital Contesting routing stamp remains intact, while those five passive
reads no longer hold mutation admission. RTC status also uses the existing
bounded passive timeout and late-reply routing. No mutation, editor guard,
retirement deadline or unresolved-operation fence is relaxed. All 883 native
tests pass, including paused-read overlap cases that allow the mode transition,
paused real-mutation cases that keep it blocked until release, and RTC timeout
recovery without worker retirement. Installed acceptance of this source fix and
both mode directions still follows in a new uniquely versioned candidate.
