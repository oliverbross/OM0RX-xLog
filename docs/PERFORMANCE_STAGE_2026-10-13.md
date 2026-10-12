# Performance stage — 13 October 2026

This is backend measurement evidence, not a claim of instant UI or complete
performance acceptance. Alpha.7 includes the award/statistics/history changes
below. The later cluster projection cache is source-only until the next package.

## Changes

- Persist award progress, award catalogue, dashboard stats and DXCC map aggregates
  in the same SQLite database. Each is tied to the QSO revision maintained by
  insert/update/delete triggers, including writes from older/external connections.
- Cache reads match the revision in one query. Publication conditionally matches
  the revision in one atomic statement, preventing an intervening QSO write from
  making an obsolete calculation reusable. In-memory data-version fences remain.
- Corrupt derived JSON is recalculated. Cache writes are best-effort; they cannot
  turn a successful calculation into an empty/error result. Authoritative QSOs,
  synchronization state and credentials are not stored in a separate cache file.
- Catalogue cache keys include SHA-256 of all three bundled award reference files
  plus an explicit calculator version. Bump `catalog-rules-v1` on semantic code
  changes. Bump progress/map/stats version keys when their semantics change.
  Annual stats include the year boundary in their key.
- Replace the callsign/DXCC history OR scan with an indexed candidate UNION.
  Preserve same-call, same-entity and unresolved-DXCC candidates, deduplicate IDs,
  and retain full QSO records and descending date order.

## Measurement

Used SQLite backup from the existing 67,846-contact integrated log into a private
temporary fixture. The live database was opened read-only for the copy; no live
QSO, settings, credential or hardware changes were made. Ran optimized Swift
tests (`-c release`) rather than comparing debug timings with release timings.
Times are individual observations, not median/p95 and not cold physical-disk I/O.

| Operation | First uncached calculation | New connection using persisted cache |
| --- | ---: | ---: |
| Award catalogue | 1,878 ms | 21.6 ms |
| Award progress | 1,793 ms | 0.069 ms |
| Dashboard stats | 797 ms | 0.049 ms |

A subsequent test process reopened the persisted fixture: catalogue 52.3 ms,
progress 0.175 ms, stats 0.050 ms (under the full parallel test suite). Its next
connection took 21.7 ms for the catalogue. Catalogue results compared equal to
the full uncached engine over all contacts. Callsign/DXCC candidate retrieval for
OM0AAO/DXCC 504 took 22.1–22.2 ms. Prior SQL query-plan inspection showed
`SCAN qsos USING INDEX idx_qsos_start`; the new query explicitly uses the callsign
and DXCC partial indexes before the final small result sort.

The cluster contact projection remains about 1.5 seconds and full JSON decode
about 3.4 seconds. First computation after a QSO revision still costs seconds.
Neither issue is hidden by the persisted-cache result.

## Verification

- Native Swift suite: 70 tests passed, including three new cache tests for reuse,
  raw external insert/update/delete/soft-delete invalidation, malformed payloads
  and obsolete keys. No cache row replacement on a normal reopen confirms reuse.
- Optimized Mac portable-worker suite: 136 XCTest tests and 40 Swift Testing cases
  passed, including full-history equivalence, mutation invalidation and the large
  isolated benchmark. TypeScript/Rust are unchanged in this stage.
- `git diff --check` passed.

## Remaining

Packaged cold/warm median/p95, input-to-paint latency, empty-cache first visit,
post-import/sync recalculation, QRZ latency separation, detached-window behavior,
concurrent-writer stress, low-memory behavior and Windows/Linux acceptance remain.
Next delivery must package the source before claiming these gains in the app.

## Cluster projection cache follow-up

The exact eight-field cluster contact projection now uses the existing persisted
aggregate store, fenced by the QSO revision and a `cluster-contacts-v1` schema key.
It preserves raw QSL evidence, submode, fractional dates and JSON-authoritative
values rather than substituting possibly divergent scalar search columns.
External insert/update/delete and soft-delete changes invalidate it through the
existing revision triggers; damaged payloads recompute. Publication still checks
the revision atomically, so a concurrent contact write cannot publish an obsolete
cache as current. No new production index, table or generated column was added.

On the same isolated 67,846-contact database, first projection plus cache write
took 1.628 seconds; a new connection reloaded identical rows in 147.6 ms. Seven
additional fresh connections in the full optimized test run measured a 145.3 ms
median and 155.1 ms nearest-rank p95. This is a small exploratory sample with warm
OS file caches, not physical cold-disk or packaged UI latency. The stored payload
is 7,371,463 bytes. Full QSO decode remained about 3.3 seconds; first post-contact-
change projection still requires a scan and is not an instant-performance claim.

The new core regression checks persisted reuse without rewriting, fractional
dates, raw confirmations, divergent scalar columns, raw external edits,
soft-delete/restore, malformed cache and hard-delete invalidation. Full native
core: 73 tests passed. Mac portable-worker: 138 XCTest cases plus 40 Swift Testing
cases passed, including exact equality with full decode and all seven reloads.

An expression-index and generated-column experiment on the temporary fixture
still read full JSON blobs in the actual macOS SQLite query plan. Those temporary
objects were removed; neither experiment reached source or the live database.
SQLite's [query-plan documentation](https://sqlite.org/eqp.html) and
[expression-index rules](https://www.sqlite.org/expridx.html) informed that check;
the observed bytecode, not the index name, determined rejection.

Installed alpha.7 remains unchanged by this follow-up. Further work includes
first post-mutation scans, repeated classifier construction, exact worker/paint
timings and all broader performance gates above.
