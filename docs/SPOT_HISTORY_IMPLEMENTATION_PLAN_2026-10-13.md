# Spot History implementation plan — 2026-10-13

Status: source audit and proposed implementation contract. The new Spot History page and database are not implemented by this document. This audit inspected source only; it did not open live databases, credentials, applications, network connections, or radio hardware.

## Required result

Add a Spot History workspace page backed by its own local database. It must retain individual reports received from enabled cluster connections, support callsign and UTC time searches, show historical rows and statistics, and remain useful after restarting xLog. Live DX Cluster grouping must not erase individual historical reports. Existing Previous QSOs is a different feature and must retain its current behavior.

“All cluster information” means the original accepted spot line plus parsed report fields, source identity, arrival/report time, and classification provenance. It does not mean storing login exchanges, passwords, arbitrary console transcripts, or a claim to have received reports while disconnected. Transport decoding has already removed Telnet framing; the stored raw line is the decoded source line, not a byte-for-byte network packet capture.

## Verified reference behavior and exact pointers

Reference repository: `/Users/oliver/Documents/Projects/om0rx-radio-control`.

| Concern | Verified source pointer | Consequence for xLog |
| --- | --- | --- |
| Separate persistent store | `radio_control/spots_logger.py:91–148`: `data/spots.duckdb`, dedicated `spots` table | Keep spot persistence separate from QSOs and Wavelog/outbox state. |
| Capture before live grouping | `services/background_tasks.py:584–592` logs each report; `:666` subsequently calls `upsert_live_spot` | Archive before grouping/display filtering. |
| Report metadata | `radio_control/spots_logger.py:222–268`: call/spotter/frequency/comment, receipt date/time, band/mode, source/RBL group, country/zones/continent, special tags, call/DXCC status | Preserve this searchable metadata and distinguish original input from derived values. |
| Existing alternative backend | `radio_control/spots_logger.py:918–929` selects DuckDB or PostgreSQL; `radio_control/postgres_spots_logger.py:53–122` inserts one report | Reference parity does not require a desktop PostgreSQL server or DuckDB dependency. |
| Callsign search | `radio_control/spots_logger.py:538–563` exact call; `:589–635` filtered prefix call | Offer explicit exact/prefix modes; retain portable `/P`, `/MM` and other suffixes. |
| Rich filters | `radio_control/spots_logger.py:589–604`: band/mode/CQ/continent/special/source/RBL/SNR/age | Stage these filters without silently substituting the current live list. |
| Recent paging | `backend/api/spots.py:908–928`; `radio_control/spots_logger.py:504–536`: maximum 500, newest-first, timestamp-only cursor | Use a timestamp plus unique row ID cursor to avoid skipping equal-time reports. |
| Statistics | `backend/api/spots.py:823–894`: source windows, band/mode/country; `frontend/spots-database.html:738–777,1546–1781`: timeline, spotters, frequency distribution | Calculate statistics for the complete selected history scope, not one page. |
| Export | `radio_control/spots_logger.py:873–895`: CSV export | Add bounded streaming export with native file selection. |
| Reference limitations | `frontend/spots-database.html:1097–1123,1182–1187` computes charts/counts from downloaded recent rows; `radio_control/spots_logger.py:534–536` returns empty on DB errors; `backend/api/spots.py:940–944` can substitute live cache | Do not copy partial-page statistics or ambiguous empty/error/cache behavior. |
| Write performance | `radio_control/spots_logger.py:271–276` commits/checkpoints after each insert | Reuse feature semantics, not per-report checkpointing. |

No retention/purge API was found in the inspected logger and spots API files. This is an observation about those files, not proof that the entire reference deployment has no external cleanup.

## Verified xLog integration boundaries

