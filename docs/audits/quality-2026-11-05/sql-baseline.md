# SQL baseline — generated 100k fixture, 5 November 2026

This is a diagnostic baseline, with no source, database schema, durability or cache tuning change. No production log, settings or station input was read. Raw diagnostics remain local; the generated-data numeric/query receipt is [sql-baseline.json](sql-baseline.json).

## Fixture and provenance

The originally requested retained Nov3 fixture has 100,000 QSOs but no `xlog_qso_read_projection`. Its older schema cannot exercise current statistics/award/history-country SQL. That observation is preserved in `old-schema-observation.json`; an incomplete older-schema campaign recorded a 265.54 ms Python first-page median, then was cancelled during a slow deep-offset query. It is not a current-source performance result.

The primary input is the generated fixture supported-migrated by the released 1.5.15 baseline worker, which exited cleanly. Verified release provenance is source `1873dc1d1c4d1aa95b44d07f7af0482417680f5f`; the integration capture independently matched worker SHA-256 `0b4121e278d42546f793a7947af3ce3cf0b99b0cfc423f66ef1b3fb664202d6c`. The supplied private input was SQLite-backed up, not copied as a live database file, into `released-1.5.15/synthetic-100k-quality-copy.sqlite`. Both QSO and read-projection tables contain 100,000 rows. Every QSO's actual `comment` field contains the generated-private-fixture marker. Database SHA-256: `ddd47952f3f09f6ada01a4dbef4a217230f46996db126f969676332f099c70dd`.

Database size is 196,788,224 bytes, WAL size 0 bytes, page size 4,096 bytes, page count 48,044. SQLite's schema cookie (`PRAGMA schema_version`) is 1; this is not an application migration-version claim. Complete schema/index SQL, source-file hashes, runtime source IDs and compile options are in [sql-baseline.json](sql-baseline.json).

The first immediate Python readonly open following creation of each backup failed with `unable to open database file`. Separate readonly CLI validation and a fresh Python process subsequently succeeded. The cause was not established; this is setup evidence, not an xLog defect. Backup source and measurement connections are read-only; the destination was writable only for SQLite's backup operation. No schema or tuning PRAGMA was issued.

## Method and boundaries

Queries reproduce the owning `LogbookDatabase.swift` SQL for ordinary page/count/search, callsign/country history, cold statistics, cold award progress and all-world award evidence. Predicate construction for the substring search follows `LogbookQuery.swift:55`; no filter narrowing was substituted. Query names are stable and JSON stores only parameter types/string lengths, not callsign or entity bind values.

Python 3.9.6's SQLite runtime reports **3.54.0**. Independently loaded `/usr/lib/libsqlite3.dylib` also reports **3.54.0**, source ID `2026-04-09 12:25:13 8fa8248e303219400c646a885e36dfc52eae33d83f4412e3f369b2be5373aapl`. The shell `sqlite3` CLI separately reported 3.46.0 and supplied only readonly validation, not the timed results. None of these measurements is a signed Swift-worker, IPC, UI or cross-platform timing.

Each Python query records its first execute/fetch separately, then five execute/fetch-all repeats. JSON decoding is measured separately where relevant. Native library timings use a ctypes step loop, with one warm-up then five repeats and no column materialization. Native step timings include Python/ctypes row-iteration overhead. OS disk cache was not evicted; other quality work was active. P95 uses nearest rank over five samples and therefore equals the maximum. These small samples are diagnostic, not latency budgets.

`sqlite3_stmt_status` supplies fullscan steps, sort operations, auto-index rows, VM steps, runs and prepared-statement memory. This runtime exports and enables `SQLITE_ENABLE_STMT_SCANSTATUS`; a separate single counter run additionally captured actual per-loop NLOOP/NVISIT for every query. Exact loop counts are in JSON. OS physical I/O, lock waits, concurrent mutation/WAL growth, Swift allocations, cancellation and view-close/expiry reclamation were not measured. No missing counter was replaced by an estimate of visited rows.

## Results

Times below are milliseconds, shown as median / p95. Payload counts include only returned text/blob bytes, excluding numbers, container/object overhead and decoded representations.

