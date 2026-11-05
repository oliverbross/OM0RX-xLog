# Bounded preview/export owner release

The [companion JSON](preview-export-lifetime-correction.json) retains all samples, units, source/binary hashes, observer history and preserved failure boundaries.

The same development worker retained 506.931 MiB of current heap allocations with the generated 100k import-preview and frozen ADIF owners, then 1.113 MiB after explicit retirement and 1.106 MiB after automatic expiry **before another transfer RPC**. The QSO/index/ADIF rows present in the live heap were absent in both later parsed heaps. All three heap observations succeeded. This supports the bounded owner-release correction; it is not a whole-app memory budget or a complete ARC retaining-path graph.

Source `16c1b6f8a6959c6eea5940605a754e1122dbd997` includes session API fix `e42d26d6adf8391a2c2a67584ec1a8b186e96a96`. The debug worker SHA256 is `d8aa0ac2b007e93d7342c3bd35a9a7fb7b2b5ba017428b42787622996d92632f`; build receipt SHA256 `ec6425bc2f3f331fc7f85bd4d5d14fc6279771d8a011b15630d3391839c7ac39`. Apple Swift 6.4.2 targeted arm64 macOS 27.2, build 26B123. No new signed candidate, version bump, installation or public release was made.

Two full setups used the existing generated 100,000-QSO fixture, with a 76-byte incoming ADIF record per chunk, two preview chunks, a full 100k frozen export, one bounded 25-record read and one selected-record replacement. No durable import/update was issued against that fixture. A separate two-QSO synthetic station-populated fixture covered successful POTA bytes. No twenty-cycle, health-retention, SQL, idle or profiler campaign was repeated.

The existing service lock serializes payload use with matching-token/generation retirement and deadline cleanup. Retiring an ADIF parent atomically releases its derived POTA child. Stale/duplicate retirement returns false; queued old deadlines cannot clear a newer owner. One weak-service deadline source releases expired owners without another RPC and does not keep the service alive. Seven focused XCTest cases include actual automatic nil with no RPC, derived POTA expiry, a fake old deadline after replacement, and an in-flight frozen read racing retirement/new begin. Related validation passed another 15 XCTest and 19 Swift Testing tests. Frontend ownership/component tests are separate evidence; actual native Close/Cancel qualification remains pending a future signed candidate.

| Generated 100k phase | UTC | RSS MiB | Physical footprint MiB |
|---|---|---:|---:|
| After health, before log query | 22:07:08.523 | 16.56 | 4.08 |
| Full preview + export live | 22:07:25.716 | 584.73 | 622.70 |
| Selected-record replacement | 22:07:33.616 | 459.44 | 464.28 |
| Immediately after explicit retire | 22:07:35.121 | 518.56 | 287.44 |
| Next pre-heap sample | 22:07:36.256 | 294.69 | 9.34 |
| Second full setup | 22:08:01.570 | 545.36 | 623.78 |
| Automatic expiry, before RPC | 22:13:11.583 | 15.20 | 44.34 |

The replacement sample was durably saved before subsequent assertions, filling the formerly missing measurement cell for this new run. All 18 process-memory samples, including before/after observer samples and the separate tiny-POTA scope, are in JSON. Each follows a one-second settle and verifies the exact owned process/start identity. RSS was never summed with another process or treated as footprint. The substantial difference between immediate and next settled samples is preserved, rather than choosing a single favorable number.

| Generated-only heap observer | Execution UTC | Current blocks | Current allocated MiB |
|---|---|---:|---:|
| Full owners live | 22:07:26.879–30.766 | 806,761 | 506.931 |
| After explicit retire | 22:07:36.299–37.605 | 6,745 | 1.113 |
| Automatic expiry, before RPC | 22:13:13.944–18.344 | 6,736 | 1.106 |

The live heap included a 222,347,264-byte UUID-to-QSO dictionary, 89,600,000 bytes of QSO arrays, two 23,117,824-byte semantic-index dictionary groups and a 4,194,304-byte ADIF-record array. These selected owner-associated rows were absent after retirement and automatic expiry. General string dictionaries are shared and cannot all be charged exclusively to these sessions. Every matching heap row was aggregated; Task stacks remained nine allocations/7,360 bytes across two rows in each observation. The actual macOS module is `XLogCore`; additional `XLogPortableCore` zero groups are not evidence of release. Failed or unparsed heap output would be reported as partial with null totals, not as zero allocations or an unqualified pass.