| Concern | Exact source pointer | Required change |
| --- | --- | --- |
| Ordered input | `Sources/XClusterIntegrationCore/ClusterSessionService.swift:5–13,373–382` sequences transport callbacks | New history ingestion must preserve that accepted wire order; do not spawn a separate unstructured task for every report. |
| Stale connection fencing | `ClusterSessionService.swift:505–507` validates per-transport generation; `:388–394` invalidates generations on Disconnect | Archive only accepted current-generation observations. Previously committed rows remain after disconnect. |
| Parser boundary | `ClusterSessionService.swift:508–514` accepts bounded lines and parses them before `addSpot` | Add an observation sink here, carrying the original line, actual arrival time, generation and parsed input. |
| Metadata/classification | `ClusterSessionService.swift:517–539` derives CTY, band/mode, source, special tags, score and call/DXCC status | Provide an immutable classification snapshot before the following aggregation mutation. |
| Live aggregation | `ClusterSessionService.swift:541–550` merges same call within 0.1 kHz/180 seconds, replaces prior visible row, caps memory at 400–1000 and fires `onSpot` | Do not persist the Rust/renderer snapshot or treat `aggregateCount` as historical row identity. `onSpot` fires per report but has already lost original line/time context. |
| Display filtering | `ClusterSessionService.swift:461–489` filters/sorts and exposes at most 500 visible rows | History must include reports excluded by live filters or later evicted from memory. |
| Reclassification | `ClusterSessionService.swift:553–575` updates live rows when contacts/rules change | Historical capture status is immutable; any “current status” is separately labeled and versioned. |
| Raw model | `Sources/XClusterIntegrationCore/Models.swift:4–24` retains decimal frequency text but has one `receivedAt` field | Add a dedicated observation model rather than overloading the existing live model. |
| Timestamp ambiguity | `Sources/XClusterIntegrationCore/SpotLogic.swift:130–150` uses local arrival for live lines and strips terminal HHMMZ; `:153–171` uses historical report date/time as `receivedAt` | Split ingestion time from source report time and record time provenance. |
| Existing history name | `Sources/XLogPrototypeSupport/LiveClusterMethods.swift:78–79`; `LiveWorker.swift:102–108`; `prototype/src/live/ClusterPanel.tsx:215–223,344–356` | Keep `cluster_history` as previous-QSO history; add `spot_history_*` methods. |
| Persistent worker owner | `Sources/XLogPrototypeSupport/LiveClusterMethods.swift:274–280` constructs one service; `prototype/src-tauri/src/cluster_session.rs:130–181,252–278` owns projection/polling | Attach one archival writer to the Swift service owner. Opening/reloading the page must never start a socket or another writer. |
| SQLite conventions | `Sources/XLogCore/LogbookDatabase.swift:2–6,118–133` uses SQLite3/CSQLitePrototype, explicit URL, FULLMUTEX, timeout and WAL | Reuse portable SQLite bindings and safe path conventions with an independent history connection/file. |
| Isolated workspace | `Sources/XLogPrototypeSupport/LiveLogbookMethods.swift:25–44`; `Sources/XLogCore/IntegrationWorkspace.swift:50–64` | Inject the history URL. Never call the standalone logbook default URL or silently open the native writer's DB. |
| File protection | `Sources/XLogCore/LocalFilePermissions.swift:3–18` | Unix private directory/file permissions; Windows inherited profile ACLs. Include WAL/SHM protection and symlink validation. |
| Portable builds | `Package.swift:9–65` explicitly lists portable core source files | Add the database source to the portable list and validate both module names. SQLite already ships; no new database engine is needed. |
| Worker authority/bounds | `prototype/src-tauri/src/worker.rs:11–15,16–50`; `Sources/XLogPrototypeSupport/LiveWorker.swift:61–80` | Allowlist read/detail/statistics/export methods explicitly; enforce shutdown and byte limits. New history surface does not inherit station/credential actions. |
| Page/menu inventory | `prototype/src/live/workspaceScreens.json:5`; `prototype/src/LiveApp.tsx:68,783`; `prototype/src-tauri/src/workspace_navigation.rs:13–16,53–64` | Add a stable `spot-history` route and native menu entry, then update inventory tests. |

## Separate database and observation fidelity

Proposed file: `<injected integration service directory>/spot-history.sqlite`, beside the service's own cluster configuration, not inside the QSO SQLite file. Normal shared service location currently derives from Application Support `OM0RX-xLog Integration Services` (`LiveClusterMethods.swift:61–64`); isolated tests derive from the injected workspace. Path ownership must be centralized so a future multi-workspace selection cannot combine unrelated archives accidentally.

