# Reviewed ADIF updates across a fractional-second boundary

The correction is committed and pushed as
[`e7fce13b093ccaa8b9c0a6e343aea3d162987f04`](https://github.com/oliverbross/OM0RX-xLog/commit/e7fce13b093ccaa8b9c0a6e343aea3d162987f04).
It changes the indexed apply-candidate lower bound from the incoming whole
second to the preceding second. The shared `ADIFImportPlan` still decides
exact semantic identity. Stored dates, export/identity formatting, schema,
selected-field validation, reviewed target equality, snapshot/revision
checks (including no-ops), transaction rollback and replay guards are unchanged.

## Defect and historical failure

The original full Mac gate at `f53ab0ed` remains
[failed, run 42293138087](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42293138087/job/128151448660):
Swift Testing reported 628 tests and one issue in the selected-DXCC test,
argument `+291`. Its concrete throw site/type and input timestamp were not
captured. That test calls synchronous `LiveLogbookMethods`; the ADIF paths
were unchanged by the separate paging correction. This record does not
attribute the failure to paging or reconstruct the missing input.

A retained 34-case diagnostic reproduced 14 NAME-only apply failures with
`LogbookContactError.invalid`. Near the end of a second, date formatting can
round a fractional stored timestamp into the following second. Preview used
that formatted identity while apply searched only `[second, second+1)`,
omitting its reviewed target. A new prior-second exact-identity duplicate
could also escape that lookup. All 34 selected `+291` checks still produced
the expected typed rejection; failed NAME applies retained their snapshots
and empty pending state.

The corrected candidate range is `[second-1, second+1)`. `LIMIT 129` and
rejection above 128 candidates remain intact. The cap now conservatively
covers two numeric seconds and can reject very dense adjacent-second groups;
it was not raised or silently truncated.

## Integration and validation

The exact reviewed two-file patch was applied to its unchanged canonical
base, `f53ab0ed27444d9280485489b70c1656713ee625`. Integration verified the
patch hash, both resulting file hashes, all 13 retained diagnostic/test
evidence files, original test byte preservation, whitespace and remote main.
The isolated diagnostic worktree and evidence remain preserved.

Five additive regression methods cover 18 fraction/base combinations,
including UTC year rollover and pre-Unix dates, nonmatching neighbors,
new duplicates after review, stale/no-op revisions, 128/129 candidates and
replay. The retained targeted Mac run passed **21 tests in two suites**
(17 reviewed-transfer and four shared-transfer tests), with actual exit 0
and unchanged source pins. Its exact tested bytes were integrated, so that
completed gate was not repeated solely to produce another receipt.

| Evidence | SHA-256 |
|---|---|
| Reviewed patch | `45258b29d4b3c1eea9994f241dd419ad8f55582d417e87304c4926b7496544ef` |
| `Sources/XLogCore/LogbookDatabase.swift` | `d13f07509936a5d94d6c6c57607cf8969f3c7389346e0113e171d1755c93342c` |
| `Tests/XLogPrototypeTests/ADIFTransferTests.swift` | `197d0d12eb78561205a7f14f4841bef2bd8d061ba5578cb0fc7ec3eee77095d7` |
| Retained targeted run receipt | `0f1e5e1d35968fe08f8a801e7b476b59461ea2a5e30cb389298f095611b43dd5` |
| Retained targeted log | `117cfa426d919df096257e9e9ec1b2bae6234c0106ace598c80740663e038f99` |
| Integration verification receipt | `1eac314b5281f658b65fdad2ebe96b18faa2417ff9965e4c2c8af57122ea588b` |

Fresh corrected-source checks are bound to `e7fce13b`:

| Gate | Run | Result |
|---|---|---|
| Automatic CI | [42304273180](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42304273180) | PASS: 336 XCTest and 402 Swift Testing tests; build/resources passed |
| Full Mac source/build | [42304273362](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42304273362) | Pending |
| Selected native ADIF, macOS/Linux/Windows | [42304281429](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42304281429) | Pending |

The [numeric record](adif-fractional-second-2026-11-07.json) distinguishes
these fresh gates from the original failed run. No signed package, native
desktop interval, hardware or production-data acceptance follows from the
targeted source pass. Daily 1.5.15 and public releases remain unchanged;
the quality phase remains **OPEN**.
