# Installed 1.5.15: current memory ownership on 6 November 2026

The retained read-only observation identifies the current daily application's host, worker and three associated WebKit processes. Their tool-provided, shared-accounted aggregate was **3,635,569,088 bytes / 3467.149 MiB / 3.386 GiB** at 18:11:46 UTC. The worker reported **3,062,303,984 bytes / 2920.441 MiB / 2.852 GiB**, making it the dominant measured owner.

This advances attribution of the current running instance. The historical approximately 7 GB **htop MEM** report remains unresolved: its exact process/group, timestamp, units and workload were not recovered. The observation is of installed daily **1.5.15**, which predates the retained worker-retention repair and held quality candidates. It is not a measurement of 1.5.24, an explanation for every historical byte, or a release memory-budget pass.

The [numeric report](memory-current-instance-2026-11-06.json), SHA-256 **a5a0f2d5c44dafaa28ec2b09a3ac4e449af32b72582d737d46f1205075da2b24**, contains exact counters, timestamps, artifact pins and raw-receipt/reference hashes. Process identifiers, private paths, raw association text and native birth coordinates remain in the retained private receipts.

## Artifact and ownership proof

The installed host and worker hashes recorded in the retained pair receipt match the daily 1.5.15 artifact, whose source association is recorded in the [signed desktop evidence](desktop-idle-1.5.18.md):

| Component | SHA-256 |
| --- | --- |
| Host | 388114efe485ea83fc56256af0774d6ee6b4f4bd9561798ba215fdd025399ef2 |
| Worker | 0b4121e278d42546f793a7947af3ce3cf0b99b0cfc423f66ef1b3fb664202d6c |

Associated source: **1873dc1d1c4d1aa95b44d07f7af0482417680f5f**. This review did not read or change the production database, recount live QSOs or voice files, or control the installed application.

The nonprivileged launchctl PID-domain inspection names the installed xLog bundle as the host's originator and the host as its creator. It lists the three live WebKit GPU, WebContent and Networking instances. The host, its child worker and those three instances have the same xLog resource coalition, jetsam coalition and bundle identity before and after the sample. Native PID, executable path, parent, UID and microsecond birth identities also remain unchanged. Attribution therefore uses the host's live-instance listing, originator/creator and native identities together with coalition membership; coalition membership or a process name alone would be insufficient.

WebKit's recorded parent is launchd, so it would be omitted by a host-descendant-only inventory. The initial literal path check stopped before measurement because native WebKit paths included Cryptex prefixes. A separate retained same-file check established the native and logical path aliases, and the successful sample retained both spellings. The earlier stopped attempt remains recorded; it supplies no memory result.

This measured set is the verified host/worker and the three live WebKit instances associated with that host domain. It does not assert exhaustive device, kernel, shared-service or system-wide accounting.

## Five-process counters

The footprint command ran from **2026-11-06T18:11:46.475413+00:00** to **2026-11-06T18:11:46.639177+00:00**. Its raw result has explicit byte units and no errors or warnings. The local footprint manual states that its multiple-process mode de-duplicates multiply mapped objects; the **tool's aggregate** is used here. Per-process rows are displayed for ownership analysis and must not be added to produce a replacement total.

| Owner | Reported footprint, bytes | Reported footprint, MiB | Ledger lifetime peak, MiB | RSS before / after, MiB |
| --- | ---: | ---: | ---: | ---: |
| UI host | 59,049,184 | 56.314 | 72.642 | 33.828 / 33.781 |
| Swift worker | 3,062,303,984 | 2920.441 | 3475.050 | 34.109 / 34.016 |
| WebKit GPU | 33,948,824 | 32.376 | 89.814 | 13.266 / 13.203 |
| WebKit WebContent | 471,075,216 | 449.252 | 700.971 | 124.359 / 124.078 |
| WebKit Networking | 9,519,560 | 9.079 | 12.375 | 3.094 / 3.016 |

In this five-process sample, each reported footprint equals that process's contemporaneous ledger physical footprint. The ledger peaks describe each process's own lifetime and were not necessarily simultaneous; they are not an application-wide peak.

The tool also reports **3,458,973,696 bytes / 3298.734375 MiB** in the aggregate swapped/compressed field. The retained local manual defines that field as a **subset of dirty memory**. It must not be added again to the aggregate, nor reinterpreted as a measurement of RAM currently resident. No per-process swapped/compressed allocation is inferred.

RSS was separately sampled just before and after the footprint command. Those records use KiB; the table converts each to MiB. Small RSS readings do not contradict much larger footprint counters, because the metrics account for different things. The observed aggregate is not a sum of RSS, lifetime peaks, or host counters from different times.

## Same-scope change in the existing daily pair

The two host/worker-only receipts permit this narrower comparison:

| Observation | Tool aggregate, bytes | MiB |
| --- | ---: | ---: |
| 15:08:09 UTC, host and worker | 1,616,923,984 | 1542.0188751220703 |
| 18:06:41 UTC, host and worker | 3,204,059,624 | 3055.6293716430664 |
| Difference | **1,587,135,640** | **1513.610496520996** |

The difference is calculated from the original integer byte totals. It rounds to **1513.610 MiB** at three decimal places. The earlier and later receipts agree on the retained process identities at the earlier receipt's whole-second birth precision; the later pair and five-process receipts additionally agree on native microsecond birth identities.