Use a versioned SQLite schema migrated transactionally with `PRAGMA user_version`. An unknown future version or corrupt database produces explicit history-unavailable status and leaves the file intact. Do not recreate or overwrite it automatically.

Proposed tables:

| Table | Fields and constraints |
| --- | --- |
| `history_state` | Single row: `history_revision`, `created_at_us`, `last_commit_us`, retention policy version. Revision advances once per committed ingest/maintenance transaction; it is independent of Rust cluster projection and QSO contact revision. |
| `cluster_sessions` | `session_id TEXT PRIMARY KEY`, configured `cluster_id`, name/host/port snapshot, process session ID, connection generation, start/end times, bounded phase/error codes. No password, token, login transcript or secret-store value. |
| `spot_observations` | `row_id INTEGER PRIMARY KEY AUTOINCREMENT`, `observation_id TEXT UNIQUE NOT NULL`, `session_id`, `sequence INTEGER NOT NULL`, `arrived_at_us INTEGER NOT NULL`, nullable `reported_at_us`, `time_basis`, `record_kind` (`live`/`historical_reply`/`import`), original accepted `raw_line`, parser version, original decimal `frequency_text`, numeric `frequency_khz`, original and normalized DX/spotter callsigns, full parsed comment, normalized band/mode/source, nullable RBL group/SNR, country/ADIF/CQ/ITU/continent/coordinates, special tags JSON, capture classification JSON, resolver/rules version, contact revision. Foreign key to session; `UNIQUE(session_id, sequence)`. |
| `history_health_events` | Bounded operational records: interval start/end, writer error code, queue pressure/known unrecorded count, session/source scope. No raw arbitrary error text. Loss or interruption must be visible rather than disguised as an empty archive. |

Store actual arrival UTC microseconds independently of the source timestamp. Historical replies include an explicit date and time; live HHMMZ reports lack a date. Preserve that time text in the raw line; a resolved day may be stored only with an explicit inferred-date flag and documented midnight rule. Do not silently relabel historical report time as the local arrival time.

Capture arrival time in the transport callback before `ClusterEventSequence.submit` (`ClusterSessionService.swift:380–381`), then carry it into the actor; a delayed writer/actor must not shift the arrival timestamp. The service's transport generation fences stale callbacks, but an automatic reconnect within one transport can reuse that generation. Create separate archival connection segments from accepted phase transitions (`ClusterSessionService.swift:498–502`); do not assume a generation UUID alone identifies every socket connection.

Keep the original decimal frequency string as the fidelity authority and a finite bounded numeric kHz field for comparisons. An integer Hz value may be derived for convenience but must not replace original precision. Original case/text and normalized search keys are separate. Store the parser's full bounded comment, not the live UI's 512-byte truncation (`ClusterSessionService.swift:530`). List responses may show a shortened comment; detail/export must identify shortening and retain the original source.

Classification JSON records capture-time statuses, score/reasons and the contact/resolver/rules revisions that produced them. Do not copy entire QSOs, credentials, colour preferences, or sync payloads into the archive. A future reprocessing feature writes a separate derived revision/provenance record instead of mutating the source observation.

Indexes initially: `(arrived_at_us DESC,row_id DESC)`, `(callsign_key,arrived_at_us DESC,row_id DESC)`, `(spotter_key,arrived_at_us DESC,row_id DESC)`, `(reported_at_us DESC,row_id DESC)`, `(band,mode,arrived_at_us DESC,row_id DESC)`, `(cluster_id,arrived_at_us DESC,row_id DESC)` via a denormalized indexed cluster key if needed, and `(source,arrived_at_us DESC,row_id DESC)`. Add other indexes only after representative query-plan evidence. Avoid unused indexes on every JSON/metadata field.

## Identity, repeats and reconnect meaning

Every accepted incoming line receives a new observation UUID and per-session sequence exactly once before writer enqueue. Retrying the same archival job retains those identities and is idempotent. Identical reports received twice, from different spotters, from different cluster servers, or after reconnect remain distinct observations. A hash of line/call/frequency/time is diagnostic/grouping metadata, never a uniqueness constraint that erases real repeats.

