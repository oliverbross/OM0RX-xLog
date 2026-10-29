# FA-010–FA-017 implementation evidence

Entry was clean canonical `main` at `86a971e0338a7ce6432607f5648dfc1c23ec2a68`, fetched and checked once with fast-forward-only semantics. The assessed application inputs were `f3f6e3dee40af29cb6801ef8ee422c521629e168`; the earlier `0c572702` candidate is not the implementation baseline. The prior seven reports and failed evidence remain historical records.

This directory accumulates source-bound command receipts and compressed exact logs. [COMMANDS.md](COMMANDS.md) lists completed runs, including failures; [results.json](results.json) and each receipt record actual argv/cwd/UTC/exit, source HEAD and working-diff hash, log size and SHA. A green focused run does not establish acceptance of subsequent edits or a whole subsystem. Counts overlap between repeated/configuration runs.

## Batch A — fldigi Stop and visible recovery

The maintained backend counterexample executed before the production fix: four tests ran and produced 31 failed assertions. A damaged settings directory skipped RX, retained in-memory transmit consent and admitted a later send. The correction revokes consent before awaiting RX, attempts RX independently of settings I/O and publishes storage failure separately from release uncertainty. A pending send retains its final-release obligation. Existing ownership, profile, generation and acquisition gates remain.

After the backend fix, `A-FLDIGI-POSITIVE` passes 28 Swift tests (19 fldigi, six registry and three terminal-shutdown). `A-NATIVE-FLDIGI-SCHEMA` passes 37 Rust schema tests. Frontend evidence covers the actual rendered owner, detached operator, digital setup, setup-receipt ordering and strict projection validators with fake native/RPC boundaries. It includes the promoted uncertain-Stop counterexample, fresh reads, storage/RX errors, pending/final release, and retained-owner recovery after mode/lane changes. Per-run receipts distinguish selectors and their skipped cases from whole-file execution.

`A-FRONTEND-BUILD` passes the unchanged TypeScript, Vite and window graph/budget gates. Logbook remains 405,194 bytes against the unchanged 405,200-byte limit. The original 180 generated files and directory inode are restored. Existing Vite chunk-size and Swift concurrency/unused-binding warnings remain visible; none was suppressed.

The final narrow detached SSB status-visibility change follows that build; its complete 193-test file and TypeScript check pass afterward. The final Not1MM file passes all 200 tests; the other affected frontend files passed in the earlier overlapping 519-test run. Closing final-source build and complete-suite evidence must therefore supersede this intermediate build rather than silently attributing it to later edits. The original frontend negative output predates the receipt runner: it preserves two failures/195 selector skips and tool-reported exit1, without invented UTC/diff metadata.

Limits: fake RX acknowledgement is not measured physical RF state. No external engine/provider, real radio, production state, GUI launch or application package/install is used. A cold failed WSJT-X snapshot still makes its combined setup dialog unavailable; independently retained fldigi state keeps the main/operator recovery path available. Complete final-source build/regression and required disposable native workflows remain closing work. Hardware, provider, distribution, long-soak and conditional Linux dependency qualifications remain outside these focused results.

No existing 1.3.60 artifact is overwritten, relabelled or promoted. Production readiness remains **NO-GO** pending the remaining repairs and release criteria; this archive does not designate a release candidate.

## Batch C — primary-prefix replica compatibility

The original counterexample is maintained in `python/tests/test_remediation_reference_replica.py`. `C-REFERENCE-NEGATIVE` executes five failures on the unchanged host, including actual two-Host `Replica change kind is invalid` with client rollback. The test was untracked during that run: `agents/reference/negative-maintained-test.py.gz` and `negative-source.json` bind its exact bytes in addition to the command receipt.

New reference events persist complete identities; their local audit provenance is retained and only wire publication maps to `correct`. Historical projection reads only audited identities and validated country-only transitions, with explicit recovery diagnostics when proof is unavailable. An intermediate boundary failure exposed a deleted-identity fallback; the closing implementation rejects it. `C-REFERENCE-CLOSING` passes 62 actual Host tests, including ten new reference regressions and existing imports/CQ WW/multi-operator controls. A bounded second-owner source review found no further concrete repair defect; it did not execute tests.

Already-issued legacy page receipts deliberately retain the original wire result. A fresh request ID at the same cursor publishes the same historical event compatibly. Neither event skipping, audit/receipt rewrites, current-row invented history nor automatic rebaselining is introduced. Insufficient historical evidence and already-diverged peers require reviewed recovery. No production replica or network provider is operated.

## Batch E — timestamp display and native Save agreement

Three rendered failures and five passing controls precede the one-line Full buffer reconciliation fix. Eight reversal requirements pass afterward; the broader seven-file editor/session run passes 199 cases. Three native cases (two functions) execute real SQLite and actual `LiveLogbookMethods` Save/receipt/reopen paths, including exact-clock automatic Save, real handler-time automatic Save, genuine manual time and OTHER metadata. The maintained tests explicitly distinguish local unsent reversal from native Replace. They do not represent a live GUI-to-SQLite acceptance.

The current frontend component passes fresh `npm ci`, `npm test` (4,760 Vitest cases/339 files plus Node helpers), unchanged TypeScript/Vite/window graph gates and `npm audit --json` with zero reported npm vulnerabilities. Its 794 inputs remain unchanged throughout; manifest SHA256 is `671469a5390f8c30f7ffd8c1d2af0680022f9b73b59e6137851485eae3f346c1`. Original node_modules inode560040948, dist inode603456013 and 180 generated-file hashes are restored. Fresh output remains in the ignored task stage for source-matched native build checks. The complete frozen Python component passes 568 tests. Concurrent Swift changes are deliberately not attributed to these component gates.

## Batch B — agent retirement and late power capture

The real-client factory/cache seam precedes behavior changes; five maintained cases execute with20 failures against the original behavior. After repair, structured registry/worker results retain failed original clients/duties and admit only exact release recovery. Acquisition overlap remains unconfirmed until a later final release; passive peers issue no release commands. Late power installation attaches recorded state through the synchronized connection source and does not invent/replay telemetry.

All ten final real-client tests pass, including450W observation, both-slot reconnect/new-connection/stale/inactive checks. `BDE-CLOSING-R1` preserves an intermediate two-assertion power failure. A deterministic control demonstrates the fixture's millisecond wire-time eligibility problem against precise arm time. The positive fixture waits for a representable post-arm observation; it does not relax chronology or enlarge deadlines. Three complete two-test precision runs pass; `B-ALL-TEN` executes ten cases against the known compiled binary (`--skip-build`, explicitly not a clean-build check), and `D-RESTORE-CLOSING-R2` recompiles and passes the entire class with related controls. The original run lacked packet timestamps, so later results do not prove that earlier occurrence's exact cause.

All radio/agent traffic is intercepted. Bounded protocol ACKs and in-process recovery do not certify physical RF state, watchdogs, hardware watts or recovery after process exit. No production profile, credential or station state is used.