This is **uncontrolled observed growth** of the daily host/worker pair. User activity, operation mix, background work and memory pressure between the samples were not measured. No growth rate, monotonic curve, new retaining mechanism or causal improvement is established. The earlier two-process number must not be compared with the later five-process aggregate as if their scope were the same.

## Relationship to the repairs already verified

The [signed 1.5.18 completed-request checks](memory-signed-1.5.18.md) and [signed 1.5.19 sanity](memory-signed-1.5.19.md) remain the bounded evidence for the worker task-lifetime repair. Their isolated workers complete 20,000 measured health requests after warmup; released 1.5.15 grew approximately 116–120 MiB across the recorded fixture cases, while the repaired candidates remained flat or settled downward. Those request-retention checks do not constitute a normal full-desktop budget or attribute the historic htop reading.

The [development idle comparison](idle-work-native-correlation.md) reduced React commits from **809 to 646**, but host CPU went from **1.439770137% to 1.501382175% of one core**. It did not demonstrate a CPU benefit. The earlier [30-minute desktop observations](desktop-idle-1.5.18.md) lacked complete helper attribution and verified continuous foreground state. The current daily ownership proof does not retroactively supply missing ownership or focus evidence for those different process instances.

No additional profiling, live-data inspection, heap capture, thread sampling, app control or background monitoring was performed to produce this review.

## One next gate: a fully attributed packaged desktop interval

**Status: proposed and not run.** Use one exact retained signed Mac candidate containing the quality repairs, selected and pinned before execution, with the existing guarded native route. The Windows-only 1.5.24 artifact is not a Mac candidate. Feasibility, source/artifact identity and the existing route must be checked before launch. The installed daily app and UTM remain running and untouched.

Run a single candidate at a time in its explicit disposable offline root, using an already retained representative fixture. Revalidate that fixture's actual live/physical counts, full stored-QSO hash and settings before the run; the historical representative qualification had 69,695 live / 69,696 physical rows, which is not a recount of the current production log. Preserve WAL consistency and use supported setup operations. Verify the fixture enum, exact host and worker executables, native birth identities, complete private-root arguments, unique WebKit identity and disabled external station I/O before any UI observation. An exited or unidentified launch stops the sequence.

After ordinary Operator Desk readiness, record startup/ready and 5-, 15- and 30-minute samples; include a 20-minute counter boundary for an exact final ten-minute CPU interval. Attribute each WebKit/helper instance at the sample boundary using the current runtime's host association and native identity, rather than assuming it belongs to xLog. Retain actual interval timestamps, per-owner counters, de-duplicated attributable footprint, separate RSS and swapped/compressed fields, owner counts, and observed focus/visibility/minimization. Record the running VM and other ambient loads and keep them stable where possible; this is not a disk-cold test. Run without a profiler or debug renderer. Any extra instrumentation must be labelled with its overhead and scope.

Apply the existing [quality plan](../../planning/QUALITY_PHASE_2026-11-05.md) without silently changing its goals: approximately 70k-contact normal Desk with optional services off should aim below **1 GiB** attributable steady memory, and idle/no-radio CPU below **1% of one core** averaged over ten minutes. Those goals remain provisional until calibrated on the named environment. Missing owner attribution or unverified sustained visibility produces an incomplete budget record, not a pass. Preserve the existing two-second responsiveness and signed-worker limits.

End with ordinary Quit, process-only absence checks for the verified host/worker and attributed helpers, then a WAL-aware closed-fixture comparison of integrity, exact stored QSO rows and settings. Record any guard or leftover owner instead of forcing closure. A measured excess or repeatable post-warm growth should select the next specific operation/lifetime investigation. The already passing 20,000-health-request ladder need not be repeated merely to replace this missing desktop evidence.

## Retained evidence

These are private receipt basenames; the numeric export contains their byte sizes and complete hashes together with the relevant tracked reference hashes.

| Receipt | SHA-256 |
| --- | --- |
| attributed-five-process-receipt.json | 57d431c875f0d227a8641de05f1df65c8b77ca53b64bdb78623c691b4087c038 |
| attributed-five-process-footprint.json | 9b1e259d62c407f988101813d4de76f7e1da0606e9002b7700933309e65d3667 |
| attributed-five-process-summary.json | 4e08781c5fc47cff42647fe52fd828b7c78107c655bc100566299259b19603ce |
| current-host-worker-footprint-receipt.json | 30ad6311de8dd4c0a6d584c4cfccc6fc7c8b39792631c07bdc98c546d52f4ce4 |
| current-host-worker-footprint.json | 2687438fed70cd9e5c4541ca8e9e0ccb54452325e7d9f1eeac5e751f4d01b1d1 |
| mac-running-host-worker-footprint-receipt.json | 6fcaa35e24047ed356953ca50cde64efbdb7b55a28e05e12d5f9a6e003944448 |
| mac-running-host-worker-footprint.json | f87ea93b915d6eec2dd67a7f14da529b92aba051a1ac95ad8d9430817e6cb7c0 |
| native-path-alias-review.json | 87ced207f48d2f4b72e46ddc8f7b2a9310d8f22dd052d02eee5bc845dc17600d |
| five-process-attempt1-failure.json | 1f450074851f98187936481d6674aa57eb6b1a7bac1cce4f4889606464b549d1 |
| footprint-man-excerpt.json | 8b30761eaeec02294dd115679b630bbfe94b7ad3f1898a32109140d67f9fb827 |

**Disposition:** current-instance ownership is materially better established; original htop attribution, full-desktop budget and demonstrated idle CPU improvement remain open. No daily application replacement or public release follows from this review.
