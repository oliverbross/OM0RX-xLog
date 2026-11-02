# macOS startup and logging performance — 2026-11-02

The installed 1.4.5 investigation reproduced a full cluster-contact rebuild taking 5.4–8.4 seconds after a contact change on a private copy of a roughly 70,000-contact log. That scan used the interactive database connection. A process sample also found automatic Wavelog full-history work consuming substantial CPU during startup. Production contacts were not used for test writes.

## Changes

- Cluster contact extraction now uses a separate, revision-pinned, read-only SQLite connection. Extraction and classification run on one utility queue, with a prepared index published by the live cluster actor. Foreground saves no longer wait for that full-log scan.
- Concurrent startup and contact updates share one rebuild. An unchanged database revision reuses its current projection; Connect no longer builds the initial index twice. One verified revision change can retry the read. Connect itself is never replayed.
- Workspace replacement cancels and drains the reader, retires the shared flight, and admits the new workspace independently. Shutdown cancellation still prevents a held late publication. Publication checks retain generation, physical file identity and durable revision fences.
- Map initialization joins the existing statistics reader instead of issuing a second full-log calculation on the interactive connection.
- Wavelog builds both fallback identity indexes only when the documented-order JSON/ADIF join fails. Snapshot completeness, ambiguity holds, deletion checks and upload authority remain intact.
- Full workspace integrity validation uses a temporary cache of up to 128 MiB, released with its inspection connection. The complete integrity check remains enabled.
- Main and detached cluster startup distinguish native pre-transport contention from actual failures. Detached initialization retries that specific pending condition and cancels retries on close. It never retries an uncertain action or sends Connect from the renderer.
- Logbook refresh paints the first verified contact frame before later frames finish, retaining lower rows while loading. Mutations remain guarded until the page settles; failure restores the previous complete page.

## Bounded measurements

The private native diagnostic opens a fresh copy of an explicitly supplied, consistent SQLite snapshot, supplies an unavailable credential vault, and does not start external services. It prints timing metadata only. The measurements below include host load and are observations, not latency guarantees.

| Operation | Before | Candidate |
| --- | --- | --- |
| Cold cluster projection | 924 ms | 551 ms |
| Full projection after a save | 5,381–8,423 ms on the interactive connection | 4,684–7,319 ms on the separate reader/utility queue |
| Foreground database save during a real-log projection rebuild | Previously shared the blocking scan connection | 0.86 ms |
| Logbook page during that rebuild | Previously shared the blocking scan connection | 12.45 ms |
| Cold workspace readiness | 13.02 s | 13.06 s |

Cold readiness still includes full database integrity validation. This source run does **not** establish a cold-start speedup. Separate SQLite cache experiments favored a larger temporary cache, but should not be substituted for application startup acceptance. Durable database save timing is not GUI, transport or receipt-to-paint timing.

Run the opt-in diagnostic with `XLOG_PORTABLE_ONLY=1 XLOG_PERF_SNAPSHOT=/path/to/private-consistent-backup.sqlite swift test -c release --filter PrivateLogPerformanceTests`. Never nominate a live database/WAL pair as a standalone snapshot. The nominated input is copied; only the newly created test workspace receives synthetic contacts.

## Verification

- Cluster initialization: 16 focused frontend tests passed.
- Logbook refresh, selection, mutation guards, import/export and Details: 107 frontend tests passed.
- Final detached-cluster and main-window startup cohort: 78 frontend tests passed, including real failure visibility and cancelled pending retries.
- Native read/owner, sync identity and private performance cohort: 56 XCTest and 80 Swift Testing tests reported passed. The initial compile used a temporary focused test-source list; the normal manifest was restored afterward.
- Cluster classification/session/transport cohort: 38 XCTest tests passed.
- Final contact/startup/restore/shutdown cohort: 40 Swift Testing tests passed; the separate opt-in generated timing case was skipped.
- Production frontend build, TypeScript and window-bundle checks passed again during packaging of the exact 1.4.6 release source.

These cohorts overlap and must not be added into a unique total. Signed-package and installed acceptance are recorded in [installed-1.4.6.md](installed-1.4.6.md). Hardware, RF quality and provider-account coverage are outside this local performance qualification.
