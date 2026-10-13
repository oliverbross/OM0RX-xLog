# Spot History first slice — source acceptance

Status: first-slice source implementation and local regression/visual verification passed. Not installed; the running Integration app is not recording this archive yet. Matrix 38376219275 found two acceptance/test defects; the corrections below await renewed exact-source CI.

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

Local packaged acceptance generates 137 synthetic reports into a private temporary archive, closes it, then reads it through the production worker/SQLite path. The `spot_history_archive` check exercises both API pages without duplicate IDs, complete-scope statistics, rendered paging, exact-call filtering (69 reports), escaped original detail, close-focus restoration, empty search and route remount. It verifies the QSO draft is unchanged. At 6683d1b the Swift allowlist exposed the four read methods, but the preceding Rust gate still denied them and did not require the new check. Those omissions are corrected in the follow-up below; the earlier statement that the complete native gate was wired was premature. Recording/seed/delete/export and cluster connection commands remain denied. Shutdown closes this injected archive before removing its generated directory; failed initialization also cleans only that directory.

These new checks are implemented, not yet executed in a packaged native WebView. The production-component test exercises the same acceptance helper in jsdom; this is not a substitute for the native run. It also does not prove live transport capture or process-restart archive continuity.

Final local follow-up evidence: 590 frontend tests across 81 files, TypeScript/Vite build and detached bundle/style gates passed. Rebuilt portable Swift passed 124 prototype XCTest cases (two skipped), 56 cluster XCTest cases, 17 station XCTest cases, and 138 Swift Testing cases across 23 suites. Ten enabled database tests and eight worker history tests are included. A separate read-only Sol review found no unresolved acceptance-harness isolation issue. The installed app and live archive remain unchanged.

## Exact-source CI diagnosis and correction

Matrix `38376219275`, source `6683d1b0a811fddbeaa7d01657d8371907d035a6`, failed. macOS and Ubuntu build/package jobs passed. Windows compiled past the CoreFoundation issue, then failed the resolver retry-storm test because its fixture assumed two dispatch callers would run concurrently. No Windows package or native runtime acceptance followed. The fixture now starts two dedicated callers and verifies both permits are occupied before the saturation storm; six local resolver tests pass.

Linux's first packaged X11 launch completed 23 workflow checks, then the Rust local-acceptance gate rejected `spot_history_query`. Relaunch, relocation, Wayland and final map checks were not reached. The gate now allows only the four history read methods; the worker retains bounded parameter validation and private-fixture ownership. Rust acceptance requires `spot_history_archive`, rejects missing as well as false required checks, and tests denial of recording/export/delete methods. Twelve local Rust acceptance tests and the isolated Swift history fixture test pass. String rejection messages are now retained in the acceptance report instead of being replaced with a generic failure.

These are source/test corrections, not a successful Windows/Linux runtime rerun. The installed app and live cluster archive remain untouched.

## Verified Linux packaged follow-up — 4b4df8d

Exact source `4b4df8de08c6236898985e99f0347a22ee27e54e`, matrix `38379624312`, passed macOS and Linux builds and Linux runtime-only acceptance. The four inspected native reports each passed all 27 required checks: installed Debian X11 first launch, X11 relaunch, relocated archive X11 and installed Debian Wayland. The runtime-only Ubuntu 24.04 container had no development toolchains, ran as UID 10001 with network disabled and all capabilities dropped. Wayland used nested Weston/pixman on Xvfb, not a physical desktop or a direct headless compositor. Reports are retained at `/tmp/xlog-linux-evidence.N0jucx`; artifact `11803378833`, SHA-256 `6a1f73a99f486f5f25291a7215ace21830f349507ddce10d7029a7beac84b232`.

Each `spot_history_archive` check confirmed 137 unique archived reports, 69 filtered reports, two distinct calls, native paging/table rendering, original source with escaped text, empty search, route remount and unchanged QSO data through the packaged worker. The Settings preset workflow also ran successfully in each launch. Each launch uses its own isolated fixture; this does not establish live cluster recording, archive continuity across process restarts, or installed Mac acceptance. No live station or account I/O occurred.

The matrix as a whole failed: Windows passed portable Swift tests and worker compilation, then one frontend resize test exceeded its default wait. Packaging was consequently skipped; the downstream runtime job could not download a nonexistent Windows package. The two Spot History resize tests now advance the 120 ms capacity debounce explicitly with a fake clock and flush pending query work; all 23 panel tests pass locally without a production timeout change. Exact-source Windows revalidation remains required.
