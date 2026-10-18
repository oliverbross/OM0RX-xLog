# Shared unique-call policy integration

The isolated integration combines capability baseline
`65d617fbbc95dadc57d3dea2923660357a6fb3bb` with reviewed shared-rule source
`4d77f946fe5ad0072d4b2474e0b66c15d35fd20f`.

The conflict-free merge preserves the existing partial-draft duplicate
projection. Root compared the merged store with the reviewed shared-rule
source: that existing projection is its only additional store change.
Definition persistence, structured serial reservation checks and shared
unique-callsign multiplier calculation are integrated together.

The new definitions cover CWT, CW Open and ICWC MST as inactive previews using
one shared engine. Review corrected mandatory RST fields to the existing
report-free descriptor and verified rejection of fabricated reports. Existing
10-10 canonical digests remain unchanged. Source comparison covers the three
exact-hash Python scoring functions only; it is not whole-plugin parity.

## Integrated validation

The portable run passed **153 core, 80 store and 31 support tests**, with no
failures. It used `XLOG_PORTABLE_ONLY=1 swift test --jobs 2` and absolute scratch
path `/Users/oliver/.codex/worktrees/xlog-contesting/OM0RX-xLog/.build/arrl-dx-core-integration-portable`,
with filter
`XContestCoreTests|XContestStoreTests|ContestingLaneTests|ContestARRLDXWorkerWireTests|ContestJIDXWorkerWireTests|ContestCallHistoryWorkerTests|ContestSCPWorkerIntegrationTests`.

Retained log: `/tmp/xlog-shared-policy-integration-swift-2026-10-18.log`,
SHA-256 `10af4e70aac2e50ca06ccb1ad1d5b6af64e71f017d25630a3f2fb3c7343b0723`.
Root also verified every frozen source and log hash in the component evidence
manifest before committing it. `git diff --check` passed. Frontend code is
unchanged from `65d617f`, whose 183 tests and production build passed.

## Remaining work

No new catalog entries are activated: 16 previews, 78 pending and zero fully
ported remain the correct counts. Definition-driven exports are being
implemented with new immutable versions; existing definitions retain their
bytes. Event windows, categories, CWT conditional exchange, CWO session
aggregation and duplicate export retention, and MST regional/running-frequency
constraints remain explicit activation gates.

The 14-profile browser rehearsal and history UI repairs continue separately.
Exclusive module ownership and latest main-release integration remain open.
This checkpoint changes no canonical checkout, installed app, normal user
database or radio output. Exact integrated CI and packaged/operator acceptance
must be recorded under their own source commits.
