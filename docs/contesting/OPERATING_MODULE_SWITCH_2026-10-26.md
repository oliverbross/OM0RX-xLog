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
