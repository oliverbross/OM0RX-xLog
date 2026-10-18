# Shared engine, history and NAQP integration checkpoint

The integration branch `codex/contest-combined-integration` combines foundation `0741b0a` (shared-definition product `90648fd` / `25a2504`), NAQP product `054cfc55db3d848383559d6d3373eaf948831acb`, and call-history phase 2a `4e0ba36112ecfe03443f375ce226b68cb5d51b86`. The active catalog remains 16 previews; the four declarative 10-10 definitions remain inactive.

Root reviewed the merge: the frontend contesting files match `054cfc5` exactly, native Rust files and the portability workflow match `4e0ba36`, and `RuleEngine.swift` combines the reviewed new field kinds with the default-nil partial-draft duplicate hook. No normal app, installed bundle, station data or radio state was changed.

The first combined portable run passed **143 core and 73 store tests**, but failed one of 51 selected support tests: history's generic shutdown error had changed the existing SCP error code. The repair restores `scp_unavailable`, uses `history_unavailable` for history, and adds a regression asserting both routes leave their cache directories uncreated after shutdown. The affected support rerun passed **52 tests**. Core and store source did not change during this repair.

| Evidence | Result | SHA-256 |
| --- | --- | --- |
| `/tmp/xlog-combined-integration-core-store-worker.log` | Core 143 and store 73 passed; initial support failure retained | `49937e1770f9775bacb60890128b4be7b4691fa160c03cd283fedc92f8a1c9d5` |
| `/tmp/xlog-combined-integration-worker-repair.log` | 52 selected support tests passed, exit 0 | `13e0c0dc83c6b05aeadef0d2e42328be47d8262a7dc83c54ddd09f71e27b7d45` |
| `Sources/XContestCore/RuleEngine.swift` | Reviewed merged source | `562b3f50e5797fb81ed7e251d1c63ebb08c6c33afc6ee097222962f56f29e950` |
| `Sources/XLogPrototypeSupport/Contesting/ContestLane.swift` | Includes shutdown compatibility repair | `8864a2a870bfd2be44e112ba88a8f1779cbb3c81e771e12078971940c3826550` |
| `Tests/XLogPrototypeTests/ContestingLaneTests.swift` | Includes route-specific shutdown regression | `f552e982512e9849b1f6eb2854d5185b653b26b04b360c1f5275e08295fe23ff` |

Both commands ran from this worktree with `XLOG_PORTABLE_ONLY=1 swift test --jobs 2 --scratch-path /Users/oliver/.codex/worktrees/xlog-contesting/OM0RX-xLog/.build/arrl-dx-core-integration-portable`. The initial filter was `XContestCoreTests|XContestStoreTests|ContestCallHistoryServiceTests|ContestCallHistoryWorkerTests|ContestingLaneTests|ContestAssistanceLaneTests|ContestSCPWorkerIntegrationTests|ContestARRLDXWorkerWireTests|ContestJIDXWorkerWireTests`; the repair rerun omitted the unchanged core/store targets.

Separate clean operator evidence at `054cfc5` passed six NAQP sessions, 346 ordinary plus three lifecycle frames, 26 commits, 14 independently parsed exports and 82 simulated outputs. Its checkpoint is `NAQP_OPERATOR_INTEGRATION_CHECKPOINT_054cfc5.md`, committed separately as `1cfcfd0`. It does not prove a new clean operator run on this combined source. The same limitation applies to native source checks inherited from the parent branches: exact combined-source CI is still required.

Definition byte persistence, shared exports, authoring UI, call-history UI/prefill, broader operator capability coverage, packaged native runtime, main-module integration and all remaining contest/feature acceptance gates remain open. No RF/PTT/keying, sponsor submission or all-contest completion is claimed. The pilot's focused-suite count is corrected to nine from its retained log; its 143-test core and 72-test store totals are unchanged.
