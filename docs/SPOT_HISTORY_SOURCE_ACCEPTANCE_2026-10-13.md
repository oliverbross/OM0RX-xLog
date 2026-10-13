# Spot History first slice — source acceptance

Status: first-slice source implementation and local regression/visual verification passed. Not installed; the running Integration app is not recording this archive yet. New exact-SHA cross-platform CI remains pending.

## Scope

- Separate `spot-history.sqlite` next to the integration cluster configuration, never in the QSO database or Wavelog outbox.
- Immutable accepted reports captured before live grouping/filtering/eviction; original decoded source line, decimal frequency, complete parsed comment, arrival/report UTC provenance, source identity and capture classification.
- Bounded asynchronous ingestion, persistent recording-health evidence, explicit gap/unavailable states, restart persistence.
- Read-only Spot History workspace/native View destination; callsign/spotter, UTC range, band/mode/source filters; snapshot pagination and full-scope statistics.
- Existing `cluster_history` remains Previous QSOs. The new page cannot tune, transmit, move a rotor, log contacts or initiate cluster connections.

The first slice does not claim lossless disk-failure buffering, backfill while disconnected, import of the reference archive, export/retention UI, reported-time-axis/geographic filters, or a detached history window. The complete backlog is in [the implementation contract](SPOT_HISTORY_IMPLEMENTATION_PLAN_2026-10-13.md).

## Local source evidence

- Capture: six new synthetic tests and 42 existing cluster regressions passed.
- Database: nine correctness tests passed (the performance benchmark is separately opt-in), including temporary-database persistence, repeated reports versus idempotent retries, stable cursor/watermark, literal prefix escaping, full-scope counts, future/corrupt/foreign-file refusal, safe paths, schema migration and durable health evidence after operational-detail trimming.
- Worker: seven focused tests passed, including bounded response sizes, retained full detail, pressure/error handling, invalid-record isolation, shutdown fencing and read authority without starting cluster transports.
- Navigation: seven frontend navigation tests passed. Rust suite: 154 tests passed, including main-only history read authority and denial of undeclared mutations.
- Final rebuilt portable Swift run passed: 123 prototype XCTest cases (two skipped), 56 cluster XCTest cases, 17 station XCTest cases, and 132 Swift Testing cases across 22 suites. The new isolated worker tests were corrected to avoid shutting down shared station singletons used by unrelated tests; production shutdown behavior was unchanged.
- Final frontend suite: 579 tests passed across 79 files. One earlier concurrent test/build run timed out in an existing logbook adaptive-layout assertion; its isolated 17-test suite and the complete rerun passed. No timing-related production workaround was added.
- TypeScript, Vite build and detached-window bundle/style gates passed. Existing large-main-chunk warnings remain; this is not whole-app performance closure.
- Fresh Sol medium UI finish review passed after correcting expanded-statistics layout and restoring keyboard focus when Details closes. Focused panel/capacity tests: 26 passed. Production-component synthetic browser captures cover 1440×900, 900×700 and 3840×2160 at 200% fixture scaling; default tables filled the available height without overflow. Full detail remains accessible through bounded scrolling when needed. Evidence links are in the surface brief. The temporary fixture was removed, its browser session closed and its development server stopped.
- The prior committed update `29e9516a3720fce16454e6ede71a96af1ca0e616` passed workflow `38368006458`: macOS, Windows and Linux builds, Windows fresh-runner runtime acceptance and Linux runtime-only acceptance. This is **not** CI evidence for the subsequent Spot History changes.

## Synthetic database performance

Measured by the opt-in `SpotHistoryDatabaseTests` benchmark on macOS ARM64 Debug with 100,000 synthetic reports and a roughly 900-byte Unicode comment per report:

| Operation | Measured result |
| --- | ---: |
| Batched ingestion, 100,000 reports | 21.930 s |
| Exact callsign page, p95 of 20 reads | 3.935 ms |
| Recent 24-hour page | 2.507 ms |
| Full-scope statistics | 454.744 ms |
| Independent reader reopen | 2.433 ms |
| Database and WAL/SHM footprint | 251,324,872 bytes |

The query-plan test confirms the callsign index is used. These are database-only synthetic measurements, not installed UI latency, concurrent hardware responsiveness, cross-platform performance or a guarantee at unlimited archive size. Reads have bounded deadlines and return errors rather than sampled statistics. Full integrity scans are not performed on every startup; schema/state checks are bounded and corrupt-record read failures are explicit.

## Recording-health and ownership limits

Schema version 2 preserves cumulative known-loss counts and process/clean-stop state independently of the latest 1,024 operational detail events. Compact durable receipts keep retries idempotent even after detail trimming. Invalid permanent records are isolated and reported as gaps; transient storage failures retain queued identities for bounded retries. An unclean process exit is an unknown-coverage warning, not a fabricated lost-report count.

The recorder admits at most 4,096 queued jobs, batches at most 100 reports, and drains for a bounded period at shutdown. The pre-existing transport event sequencer still schedules callback tasks; bounding the recorder does not prove the entire upstream pipeline has bounded task pressure. The application single-instance/global-worker owner provides one archive writer. Concurrent manually launched workers sharing that archive are unsupported and can make process-marker health evidence ambiguous.

## Remaining acceptance

New exact-SHA cross-platform CI, native packaged recording/restart and actual cluster reception remain separate acceptance gates. A prior permanent local candidate-launch restriction remains in force; it was not bypassed. No hardware, credentials or live database were used by this source work. Advanced filters, export/retention UI, richer charts and detached history remain explicitly tracked follow-up work.

## Portable and packaged-acceptance follow-up

The first exact-source matrix `38373959406` for `fc129e39fc013a5e77f40f2d3e46f111cf62e574` exposed a Windows build failure: `SpotHistoryDatabase.swift:2` imported unavailable `CoreFoundation`. Both new history files now use the existing portable Foundation JSON scalar distinction. New tests reject Boolean values where integers are required, while accepting numeric zero/one in their valid domains; rejected health events leave durable counters/revision unchanged. Actual Windows verification of this correction awaits the new matrix.

Local packaged acceptance now generates 137 synthetic reports into a private temporary archive, closes it, then reads it through the production worker/SQLite path. The new required `spot_history_archive` native check exercises both API pages without duplicate IDs, complete-scope statistics, rendered paging, exact-call filtering (69 reports), escaped original detail, close-focus restoration, empty search and route remount. It verifies the QSO draft is unchanged. The local acceptance allowlist exposes only the four read methods, not recording/seed/delete/export or cluster connection commands. Shutdown closes this injected archive before removing its generated directory; failed initialization also cleans only that directory.

These new checks are implemented, not yet executed in a packaged native WebView. The production-component test exercises the same acceptance helper in jsdom; this is not a substitute for the native run. It also does not prove live transport capture or process-restart archive continuity.

Final local follow-up evidence: 590 frontend tests across 81 files, TypeScript/Vite build and detached bundle/style gates passed. Rebuilt portable Swift passed 124 prototype XCTest cases (two skipped), 56 cluster XCTest cases, 17 station XCTest cases, and 138 Swift Testing cases across 23 suites. Ten enabled database tests and eight worker history tests are included. A separate read-only Sol review found no unresolved acceptance-harness isolation issue. The installed app and live archive remain unchanged.
