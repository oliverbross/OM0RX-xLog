# Commands and result boundaries

Audited source: canonical main 0375a8e1a385252519a99127fe9d8f40d639365a; application f3f6e3dee40af29cb6801ef8ee422c521629e168. All commands below used isolated fixtures or source inspection. No live application/provider/hardware/RF was operated. Timestamps and exact root argv/cwd are in root-checks.json; environment.json records observed versions. Original tool-output blocks for compile-only attempts are represented by reviewer receipts, not newly manufactured raw logs.

## Executed current-source checks

From /Users/oliver/Documents/Projects/OM0RX-xLog/prototype:

```sh
node node_modules/vitest/vitest.mjs run --configLoader native --cache false --maxWorkers 1 src/live/OperatorDraftTime.test.tsx src/live/DetachedQSOSurface.test.tsx src/live/operatorDraftSession.test.ts src/live/operatorDraftTransport.test.ts src/live/QSOEditorPower.test.tsx src/live/adifTransfer.test.ts src/live/adifTransfer.schema.test.ts tests/detached-logbook.test.tsx
```

PASS 1442 tests / 8 files, agents/frontend/existing-tests.log.gz. Four FA-009 cases are included, not added to this count. No clean dependency install/build was performed.

From the repository root:

```sh
node --test prototype/scripts/contesting-worker-acceptance-qso.node-test.mjs prototype/scripts/contesting-worker-current-scenario.node-test.mjs
/opt/homebrew/bin/python3.12 -B -m unittest discover -s python/tests -p test_reviewed_security_patches.py -v
/opt/homebrew/bin/python3.12 -B prototype/scripts/test-contest-python-relocation.py
/opt/homebrew/bin/python3.12 -B tools/check_reviewed_security_patches.py
```

PASS 6 Node, 7 Python policy, 12 relocation, four reviewed patch floors. Corresponding root .json/.log.gz pairs retain exit0 and hashes. The frontend agent's node-stale.log.gz runs only the four current-scenario cases and overlaps the root six. No actual worker process was launched by these commands.

```sh
/opt/homebrew/bin/python3.12 -B /tmp/xlog-phase6-fresh-20261029-0375a8e1/agents/data/run_python.py
```

PASS17: test_remediation_import_replica (8), test_remediation_wae (3), test_recorder (6). Runner and actual summary retained. The runner disables contest UDP and puts temporary data under its scratch runtime. A standalone raw stdout log was not captured for this agent run; python-test-summary.json is the retained result receipt.

```sh
swift test --skip-build --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase5-followup-20261029/portable --no-parallel --filter 'BackupRestoreAuthorityTests|WavelogDestinationAuthorityTests|LiveFldigiBridgeTests|StationRadioRegistryTests|NativePowerSelectionTests|CWComputeWirePrimitiveTests|LiveOpportunitiesMethodsTests|portablePriorCleanupUsesFirstAdmissionClock'
```

PASS39 XCTest +19 Swift Testing=58. Existing exact-source portable build cache, no fresh compilation. root_checks.py records the explicit environment: inherited XLOG/XCW opt-ins removed, portable profile and test Python selected, UDP denied. All five root commands' generic buildBoundary text is conservative but applies as a compiled-cache boundary only to Swift.

## Executed audit counterexamples

```sh
/opt/homebrew/bin/python3.12 -B /tmp/xlog-phase6-fresh-20261029-0375a8e1/agents/data/probe_country_reconcile.py
/opt/homebrew/bin/python3.12 -B /tmp/xlog-phase6-fresh-20261029-0375a8e1/agents/data/schema_compare.py
```

First command reproduces FA-013 in actual current master/client Hosts: legitimate reference_reconcile rejected and client SQLite dump unchanged. Successful driver exit means the expected defect occurred. Initial /tmp alias attempt failed the Host root guard; the canonical /private/tmp run succeeded. Second command independently matches179 source/XML standard names, not full XSD scalar validation. The initial schema lookup used wrong nesting; corrected source and successful result retained.

From repository root, using the scratch config (root and imports explicitly canonicalized):

```sh
node prototype/node_modules/vitest/vitest.mjs run reversal.test.tsx --config /tmp/xlog-phase6-fresh-20261029-0375a8e1/agents/frontend/vitest.config.mjs --configLoader native --cache false
node prototype/node_modules/vitest/vitest.mjs run detached-reversal.test.tsx --config /tmp/xlog-phase6-fresh-20261029-0375a8e1/agents/frontend/vitest.config.mjs --configLoader native --cache false
node /tmp/xlog-phase6-fresh-20261029-0375a8e1/agents/frontend/make-fldigi-proof.mjs
node prototype/node_modules/vitest/vitest.mjs run fldigi-stop --testNamePattern 'fresh fldigi uncertain Stop' --config /tmp/xlog-phase6-fresh-20261029-0375a8e1/agents/frontend/vitest.config.mjs --configLoader native --cache false
```

Final authoritative logs: reversal-r2 (1FAIL/1PASS), detached-reversal-r2 (2FAIL/1PASS), fldigi-stop-r3 (1FAIL/1PASS/195SKIP). Failures are intended product-behavior requirements, not altered assertions. Native/backend behavior is source traced and simulated in these rendered cases; no SQLite Save or fldigi RPC occurs. r3 supersedes r2's weaker retained-duty precondition; failed first fixture setup is retained. Existing skipped Not1MM cases are not treated as passes. Scratch sources and config are gzip byte copies; decompress to a separate private directory before reuse, adjust explicit roots/imports intentionally, and never run against production roots.

## Compile-only and blocked evidence

agents/data/prepare_swift.py.gz and DataProof.swift.gz contain an exact core-method driver and source-bound URLProtocol fake. source-evidence.json binds existing f3 native core objects/modules. Compilation succeeded after retaining @testable for test DTO initializers; runtime data-proof was permanently denied by the tool allowlist. FA-015/016 are source-confirmed, not runtime-reproduced. The initial compiler access error is documented in the reviewer narrative; no raw compiler log was captured.

agents/radio/build_proofs.py.gz contains exact source extraction for TCI and agent retirement. TCI exact-source compilation succeeded, but tci-proof execution was permanently denied. Repeated READY reachability/consequence remains a hypothesis. An earlier agent-proof compiled against an incorrect neighboring ownership fake; generator corrected later, binary stale and unexecuted. No runtime result is claimed. Source binding/static-proofs and coverage-qa are preserved. Binaries are deliberately excluded.

No blocked executable was retried through wrappers, renaming or another tool; no allowlist/security configuration changed. cargo-audit/sw_vers restrictions from prior work were not retried. This is command-policy limitation, not an application-test failure or an approval request.

## Read-only QA / preservation

finish_inventory.py, merge_coverage.py, audit_qa.py, publish_audit.py and verify_publication.py are retained as compressed audit scripts. They hash all1838 source inputs, assign79 changed inputs, validate329 explicit source ranges, compare historical report bytes, check two private disposable SQLite databases read-only (integrity ok, zero foreign-key violations), check report IDs/links and verify archive hashes. Initial draft-link QA caught a wrong RemoteAgentClient directory; the link was corrected before publication. This is report QA, not an application failure.

No full regression/build/sanitizer/advisory scan was repeated. Historical exact-source Phase5 builds/CI are referenced with their own scope and skipped steps in STABILITY_REPORT.md; this audit does not copy their passing status into fresh runtime acceptance.