An optional grouped view can show a repeat count and constituent rows. It does not delete or overwrite reports. Statistics distinguish observations, distinct DX calls, distinct spotters, source counts, and optional grouped candidates. Do not count the latest live `aggregateCount` as a second set of observations.

Automatic reconnect establishes transport continuity, not historical completeness. Current transports send login and skimmer settings (`ClusterTCPTransport.swift:157`, `ClusterPortableConnection.swift:163`); no gap-filling contract was found in those login paths. Store connected/disconnected intervals. A user-requested server history reply is archived as `historical_reply` with both receipt and report time; it may overlap existing reports and does not prove the server has supplied the entire gap. Opening Spot History performs no network backfill or new cluster commands. Existing Disconnect intent remains authoritative.

## Bounded ingestion, query and statistics contract

Create `SpotHistoryDatabase` with prepared statements and a dedicated serial writer lane. Keep it independent from `LogbookLane` so large history queries/exports do not monopolize station, logbook or cluster routing. One ownership boundary must govern writer lifetime and drain during worker shutdown.

Initial engineering bounds, to be validated with synthetic load: maximum 4096 queued observations; source line maximum 4096 bytes (existing parser limit); batch at most 100 observations or 200 ms; no checkpoint per report. WAL readers and a separately serialized writer support short read snapshots. Busy timeout, cancellation/deadlines, queue depth, last committed revision and failures are observable. Bound full observation metadata bytes as well as raw line length.

Queue overflow or disk failure cannot be solved by claiming complete history. First implement explicit pressure/backpressure admission semantics and test the accepted/committed boundary; never silently drop the oldest records or grow unlimited tasks. If the transport cannot pause safely in a bounded implementation, live reception may continue with a visible archive-gap/error record and counter. The page must expose “recording degraded” until resolved. This remains a limitation until the chosen pressure policy passes burst/failure tests.

Proposed worker reads: `spot_history_status`, `spot_history_query`, `spot_history_detail`, `spot_history_stats`. Mutations/export: `spot_history_export` and later explicit `spot_history_retention_apply`; these must have scoped native authority, parameter validation and receipts.

Query parameters: exact/prefix callsign or spotter, UTC inclusive start/exclusive end, chosen time axis (arrival/report), band/mode/source/cluster, country/ADIF/CQ/continent/special tags, `limit` default 100/max 500 and an opaque versioned cursor. Validate scalar lengths, filter counts, timestamps and supported sort modes. Escape LIKE wildcard characters in prefix input; SQL parameters remain bound. Details are retrieved by stable observation ID.

Newest-first pagination uses `(time,row_id)` and a fixed initial snapshot row watermark, not timestamps alone or offset paging. Include query fingerprint, watermark, chosen time axis and cursor version. Concurrent ingestion cannot reorder or skip the current browse session; refresh deliberately starts a new snapshot. Query results include history revision, applied scope, `has_more`, next cursor, recording health and explicit errors. Do not run expensive full-table COUNT for every page.

Statistics use the same filter/snapshot scope as the query, computed in SQL, separately from the visible rows. Initial set: observations, distinct calls/spotters, bands/modes/countries, source distribution and UTC hourly activity. Return bounded buckets/top-N groups, exact scope and covered interval. Expanded parity: top spotters, frequency/band distributions, 5/15/60-minute source activity and special-activity counts. All-time statistics need cancellation/progress or maintained summaries on large archives; a timeout is an error, not permission to label a sample “all history”.

The UI uses cancellable/debounced search and suppresses stale responses. Show loading, valid empty results, archive unavailable, recording degraded, historical coverage and retention separately. Default browse is recent 24 hours with explicit UTC time fields and an All retained history option. History selection/details must not tune, forward a radio marker, or log a QSO automatically. Any later explicit tune action must reuse the existing authoritative station selection path and be tested independently.

## Retention, export and privacy

Default retention is all received history. The user requested a database archive; this does not authorize silently deleting old reports. Show file size, earliest/latest coverage and recording health. Optional keep-N-days/max-size policy must be a visible user choice with a dry-run count/cutoff and a scoped apply receipt. Delete bounded batches by indexed time/row ID, update revision/coverage, and schedule checkpoint/space reclamation separately from receive handling. Policy semantics for historical replies use a stated time axis.

