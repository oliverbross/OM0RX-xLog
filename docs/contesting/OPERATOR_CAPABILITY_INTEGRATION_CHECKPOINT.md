# Shared operator capability integration

The isolated capability integration combines `0e3d85e` (product `52ef5d3`)
with reviewed source `fc973c5000b5ad77fb43450e5625c1e39d74c557`.
The merge was conflict-free and preserves the existing history worker routes,
Windows Boolean handling, immutable definition persistence and main 1.2.20
compatibility baseline.

The worker now supplies a versioned, identity/descriptor-bound capability and
structured readiness for the 14 reviewed CW/SSB profiles. The UI consumes those
states instead of interpreting error-message text. RTTY remains Plain Log.
Root verified all 27 frozen file hashes, reviewed the worker/client/operator
flow and required independent unknown-code rejection tests plus a real-rule
matrix covering all 14 profiles. That matrix covers blank CQ, call-first,
complete exchange, serial policy and duplicate states; it is not a browser
operator rehearsal.

## Integrated validation

- Portable Swift: 147 core, 78 store and 31 selected worker/support tests passed.
- Frontend: 183 contest tests passed, followed by TypeScript checking,
  production build and window-bundle checks.
- `git diff --check` passed.

The Swift command used `XLOG_PORTABLE_ONLY=1 swift test --jobs 2` with the
absolute scratch path `.build/arrl-dx-core-integration-portable` under the
isolated worktree and filter
`XContestCoreTests|XContestStoreTests|ContestingLaneTests|ContestARRLDXWorkerWireTests|ContestJIDXWorkerWireTests|ContestCallHistoryWorkerTests|ContestSCPWorkerIntegrationTests`.
Frontend commands were `npm test -- --run src/contesting` and `npm run build`
inside `prototype/`.

| Retained log | SHA-256 |
| --- | --- |
| `/tmp/xlog-capability-integration-swift-2026-10-18.log` | `8b55034305acfc4207d3e81e7e2111824c683fda045f0a94c20e2602dfb6a25a` |
| `/tmp/xlog-capability-integration-ui-2026-10-18.log` | `28be0fd6a4f77094e174a555ce5c149b83d35605c65d1e34336679666d4c04c6` |
| `/tmp/xlog-capability-integration-build-2026-10-18.log` | `137aa374d19e15e65f715559292db758c6c419cc7a27b6de7fcab43ab8eb14d7` |

## Remaining acceptance

A parameterized browser-to-real-worker rehearsal for all 14 profiles in Run
and Search & Pounce is in development. The prior NAQP rehearsal belongs to
`52ef5d3`; it does not prove these new capability bytes. Exact integrated CI,
exclusive module ownership and packaged/runtime acceptance remain separate
gates. The main task is still building later releases; canonical checkout,
installed app and station outputs were not changed by this integration.

The prior exact source `52ef5d3` now passes all six native portability jobs in
run `39082360758` as well as regular CI `39082360778`. Component `fc973c5`
workflows `39083032181` (native) and `39083032167` (regular) were in progress
when this checkpoint was written. Catalog counts remain 16 previews, 78 pending
and zero fully ported.
