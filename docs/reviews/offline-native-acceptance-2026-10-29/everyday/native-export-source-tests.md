# Native Normal export repair: source tests

Trigger supplied by parent: on 6ed source, actual isolated Export all stalled the app UI and produced no second Downloads file. Same identified main/worker remained live. The retained sample attributed739/739 main-thread frames to WebKitDownloadProxy -> wry download_policy -> sandbox extension -> __mac_syscall. Parent preserved snapshots/sample then stopped the exact app and owned Vite server before source mutation. Earlier successful browser-download bytes remain valid earlier evidence, but do not establish this later invocation.

Scope: existing ADIFExportDocument and frozen begin/read paging unchanged. Native main/logbook invoke logbook_export_file with only filename/content; native command separately admits exact main/logbook callers, simple ASCII1..128-byte .adi/.adx names, nonempty/NUL-free UTF-8 <=32MiB. Existing native chooser, shared dialog lease, atomic temporary-file writer reused. New command returns shared saved/cancelled booleans only after writer returns; no invented path/filename receipt or plugin permissions. Frontend holds existing working guard, awaits acknowledgement, distinguishes cancellation/errors, and retains browser-only Blob route. Shared helper messages are export-neutral; Analytics validator and existing guard tests unchanged. Prior Edit last repair untouched.

Negative regression (before production repair):
- cwd prototype: npx vitest run src/live/LogbookPanel.transfer.test.tsx --maxWorkers=1 -t 'saves native all as adi'
- Exit1. Native dispatch expected once, actual0. Raw: xlog-native-export-ui-before-fix.log.
- This unit negative establishes the previous Blob routing; parent native sample establishes the encountered hang/persistence failure.

Positive regression commands:
- Repository cwd: env CARGO_TARGET_DIR=/Users/oliver/Documents/Projects/OM0RX-xLog/.build/offline-native-acceptance-20261029-6e8bc944/cargo cargo test --manifest-path prototype/src-tauri/Cargo.toml --bin xlog-prototype contest_analytics::tests -- --nocapture
  Exit0;8 passed,919 filtered. Raw: xlog-native-export-rust.log.
  New tests cover exact callers/names/extensions/byte limits including UTF-8 expansion, cancellation, ADI/ADX atomic UTF-8 replacement, wrong extension/missing destination failure with unrelated sentinel unchanged. Existing Analytics/message/print ownership, symlink refusal and single-dialog lease tests all pass unchanged.
- cwd prototype: npx vitest run src/live/LogbookPanel.transfer.test.tsx src/live/LogbookPanel.test.tsx src/live/LogbookPanel.compact.test.tsx src/live/adifTransfer.test.ts src/live/adifTransfer.schema.test.ts src/contesting/ContestAnalyticsWindow.test.tsx --maxWorkers=1
  Initial batch exit1;1398 passed/2 failed because new assertions counted existing Retry logbook button text inside alert. Raw retained: xlog-native-export-ui.log.
  Corrected assertions toContain, and expanded cancellation/failure/unverified receipt coverage across all/filtered/selected. Final batch exit0;1406/1406 across6files. Raw: xlog-native-export-ui-corrected.log.
  Tests cover exact frozen scope and bounded read, native ADI/ADX filename/content dispatch, no Blob or anchor call, pending double click prevention, success only after acknowledgment, allscopes cancellation/error/unverified+retry, original browser fallback/conversion/metadata/limits, and unchanged Analytics.
- cwd prototype: npx tsc --noEmit
  Initial and final exit0; no diagnostics. Raw: xlog-native-export-tsc.log and xlog-native-export-tsc-final.log (empty).
- git diff --check: exit0.

Raw stdout/stderr captured directly into /tmp then copied byte-for-byte here, because lean-ctx rejects project-path redirection.
Four source files final pending parent frontend bundle gate: prototype/src/live/LogbookPanel.tsx; prototype/src/live/LogbookPanel.transfer.test.tsx; prototype/src-tauri/src/contest_analytics.rs; prototype/src-tauri/src/main.rs (registration only). No package/version/install/provider changes. Parent owns commit/push and affected development-host rebuild/native acceptance. Source tests do not prove native chooser/persistence acceptance.
