# Remediation command ledger

Receipts retain the exact argv, working directory, UTC times, exit, source HEAD/diff hash and raw-log SHA. Compressed logs expand to the recorded raw bytes. Focused runs may precede later edits; closing gates must be matched to the final source. No production or physical-radio acceptance is inferred.

| ID | Exit | Seconds | Command |
| --- | ---: | ---: | --- |
| A-FLDIGI-NEGATIVE | 1 | 68.525 | `swift test --jobs 2 --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase7-validation-20261029-b8926639/portable --no-parallel --filter LiveFldigiBridgeTests.testExplicitStop\|LiveFldigiBridgeTests.testStorageFailureCannotBypassStopProfileDenial\|LiveFldigiBridgeTests.testStopStorageFailurePreservesPendingSendFinalRelease` |
| A-FLDIGI-POSITIVE | 0 | 36.106 | `swift test --jobs 2 --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase7-validation-20261029-b8926639/portable --no-parallel --filter LiveFldigiBridgeTests\|WorkerTerminal\|StationRadioRegistryTests` |
| A-FRONTEND-BUILD | 0 | 44.88 | `/opt/homebrew/bin/python3.12 -B /Users/oliver/Documents/Projects/OM0RX-xLog/.build/remediation-followup-20261029-86a971e0/frontend_build.py` |
| A-NATIVE-FLDIGI-SCHEMA | 0 | 27.605 | `cargo test --locked --jobs 2 --bin xlog-prototype contest_surface::tests::` |
| B-D-NEGATIVE-E-NATIVE-R2 | 1 | 45.339 | `swift test --jobs 2 --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase7-validation-20261029-b8926639/portable --no-parallel --filter DirectAgentLifecycleTests\|NativeRestoreInterruptionTests\|OperatorDraftReversalAcceptanceTests` |
| B-D-NEGATIVE-E-NATIVE-R3 | 1 | 61.895 | `swift test --jobs 2 --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase7-validation-20261029-b8926639/portable --no-parallel --filter DirectAgentLifecycleTests\|NativeRestoreInterruptionTests\|OperatorDraftReversalAcceptanceTests` |
| B-NEGATIVE-E-NATIVE-R1 | 1 | 35.007 | `swift test --jobs 2 --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase7-validation-20261029-b8926639/portable --no-parallel --filter DirectAgentLifecycleTests\|OperatorDraftReversalAcceptanceTests` |
| C-HISTORY-BOUNDARIES-R1 | 1 | 4.669 | `/opt/homebrew/bin/python3.12 -B -m unittest discover -s python/tests -p test_remediation_reference_replica.py -v` |
| C-REFERENCE-CLOSING | 0 | 18.92 | `/opt/homebrew/bin/python3.12 -B -m unittest test_remediation_reference_replica test_remediation_import_replica test_cq_ww_ssb_host test_multi_operator_host -v` |
| C-REFERENCE-COMPLETE | 0 | 20.913 | `/opt/homebrew/bin/python3.12 -B -m unittest test_remediation_reference_replica test_remediation_import_replica test_cq_ww_ssb_host test_multi_operator_host -v` |
| C-REFERENCE-NEGATIVE | 1 | 2.424 | `/opt/homebrew/bin/python3.12 -B -m unittest discover -s python/tests -p test_remediation_reference_replica.py -v` |
| C-REFERENCE-POSITIVE-R1 | 0 | 6.293 | `/opt/homebrew/bin/python3.12 -B -m unittest discover -s python/tests -p test_remediation_*replica.py -v` |
| E-FRONTEND-BUILD | 0 | 92.744 | `/opt/homebrew/bin/python3.12 -B /Users/oliver/Documents/Projects/OM0RX-xLog/.build/remediation-followup-20261029-86a971e0/frontend_build.py E` |
| fa014-editors-session-r1 | 0 | 32.042 | `npm run test:vitest -- src/live/OperatorDraftTime.test.tsx src/live/DetachedQSOSurface.test.tsx src/live/QSOEditor.test.tsx src/live/OperatorDesk.test.tsx src/live/OperatorWorkspace.test.tsx src/live/operatorDraftSession.test.ts src/live/operatorDraftTransport.test.ts` |
| fa014-focused-r1 | 0 | 7.852 | `npm run test:vitest -- src/live/OperatorDraftTime.test.tsx src/live/DetachedQSOSurface.test.tsx -t reversed UTC` |
| fa014-negative-r1 | 1 | 5.977 | `npm run test:vitest -- src/live/OperatorDraftTime.test.tsx src/live/DetachedQSOSurface.test.tsx -t reversed UTC` |
| fa014-time-editor-r2 | 0 | 2.784 | `npm run test:vitest -- src/live/OperatorDraftTime.test.tsx` |
| fa014-typecheck-r1 | 2 | 48.59 | `npm exec tsc -- --noEmit` |
| fa014-typecheck-r2 | 0 | 31.463 | `npm exec tsc -- --noEmit` |
| fa017-detached-complete-r1 | 0 | 12.406 | `npm run test:vitest -- src/contesting/DetachedContestSurface.test.tsx` |
| fa017-focused-r1 | 1 | 6.692 | `npm run test:vitest -- src/contesting/Not1MMContestWorkspace.test.tsx src/contesting/DetachedContestDigitalDialog.test.tsx -t fldigi Stop recovery\|fldigi release-only` |
| fa017-focused-r2 | 0 | 6.362 | `npm run test:vitest -- src/contesting/Not1MMContestWorkspace.test.tsx src/contesting/DetachedContestDigitalDialog.test.tsx -t fldigi Stop recovery\|fldigi release-only` |
| fa017-frontend-complete-r1 | 0 | 59.645 | `npm run test:vitest -- src/contesting/Not1MMContestWorkspace.test.tsx src/contesting/DetachedContestDigitalDialog.test.tsx src/contesting/DetachedContestSurface.test.tsx src/contesting/contestSurfaceProtocol.test.ts src/contesting/DetachedContestSetupDialog.test.tsx` |
| fa017-frontend-complete-r2 | 0 | 66.328 | `npm run test:vitest -- src/contesting/Not1MMContestWorkspace.test.tsx src/contesting/DetachedContestDigitalDialog.test.tsx src/contesting/DetachedContestSurface.test.tsx src/contesting/contestSurfaceProtocol.test.ts src/contesting/DetachedContestSetupDialog.test.tsx` |
| fa017-not1mm-complete-r3 | 0 | 51.594 | `npm run test:vitest -- src/contesting/Not1MMContestWorkspace.test.tsx` |
| fa017-owner-r1 | 0 | 5.273 | `npm run test:vitest -- src/contesting/Not1MMContestWorkspace.test.tsx src/contesting/DetachedContestSetupDialog.test.tsx -t fldigi\|Digital\|digital` |
| fa017-pending-final-r1 | 0 | 4.335 | `npm run test:vitest -- src/contesting/Not1MMContestWorkspace.test.tsx -t retains fldigi Stop recovery` |
| fa017-retained-owner-r1 | 0 | 7.694 | `npm run test:vitest -- src/contesting/Not1MMContestWorkspace.test.tsx -t retains fldigi Stop recovery` |
| fa017-typecheck-r1 | 0 | 81.735 | `npm exec tsc -- --noEmit` |
| fa017-typecheck-r2 | 0 | 41.902 | `npm exec tsc -- --noEmit` |
| fa017-typecheck-r3 | 0 | 28.517 | `npm exec tsc -- --noEmit` |
| fa017-typecheck-r4 | 0 | 40.753 | `npm exec tsc -- --noEmit` |
| fa017-typecheck-r5 | 0 | 27.144 | `npm exec tsc -- --noEmit` |
| fa017-ui-r3 | 0 | 7.513 | `npm run test:vitest -- src/contesting/Not1MMContestWorkspace.test.tsx src/contesting/DetachedContestDigitalDialog.test.tsx src/contesting/DetachedContestSurface.test.tsx src/contesting/contestSurfaceProtocol.test.ts -t fldigi` |