| Query | Rows returned | Text/blob bytes | Python execute/fetch | Native step loop | Python JSON decode |
|---|---:|---:|---:|---:|---:|
| `normal.page.first20` | 20 | 19,191 | 0.018 / 0.046 | 0.042 / 0.044 | 0.228 / 0.345 |
| `normal.page.deep20`, offset 90k | 20 | 19,193 | 3.648 / 4.341 | 2.618 / 6.126 | 0.163 / 0.205 |
| `normal.count.all` | 1 | 0 | 3.994 / 6.718 | 4.050 / 4.762 | — |
| `normal.search.page20` | 20 | 19,201 | 98.751 / 120.777 | 94.746 / 107.061 | 0.226 / 0.844 |
| `normal.search.count` | 1 | 0 | 294.947 / 570.899 | 249.619 / 288.605 | — |
| `history.call.thin` | 50 | 2,483 | 2.181 / 5.012 | 2.029 / 3.297 | — |
| `history.country.thin` | 12,500 | 612,533 | 663.251 / 726.949 | 624.128 / 765.897 | — |
| `history.country.fullQSO` | 12,500 | 11,986,216 | 163.093 / 193.922 | 138.049 / 175.954 | 226.177 / 475.285 |
| `statistics.coldAggregate` | 1 | 0 | 230.943 / 320.662 | 344.978 / 697.754 | — |
| `awards.progress.coldProjection` | 100,000 | 1,866,664 | 550.612 / 576.869 | 402.991 / 459.514 | — |
| `awards.globalEvidence.all` | 100,000 | 31,750,132 | 1,298.283 / 1,331.035 | 1,461.071 / 2,573.961 | 1,104.602 / 1,834.809 |

Plans confirm the intended live-order index for ordinary paging: 20 index entries visited for the first page, 90,020 at offset 90k, and no sort/automatic index. The selected substring search visits 38,001 entries for its first 20 matches and 100,000 for its separate count. Callsign history uses exact/prefix bounded index seeks: 50 and 0 candidates. The country path adds 12,500 indexed entity candidates plus zero unknown-entity candidates, visits the deduplicated 12,500 candidates, and performs 12,500 primary-key joins. It has five sort operations, zero fullscan steps and 1,425,850 VM steps for the thin projection. Its full-QSO alternative has the same candidates/sorts but 638,332 VM steps.

Cold statistics and award progress each visit all 100,000 compact-projection rows; global evidence visits all 100,000 live-order QSO entries. Such global scans are legitimate for global totals. Application memoized/persisted aggregate caches were bypassed by this SQL harness, so these observations do not establish repeated UI scans. In the native diagnostic connection, post-workload cache allocation was 8,753,152 bytes, schema allocation 57,712 bytes, and finalized-statement allocation zero. Those are this connection's SQLite counters, not production-process memory attribution.

## Ranked next evidence

1. **Global evidence materialization/lifetime:** 100k projected JSON arrays return 31.75 MB before decoded-object overhead, with substantial SQL and decode work. Profile the actual signed-worker global-award route's allocation peak, cancellation/close/expiry and retained objects. Preserve worldwide totals and provenance; the all-world population must not be replaced by specialist catalogue candidates.
2. **Country-history projection CPU:** 12.5k thin rows reduce transferred text/blob bytes about 19.6-fold versus full QSO JSON, while this SQL path takes considerably longer and executes more VM steps. Measure the actual Swift end-to-end path, caching and repeat frequency before choosing a representation. Do not switch back to full records based on SQL-only timings or weaken strict date/boolean/NUL handling.
3. **Substring search plus exact count:** the selected count scans 100k records, while a page can stop after its matches. Confirm actual operator query frequency, debounce/cancellation, paired page/count latency and worker responsiveness. Broad substring semantics across arbitrary JSON fields explain this scan; a callsign-only index would change semantics.
4. **Cold aggregate frequency:** stats/progress are global compact scans with bounded SQLite cache use. Confirm existing cache hit/revision behavior in the signed worker before investing. No evidence here justifies a new index, larger cache or durability change.
5. **Deep OFFSET:** it does visit skipped entries, but observed low-single-digit milliseconds is much smaller than the measured heavy paths. Preserve the existing first-page index; a pagination redesign is not supported as the leading priority by this fixture.

Next integration evidence is the actual signed-worker QLog/country benchmark, with its own exact candidate identity. Outside this SQL-only measurement: packaged UI/native journey results, concurrent-save/health responsiveness under these SQL routes, allocations and cleanup, and Windows/Linux runtime equivalence. No application fix or performance acceptance is claimed by this baseline.
