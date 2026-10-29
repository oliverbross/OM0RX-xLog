# Edit last source regression evidence

Parent observed native Edit last not opening its editor while preserving occupied K1KEEP / Rcv315 / sent002 and one K1SAFE QSO. Native export persisted correctly; no export repair.

Root cause: Main Logging submits entry_edit_last successfully, then calls contest_contact_editor_open from contest--active-qso. Rust accepted only contest--logbook. The button did not catch the rejected opening promise, while the owner had already retained the edit (explaining the Quit guard).

Repair permits only contest--logbook and contest--active-qso; retains existing context/session/generation resolution and editor-only close. Button failures use existing entry feedback. No worker/draft/count/serial/export code changed.

Raw outputs were captured directly to /tmp, then copied byte-for-byte here (lean-ctx disallows project-path redirection).

Pre-fix negative commands/results:
1. Repository cwd: env CARGO_TARGET_DIR=/Users/oliver/Documents/Projects/OM0RX-xLog/.build/offline-native-acceptance-20261029-6e8bc944/cargo cargo test --manifest-path prototype/src-tauri/Cargo.toml contest_contact_editor_is_logging_owned_and_self_closing -- --nocapture
   Initial cold compile timed out at 120000ms; no test result claimed. xlog-edit-last-rust-before-fix.log.
2. Same command with --bin xlog-prototype after Cargo.toml:
   Exit101, one test failed exactly: not opened from "contest--active-qso". xlog-edit-last-rust-before-fix-focused.log.
3. Prototype cwd: npx vitest run src/contesting/DetachedContestSurface.test.tsx --maxWorkers=1 -t 'Edit last'
   Initial new fixture run: 2 pass/2 fail (queued receipt fixture omitted message:null; native failure exposed missing visible feedback/unhandled rejection). xlog-edit-last-ui-before-fix.log.
   After correcting queued fixture, before production source repair: 3 pass/1 fail/1 unhandled rejection. Remaining failure reproduced missing visible native-open error. xlog-edit-last-ui-before-fix-corrected.log.

Post-fix positive commands/results:
1. Focused --bin Rust command above: exit0, 1 passed/924 filtered. xlog-edit-last-rust-after-fix.log.
2. Prototype cwd: npx vitest run src/contesting/DetachedContestSurface.test.tsx src/contesting/contestSurfaceNative.test.ts --maxWorkers=1
   Exit0, 211 passed across2 files. xlog-edit-last-ui-after-fix.log.
   New actual button tests: immediate applied/queued-to-applied opens native editor once; occupied callsign/received/sent exchange preserved; no inline substitute; owner rejection forbids opening; native-open failure visibly reported. Only entry_edit_last is submitted, with no commit/reservation action.
3. Prototype cwd: npx vitest run src/contesting/Not1MMContestWorkspace.test.tsx --maxWorkers=1 -t 'pages, edits, and deletes through the detached Log owner actions'
   Exit0, 1 passed/199 skipped. Existing owner test proves newest offset0/limit1 and exact editing identity. xlog-edit-last-owner-after-fix.log.
4. Prototype cwd: npx tsc --noEmit
   Exit0, no diagnostics. xlog-edit-last-tsc.log (empty).
5. Repository cwd: git diff --check
   Exit0.

Final source files: prototype/src-tauri/src/main.rs; prototype/src/contesting/DetachedContestSurface.tsx; prototype/src/contesting/DetachedContestSurface.test.tsx.
No commit, host build, staging, launch, GUI operation, or installation by this subagent. Parent owns commit/push and subsequent isolated native acceptance. Source tests do not establish native acceptance.
