# HM Control and operating performance — 1.3.68

## Scope

Complete the requested HM Control window integration and the save, logbook,
rapid-selection rotor and Maestro spot performance repairs. The preceding
1.3.67 installation proved native HM/radio/log/provider integration but exposed
additional live contention, so the final performance follow-up advances the
application version again. Existing contacts, station settings and rollback
applications must remain recoverable.

## Changes carried forward

- Window → HM Control opens Billy NZ3C's dashboard as a separately loaded native
  window. Station identity, radio/PTT, cluster and all-log totals come from xLog.
  The globe groups mapped contacts into bounded cells and distinguishes stored
  grid locations from DXCC approximations. Public weather, satellite and space
  weather requests use bounded endpoints; PSKReporter uses its live public feed.
- QSO draft reads/replacement/replay defer unused blank-draft construction.
  Same-workspace contact refresh skips repeated station/preferences/draft setup.
  Saving feedback starts immediately; success waits for the durable receipt.
- Fixed mode regular expressions and retained cluster projections are cached.
  FLEX forwarding retains/retries failed visible reports and replays current
  reports on enable while respecting current connection/configuration fences.
- Superseded rotor targets lose their old permit, receive correlated Stop, and
  cannot resume while the next radio destination is selected. Unknown Stop
  remains fenced until its explicit retry succeeds. Rapid absolute QSY coalesces
  toward the newest destination. This does not equate transport ACK with physical
  cessation. The earlier Scotland entity and foreground-focus repairs remain.

## Measured follow-up

A sample of installed worker PID 43730 showed background SyncEngine identity
indexing, repeated DateFormatter configuration, and repeated settings-path
validation while the first HM projection timed out. The local metadata delay is
Rust/Swift IPC and local work; station WAN latency is a separate radio concern.

- Complete-history sync builds the full ADIF identity fallback index only when
  the documented-order join fails. Both routes retain the same complete rows,
  IDs and ordering checks; cancellation remains checked during fallback.
- Three immutable strict POSIX/Gregorian/UTC DateFormatters are reused behind
  NSLock. Parsing still requires exact round-trip equality; malformed dates,
  UTC/end-date inference and exported timestamps retain their semantics.
- settings_load shares one freshly validated database, generation and settings
  target revision under the existing request lock. The next request validates
  the workspace afresh. Authorization still matches generation, keychain service,
  canonical path, endpoint, station and target revision; there is no TTL cache.
- workspace_map_context is a bounded passive read. Its deadline preserves the
  worker and routes late replies without changing logging generation. HM startup
  retries three times with a delay, one request at a time, then offers manual
  reconnect. Closing the window retires its renderer.

The dedicated private HM benchmark on the installed 1.3.67 worker measured
4.59 seconds for a cold projection, 16–40 ms for cached reads, and 3.65 seconds
for the next projection after one 11.8-ms save. That exposed a full-log rebuild
on the shared logbook lane after each QSO. The final candidate will qualify a
bounded incremental path for known local changes, with full-rebuild fallbacks
for unknown/external/resolver changes and exact comparison against fresh output.

## Upstream and licensing

Ham Mission Control upstream commit:
7203724e7a3374d955430cf3e16dff8458be0212. Original index Git blob:
b9ea44b3e38fa4bb4752b572fd897c51b70c91fa. The original HTML, README and MIT
license, pinned dependencies, local asset digests and third-party notices remain
in the repository and packaged app. See the preceding 1.3.67 review for the
integration inventory and earlier candidate records.

## Validation before packaging

The earlier implementation passed 967 full native tests, 83 exact-source rotor
coordinator tests, 55 portable service tests, 2 HM projection tests, the logging/
rotor/frontend regressions and production bundle checks. Later focused checks
cover native offline metadata, actual worker JSON dispatch and continued offline
station restrictions. These are separate runs, not a claim that duplicate reruns
add coverage. Final 1.3.68 targeted results and installed evidence follow below.

The observed private date benchmark processed 10,000 mixed valid/invalid strict
parses: 41.656 seconds before and 23.171 seconds with reusable formatters, with
identical epoch sums. This run was under host scheduling pressure and does not
establish end-to-end application percentiles. In the preceding signed candidate,
five private durable-save → status → page runs on 69,556 original contacts took
24–31 ms; native success appeared in the first AX observation (about 1.1 seconds
including automation). The final candidate receives its own checks.

## Release provenance and installation

Build only from the clean canonical main checkout, with one compiler job and
reduced scheduling priority. Package using prototype/scripts/package-macos.sh;
DistributionMetadata captures the exact source commit. Every candidate receives
a distinct visible version. Record the final source, hashes, Apple acceptance,
backup, rollback and live-window/data checks here after verification.

## Final targeted checks

- HM read startup: 7 frontend cases passed, including bounded automatic retries.
- Native passive map timeout/late reply: 1 passed; the logging worker and its
  generation remain usable after the deadline.
- Combined sync/settings: 20 XCTest and 29 Swift Testing cases passed, including
  documented-order/fallback identity joins and fresh authorization/root fences.
- Final normal core run: 5 XCTest and 26 Swift Testing cases passed across ADIF
  fidelity and HM projection, including full-projection oracle comparisons,
  repeated edits, confirmations, deletion/restore, external/unknown writes,
  resolver changes, large batches, ABORT and automatic ROLLBACK.
- Measured implementation sources: 9d4e1304 (sync parsing/index), 915617a4
  (settings context), abdb8533 (HM passive recovery), e098f17d (neutral initial
  radio state), 9317768f (incremental HM projection). Each was pushed after
  its proportional checks. Final build/source identity is recorded separately.

## Pre-package private HM performance qualification

A freshly built canonical debug worker from source 9317768f ran only inside a
new worker-only fixture with the existing verified private-root coordinate.
Installed and signed application bundles were unchanged. Worker SHA-256:
67e5c5f0d9a5ad5451684b17d5b458418bddb8215d25626ecff20cd6c297546f.
The exact PID/executable/root arguments were checked before CLI requests, and
the worker completed by clean EOF.

After one new located QSO, HM projection took 32.498 ms (preceding installed
release worker: 3652.655 ms). Save took 17.500 ms; save plus HM took 51.779 ms.
The private log increased exactly once, 69,563 to 69,564, with the saved ID in
recent and added records. Cold debug HM rebuilding took 5.459 seconds and
remains a separate initial/uncertain-change boundary. The different build modes
and scheduling pressure mean these samples are not production percentile or
formal speedup claims.

Version preparation is 1.3.68, advancing installed 1.3.67. The exact clean
versioned commit is captured by the packaging script in DistributionMetadata;
append the independently verified source and installation record below.
