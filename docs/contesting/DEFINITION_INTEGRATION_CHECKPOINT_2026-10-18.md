# Definition persistence integration checkpoint

`codex/contest-definition-integration` combines the accepted 1.2.20 compatibility
checkpoint `30cbbae21891ec6369f36f3745663d97757ed887` with reviewed definition
persistence `363062e08cc6e9358d3bb12ff5b061455a961ff1`.

The merge was conflict-free. Root compared the integrated store against the
reviewed persistence source: the only additional store behavior is the existing
partial-draft duplicate projection from the NAQP integration. Canonical
definition storage, immutable version binding, exact schema validation and v2
backup compatibility match the reviewed implementation.

The integrated portable run passed **143 core, 78 store and 53 support tests**.
It used `XLOG_PORTABLE_ONLY=1 swift test --jobs 2 --scratch-path /Users/oliver/.codex/worktrees/xlog-contesting/OM0RX-xLog/.build/arrl-dx-core-integration-portable --filter 'XContestCoreTests|XContestStoreTests|ContestCallHistoryServiceTests|ContestCallHistoryWorkerTests|ContestingLaneTests|ContestAssistanceLaneTests|ContestSCPWorkerIntegrationTests|ContestARRLDXWorkerWireTests|ContestJIDXWorkerWireTests'`.

| Evidence | SHA-256 |
| --- | --- |
| `/tmp/xlog-definition-integration-core-store-worker.log` | `4a04c4cbeca1d1db06b3e9047c11148663c775691832b09ec155b5e13fa2e782` |
| `Sources/XContestStore/SQLiteContestStore.swift` | `c20e3bf5c39d166efcacc620fd39563b6395ceb48bf63837675aa043411fe8f2` |

Frontend source is unchanged from `30cbbae`, whose 250 frontend tests and
production build passed. This checkpoint does not inherit fresh operator or
native-platform runtime acceptance from its parents. Exact-source CI and a new
bounded browser-to-worker rehearsal were required at integration. The later
exact-source rehearsal passed and is recorded in
`NAQP_DEFINITION_INTEGRATION_OPERATOR_CHECKPOINT_52ef5d3.md`; regular CI
`39082360778` passed, while native CI `39082360758` still awaited its Windows
Swift result at this update. The active catalog remains
16 previews, 78 pending and zero fully ported. Custom definition authoring UI,
shared exports, activation and exclusive module ownership remain open.

The main task continues its 1.2.21–1.2.23 work. Canonical source, the installed app,
normal databases and radio state remain untouched here; final integration must
reconcile the latest accepted main handoff.