CSV export streams a fixed filter snapshot without loading the whole database into memory. Also offer JSONL for lossless original-line/metadata export. Use a native-selected new destination, bounded chunking/cancellation, file protection and an atomic final rename; clean up incomplete temporary exports. Neutralize spreadsheet formula-leading string cells in CSV while JSONL preserves exact text. A saved SQLite backup uses SQLite backup APIs for WAL consistency, not copying an active main DB file alone. Inclusion in general logbook backups must be explicit because archive size and lifecycle differ.

Local history is not synchronized to Wavelog and does not contain secret-store values. Escape all source text in the UI. Resolve and reject unsafe/symlinked DB/export paths using existing workspace conventions; protect Unix directory/DB/WAL/SHM files and verify Windows profile ACL behavior in runtime acceptance. SQLite file protection is not encryption; do not imply encrypted storage. Export/retention actions need no station or credential authority.

## Acceptance and next implementation slice

Source/temp-directory tests must cover:

1. Separate DB path, reopening persistence, transactional schema migration, future/corrupt version refusal, safe permissions/path checks, and unchanged original QSO database.
2. Two byte-identical live reports produce two rows; two cluster sources/spotters and reconnect replies remain separate; archival retry of one observation identity does not duplicate it.
3. Archive capture occurs before live filtering/grouping/eviction; filtered or more-than-memory-cap reports remain searchable after restart.
4. Raw decimal frequency/text/full comment, suffix callsigns and Unicode round-trip; oversize/nonfinite/invalid inputs remain rejected at the existing parser boundary.
5. Arrival versus explicit historical report UTC time, HHMMZ midnight inference provenance, and accurate source/session identity.
6. Capture classification provenance stays stable through later contact/rule changes; existing Previous QSOs remains unchanged.
7. Equal timestamps across page boundaries, concurrent inserts, filters, exact/prefix wildcard escaping, stable watermark/cursor behavior and bounded responses.
8. Statistics match the entire selected DB scope, including beyond the first page; observations and distinct/grouped counts have explicit meanings.
9. Fake transport stale generations are rejected; disconnect/reconnect interval gaps are visible; history reads do not start sockets, commands, secret reads, radio actions or automatic backfill.
10. Burst queue saturation, locked DB/disk errors, recovery, final drain/shutdown fencing and observable gap/error behavior; no unlimited task buildup or silent loss.
11. CSV/JSONL streaming, cancellation cleanup, special characters/formula cells, consistent snapshot backup and optional retention dry-run/batch deletion.
12. UI search stale-response suppression, UTC date range, pagination, selected row detail, full-scope statistics and accessible loading/empty/error/degraded states.

Use fake transports and injected temporary databases (`Tests/XClusterIntegrationTests/ClusterSessionServiceTests.swift:5–35`) and extend the existing parser boundaries (`ClusterParserBoundaryTests.swift:1–65`). Add focused Swift database/worker and React surface tests. Add portable source inclusion/build checks and Rust allowlist/bounds tests. A synthetic large archive should provide index plans and measured ingest/query/response-size results before performance claims; measure concurrent station/logbook responsiveness separately.

Next implementation slice: separate portable database plus immutable observation model and ordered session sink; bounded query/status/statistics worker API; main Spot History route with callsign/UTC filters, paged rows and summary statistics. Preserve Previous QSOs and cluster connection ownership. Advanced charts, lossless export UI and optional retention controls can follow only with clearly labeled scope; storage/error/shutdown correctness is part of the first slice, not deferred polish.

Native acceptance remains separate: exact packaged macOS/Windows/Linux worker database availability, permissions/WAL behavior, actual WebView routing and bounded rendering, restart persistence and shutdown drain. X11/Wayland UI behavior and Windows clean-machine SQLite runtime closure need evidence. Physical cluster reception and external server-history completeness are not established by fake transports, source tests or this plan. No RF/hardware evidence is required for a read-only archive page, and no such action was performed during this audit.
