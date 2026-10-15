# Native large log performance

## Five-run post-alpha.29 packaged distribution — 15 October 2026

Exact source `cb5d450` adds launch/readiness and painted route measurements to
the isolated native large-log gate. Five independent ad-hoc packaged runs pass
**39/39** with 100,002 contacts and `station_io: false`. Median / nearest-rank
p95: UI mount **472 / 533 ms**, operator workspace ready **721 / 847 ms**,
Logbook display **229 / 244 ms**, first Awards **1,151 / 1,522 ms**, repeat
Awards **66 / 91 ms**, first local history **282 / 366 ms**, repeat local history
**276 / 383 ms**, and rendered callsign intelligence **33 / 33 ms**. Across 25
samples per screen, navigation p95 ranged from **67 ms** (Settings) to **132 ms**
(Logbook). See the
[full packaged performance record](PACKAGED_PERFORMANCE_ACCEPTANCE_2026-10-15.md).

This closes the isolated packaged percentile gap, not the operator-workspace,
live-service contention, physical cold-disk, low-memory, multi-display or
cross-platform gates.

## Installed alpha.29 functional rerun — 15 October 2026

The signed, notarized installed alpha.29 bundle at exact packaged source
`db7ed4734826ea90cfd69b345c4d6174778894e5` passed **38/38** isolated native
checks with `station_io: false`. The generated workspace contained 100,000 ADIF
fixture records plus two contacts saved through the rendered UI; total readback
was 100,002. The report is
`dist/alpha29-db7ed47-installed-large-log.json`.

| Operation | Installed alpha.29 observation |
| --- | ---: |
| Import 100,000 generated contacts | 153,744 ms |
| First Logbook display | 218 ms |
| First / repeat Awards open | 738 / 117 ms |
| First / repeat local history | 233 / 232 ms |
| Rendered callsign history | 29 ms |

The production workspace was not used by the fixture and remained 68,024 active
contacts, zero dirty/outbox/conflict rows, revision 68,239 and SQLite quick-check
`ok`. This is packaged large-file functional acceptance only. It is a single run,
was not controlled against background workload and does not close cold/warm
median/p95, sync-contention, cross-machine or Windows/Linux performance gates.

The macOS native UI completed a generated 100,000-contact workflow with all 21
functional checks passing. The latest aggregate-index build reduced first
logbook display to 80 ms. First Awards open remains above the operator's
near-instant target at 698 ms; these results do not close overall performance
acceptance.

## Indexed import baseline

Source: `c49d456431e3aff1e99bafba71da22be6275bb7e`.
The release executable embeds the shared UI and launches the real Swift worker.
It is a local test build, not the signed installed alpha.7 package.

| Operation | Observed time |
| --- | ---: |
| Import 100,000 generated contacts through bounded ADIF requests | 49,291 ms |
| First logbook display after the fixture mutation | 1,938 ms |
| First Awards open | 965 ms |
| Repeat Awards open | 19 ms |
| First local history request, 12,500 entity contacts | 392 ms |
| Repeat identical local history request | 360 ms |
| Rendered callsign history, 50 matching contacts | 26 ms |

This is one run on the development Mac, not a percentile or a cross-machine
benchmark. First-open timing starts before navigation and ends when the named
rendered content is present. Root workspace refreshes may already be calculating
totals before the Awards navigation; it is not an isolated cold-query benchmark.
The rendered callsign measurement has no QRZ/network lookup and must not be
presented as live online lookup latency.

The fixture contains 100,000 generated ADIF records plus two QSOs saved through
the rendered desk. It spans eight entities, three band/mode combinations and
2,000 callsigns. The test validates the exact total of 100,002, 50 prior contacts
for DL1T0 and 12,500 contacts for DXCC 230. It also verifies detached band-map
projection, keyboard flows, settings readback and final WebGL land pixels.

The earlier unindexed working build exceeded the 300-second watchdog while
still constructing the fixture. Its semantic duplicate query used `SCAN qsos`.
The new case-insensitive all-record index avoids that scan without changing
duplicate, deleted-record or one-second matching rules. This is not a claim of
a precise speedup ratio because the earlier import never completed.

## Evidence and isolation

- [Successful native report](evidence/native-ui-c49d456/mac-large.json).
- [Unindexed timeout report](evidence/native-ui-c49d456/mac-unindexed-timeout.json).
- Main executable SHA-256:
  `97a24684387f80f36c3be215e097d1be041da0e85ea3a75284dc99276879ff3c`.
- Worker SHA-256:
  `a2ba1d71ba82dcb8bfca640db4e715821e812bfa408ce0b09d2b1b78782132e0`.

The acceptance CLI flag creates a disposable workspace and private browser
storage. External services, credentials and hardware requests are denied by
both the native boundary and worker. No operator records supplied the fixture.
After the run exited successfully, installed Integration was reopened and
showed 67,846 contacts, OM0RX / JN88TQ, an empty callsign draft, radio offline
and ShackCQ connected. The original native xLog app was unchanged.

## History and rendering follow-up