Heap is a separately labelled observer-on phase, which can affect residency and timing. All later samples retain its history in JSON. Current allocated blocks, public resident size and physical footprint measure different things; later footprint of 44.34 MiB alongside a 1.106 MiB heap total is not contradictory and is not called a live-session leak.

The quiet interval started at 22:08:00.502 UTC. There were no transfer RPCs during the 310-second target or the subsequent heap observation: the first post-quiet RPC began after **319.019839 seconds**. The smaller heap and absent selected types were observed first; subsequent ADIF/import/POTA requests rejected with `export_expired`, `preview_expired` and `export_expired`. Matching retirement then returned false for all expired owners. Rejection alone is not used as release evidence. Final elapsed time of 327.403090 seconds includes later RPCs, EOF and integrity work and is not mislabeled as quiet time.

Retiring the generated import indexes took 0.176656 seconds on the wire and 0.213850 seconds including process/hash proof. The immediately following health response took 0.000666/0.039516 seconds. All eight retirement and immediate-health samples were below the observed two-second target; all timings are retained in JSON. The bounded 25-record ADIF read took 0.001313 seconds on the wire/0.039396 with proof. This is separate from cold workspace opening: attempt 02 took 7.569868 seconds on the wire, while this completed attempt took 9.692238/9.751031 seconds. No claim that all startup/preview work meets two seconds is made. Concurrent Windows VM work prevents a controlled CPU or whole-machine performance claim.

The tiny POTA fixture produced two 40,914-byte files, 12 derived records, four bounded reads per file and a final empty chunk. Three reconstructions had identical hashes. Parent replacement cleared its prior POTA child; the corrected expected response was `invalid_params`. Explicit retirement and automatic parent expiry also passed. Successful full-100k POTA export was not requested or claimed in this follow-up.

All five workers returned actual exit code 0 after stdin EOF; scoped stopped-root/PID checks passed and no signals were sent. Generated and tiny fixtures both passed before/after integrity/count/hash checks. Generated ordered stored-QSO SHA256 remained `c890ab242dca96dd196217168a1f05dcc299b1ba6a2e877149abbddeaea59af2`; the two-QSO hash remained `3d870badb528a03647e99b5a20086882679780344986fb1eceaf3e2a32d4a583`. The normalized closed-copy whole-file hashes also matched within each scope, recorded separately in JSON. Application WAL/checkpoint state changed across the worker lifecycle; no claim of physically unchanged application main/WAL files across execution is made. Each readonly backup left its source main/WAL unchanged, and the original generated input main/WAL remained unchanged.

The snapshot checks used normal readonly/query-only SQLite backup with retained WAL honored. Only a new diagnostic intermediate was converted to DELETE journal mode and closed; a no-WAL/header-1/1 gate preceded a final main-only byte copy. Normal readonly integrity/hash checks of that closed final copy were byte-stable with no sidecars. Intermediate orphan SHM files were preserved untouched. Source/application PRAGMAs, environment and filesystem settings were not tuned; no immutable read was used. Python SQLite 3.54.0 is reported separately from the bundled Swift runtime.

Earlier failures remain unchanged: attempt 01 lacked the existing development-only metadata seam and stopped before its initial health reply; its actual child exit code was not retained, so it is not relabeled a clean EOF. Attempt 02 passed offline health/workspace opening and EOF0, then its readonly WAL-header backup integrity query failed before any lifetime measurement. A first destination-only probe remained partial because an orphan SHM persisted; a separately authorized closed-main copy probe then passed the contract used here. No automatic retry occurred. The historical signed-1.5.19 harness still has its original exit1 and unavailable post-replacement memory; this new debug run does not retroactively fill that old sample or provide a like-for-like absolute signed-build comparison.

Private coordinates, traffic and raw observers remain local. No production, GUI binding, network, hardware or export-file publication occurred. Candidate 1.5.21 remains held; daily 1.5.15 and public-release status are unchanged. Native equipment, ordinary desktop idle budget, packaging and notarization are outside this report.
