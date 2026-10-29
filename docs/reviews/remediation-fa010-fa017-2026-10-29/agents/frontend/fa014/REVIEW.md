# FA-014 frontend repair

Only production change: Full QSOEditorCore's existing same-ID timestamp-buffer reconciliation now acknowledges a valid buffered timestamp matching either the previous or next shared draft value. Desk already used this rule. When a timestamp edit is reversed before native Replace, effective automatic intent returns and the valid historical Full buffer no longer masks the current UTC display. No caller/session intent is forced to manual, and no timestamp validation, unfinished-input guard, recovery/navigation fence or bundle budget was removed or weakened.

Eight maintained rendered regressions reuse existing fixtures: standalone Full and Desk reversal before blur/clock tick; detached Full and Simple rapid reversal/Save, blur plus clock advance, and Full/Simple remount. The real frontend session preserves automatic provenance and dispatches exactly one Save with no intervening Replace, while its native transport is a bounded fake. Both date and time displayed immediately before Save agree with the fake's native-stamped saved contact; metadata and next automatic blank are retained. Actual native Save/SQLite verification is root-owned and must be reported separately.

## Executed evidence

All commands ran in `/Users/oliver/Documents/Projects/OM0RX-xLog/prototype` through the common runner; copied `checks/*.json` retain exact argv, UTC, exits, source-diff SHA and raw-log SHA. `negative-sources.json` and `negative.diff` capture exact owned inputs before the production fix. `positive-sources.json` captures the final owned files. Other workers' changes can alter the common receipt's whole-tree diff SHA independently.

- Negative `fa014-negative-r1`: `npm run test:vitest -- src/live/OperatorDraftTime.test.tsx src/live/DetachedQSOSurface.test.tsx -t 'reversed UTC'` exits **1**, **3 failed / 5 passed / 70 selector skips**. Failures: Full immediate, Full detached rapid and Full detached blur/clock. Desk/Simple and remount controls passed.
- Positive `fa014-focused-r1`: same command exits **0**, **8 passed / 70 selector skips**. Expectations unchanged.
- `fa014-editors-session-r1`: `npm run test:vitest -- src/live/OperatorDraftTime.test.tsx src/live/DetachedQSOSurface.test.tsx src/live/QSOEditor.test.tsx src/live/OperatorDesk.test.tsx src/live/OperatorWorkspace.test.tsx src/live/operatorDraftSession.test.ts src/live/operatorDraftTransport.test.ts` exits **0**, **199 passed / 7 files**. Includes existing manual time, invalid/unfinished input, recovery and navigation tests.
- Typecheck R1 found a test-only Record missing the explicit required id property when passed to the intent helper. The harness now projects the same existing id; runtime expectations are unchanged. `fa014-typecheck-r2`: `npm exec tsc -- --noEmit` exits **0**.
- `fa014-time-editor-r2`: `npm run test:vitest -- src/live/OperatorDraftTime.test.tsx` exits **0**, **15 passed**, after that test typing correction.
- `git diff --check` exits **0**. Counts overlap.

No complete frontend suite or build was run by this worker at this stage; final coherent-source bundle gates and complete acceptance remain root-owned. No application GUI, production data, live provider, station hardware, RF, package, installation, version change, npm install, Git mutation or dist mutation occurred.

## Native acceptance test authored for root execution

`Tests/XLogPrototypeTests/OperatorDraftReversalAcceptanceTests.swift` adds three maintained cases without application changes: exact-clock SQLite Save after an unsent historical date reversal; actual `LiveLogbookMethods.handle` Save and fresh-service reopen using a historical automatic base; and an actual-handler manual Replace/end-time control. Assertions cover saved time, ADIF, retained OTHER metadata, next automatic blank, durable receipt, exact replay and one contact after reopening. This worker did not compile or execute Swift; root owns that queue and must attach the actual result. These tests reach native handlers and SQLite, not live GUI input.

Read-only process feasibility: `Tests/XLogPrototypeTests/worker-process.test.mjs` already has a bounded `exercise` harness using a real worker, generated private HOME, `--local-ui-acceptance`, JSONL correlation, external-service restrictions and ordinary EOF. It can drive ordinary native Save and replay. The acceptance session creates its own disposable root and intentionally accepts no caller-nominated existing database; allowed wire calls cannot seed an old timestamp while preserving automatic provenance (Replace correctly marks manual). An exact historical-base process case therefore needs a separately reviewed disposable seed, rather than weakening that boundary. No worker process or native GUI was launched during this inspection.