Country history still decoded full editable QSO records for a small set of
displayed fields, and the logbook constructed a date formatter for each row on
every render. The follow-up limits history decoding to its required fields and
reuses the same UTC formatter. Equivalence and formatting tests cover these
changes. The comparison build at source
`51307464d229afbbdd43c6268e0243d477a542f9` also passed all 21 native checks and
exited successfully. It reported:

| Operation | Comparison time |
| --- | ---: |
| Import 100,000 generated contacts | 54,280 ms |
| First logbook display | 1,800 ms |
| First Awards open | 845 ms |
| Repeat Awards open | 18 ms |
| First local entity-history request | 260 ms |
| Repeat local entity-history request | 252 ms |
| Rendered callsign history | 18 ms |

The history result improved in this pair of runs. First logbook/Awards results
remain too slow for the target, and their smaller differences must not be
attributed to date formatting alone. Frontend tests ran concurrently during
part of the comparison's import, so the import times are not a controlled
comparison. No first-open database-total optimization is claimed here.

- [Comparison native report](evidence/native-ui-5130746/mac-large.json).
- Main executable SHA-256:
  `a0dd37af64c3f2ff3b6932355e159d8bdd6ec24916689d3c744f676655bd755c`.
- Worker SHA-256:
  `02c140638c733ddde0d65a28d68dbb828105ece002e39677d97dc295f3b09be4`.

Verification after the follow-up: 349 frontend tests, 139 worker XCTest cases
and 49 Swift Testing cases passed. Native release frontend and worker builds
passed. The Impeccable optimization pass preserved layout and UTC output;
full multi-resolution visual acceptance remains separate.

First-open Awards latency, cold startup, concurrent live-service load,
high-DPI layouts and Windows/Linux large-log measurements remain open.

## Cold aggregate query follow-up

An opt-in release-mode test constructs a separate generated 100,000-contact
database to distinguish SQLite/calculator time from UI scheduling. The baseline
at `5130746` plus the benchmark took 569 ms for stats, 1,262 ms for progress,
352 ms for map statuses and 616 ms for the award catalogue. The query plan and
native root refresh order explain why navigation could wait behind this work.

A derived, live-record covering index now retains the exact JSON field values
used by stats/progress/map queries. The calculators' rules and SQL expressions
remain unchanged. SQLite maintains the index for local, sync and external SQL
writes; existing mutation/equivalence tests pass. Award catalogue decoding now
loads only the fields its calculators require, including extension fields.

The comparison run reported stats 18 ms, progress 109 ms, map 17 ms and catalogue
518 ms; history was 208 ms and a 20-row list plus count was 2 ms. Constructing
the fixture took 28,145 ms versus 23,276 ms in the baseline. These are individual
runs, not percentiles or proof of whole-app speed. Maintaining the extra index
adds write cost, while eliminating repeated parsing for the aggregate queries.

The generated existing-log migration measured 1,374 ms for reopening and index
creation, with 3,850,240 bytes of index pages. It does not rewrite QSO records.
Startup on the operator's database, different machines and different record
distributions still requires measurement. The opt-in test is
`GeneratedPerformanceTests`, enabled by `XLOG_GENERATED_PERF=1` in a release
Swift test run.

### Native aggregate-index result

Implementation source: `76d159aa7962e0d152ebd8a318bbe81aad862f61`.
The final generated benchmark rerun also passed migration/readback assertions:
stats 19 ms, progress 110 ms, map 15 ms, catalogue 453 ms, history 201 ms,
migration 1,349 ms and the same 3,850,240 index bytes. This illustrates normal
run-to-run variation rather than a second claimed optimization.

The corresponding release executable and worker completed all 21 checks with
exit status zero. The generated workspace contained 100,002 contacts and all
70 visible map land probes matched. No concurrent test/build workload ran
during the UI measurement.

| Operation | Aggregate-index time |
| --- | ---: |
| Import 100,000 generated contacts | 54,073 ms |
| First logbook display | 80 ms |
| First Awards open | 698 ms |
| Repeat Awards open | 25 ms |
| First local entity-history request | 213 ms |
| Repeat local entity-history request | 219 ms |
| Rendered callsign history | 17 ms |

This confirms the logbook scheduling improvement in one native run. The Awards
cold path is still not instant and must remain open. QRZ, cluster load, hardware
and the operator's real record distribution are not represented by this fixture.

- Main executable SHA-256:
  `a0dd37af64c3f2ff3b6932355e159d8bdd6ec24916689d3c744f676655bd755c`.
- Worker SHA-256:
  `a7d1e606c66802db19b0a1d7eac9f06177737e2129ff918c3dda158a574d66c3`.
- [Native aggregate-index report](evidence/native-ui-76d159a/mac-large.json).

The main executable is unchanged from `5130746`; only the worker implementation
changed. Installed signed alpha.7 was reopened afterward: 67,846 contacts,
OM0RX / JN88TQ, empty callsign draft, offline radio and ShackCQ connected.
The performance build has not replaced the installed release.
