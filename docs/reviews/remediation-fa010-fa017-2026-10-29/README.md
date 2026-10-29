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
