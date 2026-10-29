# Export helper reuse required by the unchanged startup budget

Supersedes the initial four-file layout in native-export-source-tests.md. Parent's actual first frontend build measured Logbook405524 bytes against405200; failed by324 bytes. Its raw log/input-hash receipt remains in the parent's frontend-native-save-build artifacts. No budget or gate changed.

Necessary narrow dedup: existing contestAnalyticsExport save function is exported as saveTextFile with bounded command union (Analytics default; logbook_export_file explicit). Existing saveAnalyticsFile alias/callers remain. Both routes strictly require saved:true/cancelled:false for native success or false/true for cancellation; other replies throw. Normal Logbook dynamically loads this established save helper only upon export, removing duplicated native/browser mechanics from startup. Existing Normal browser URL retention stays60000ms; Analytics remains1000ms. Command-specific Rust validators, frozen ADIF conversion/paging, busy guard and atomic native writer are unchanged.

After helper extraction, before explicit timer preservation:
- cwd prototype: npx vitest run src/live/LogbookPanel.transfer.test.tsx src/live/LogbookPanel.test.tsx src/live/LogbookPanel.compact.test.tsx src/contesting/ContestAnalyticsWindow.test.tsx --maxWorkers=1
- Exit0. Raw: xlog-native-export-shared-helper-ui.log.
- npx tsc --noEmit exit0. Raw: xlog-native-export-shared-helper-tsc.log.

Final helper/timer source verification:
- Same four-suite command: exit0;92/92 across4files (Normal transfer43, Logbook28, compact4, unchanged Analytics17).
- New test specifically checks browser Normal download gets60000ms URL retention and no native invocation.
- Raw: xlog-native-export-shared-helper-final-ui.log.
- cwd prototype: npx tsc --noEmit: exit0, no diagnostics. Raw: xlog-native-export-shared-helper-final-tsc.log (empty).
- Repository cwd git diff --check: exit0.

Rust source unchanged from8/8 passing shared-owner tests; codec sources unchanged from prior full six-suite1406/1406 pass (includes1315 codec/schema tests). Initial test assertion and original route failures remain in earlier raw logs/evidence note.

Second parent actual build also failed:405356>405200 (156 bytes over), retained in frontend-native-save-final-build. Necessary final presentation dedup adds saveLogbookFile(content,format) to the same lazy helper: filename/date template, MIME and fixed command move there; original orchestration and every guard stay in Logbook. No budget change. This removes241 source bytes from the startup module; actual emitted size remains a parent build result.

Latest verification after presentation wrapper:
- cwd prototype: npx vitest run src/live/LogbookPanel.transfer.test.tsx src/contesting/ContestAnalyticsWindow.test.tsx --maxWorkers=1
- Exit0;60/60 (Normal transfer43, Analytics17). Raw: xlog-native-export-presentation-wrapper-ui.log.
- npx tsc --noEmit exit0; raw xlog-native-export-presentation-wrapper-tsc.log (empty).
- git diff --check exit0. All five files frozen again pending parent actual build/native acceptance.

Final five files frozen: prototype/src-tauri/src/contest_analytics.rs; prototype/src-tauri/src/main.rs (command registration only); prototype/src/contesting/contestAnalyticsExport.ts; prototype/src/live/LogbookPanel.tsx; prototype/src/live/LogbookPanel.transfer.test.tsx. Prior Edit last repair preserved. Parent owns final actual frontend gate, commit/push, one affected-host rebuild and isolated native acceptance. No new source edits/builds/GUI/install by this subagent after freeze.
