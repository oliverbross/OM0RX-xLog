# OM0RX-xLog project status

Last updated: 2026-10-12
Release `v0.2.0` adds the complete native AJD/WAJA/JCC/JCG/AJA/WACA/WAGA/WAPC/WCSA catalogue, backed by bundled MIT-licensed reference data and live verification against the 67,823-contact local log.
Latency follow-up: xCat now omits redundant RX-VFO/split writes for simplex
spot changes (one remote command instead of three; 57 Swift tests pass).
The Windows source separates radio polling from serialized accessory following
and adds queue/execution/route-stage timing; 149 focused Python tests pass.
Windows phase 1 deployed: source `d54cd94`, canonical agent `0116560`.
Recorded publish medians: same-band 970 ms, mode change 1086 ms, cross-band
1150 ms, split exit 3544 ms. Cross-band accessory median remains 8585 ms.
Phase 2 implemented capability-gated single-transaction split exit
(`tune_simplex`) and detailed accessory-stage profiling. Deployment and the
remaining acceptance limits are recorded in the follow-up below.
2026-10-12 follow-up: Windows phase 2 verified in fetched source `169106d`,
deployed canonical SHA `2fc1043`; split publication 1239.5 ms median, accessory
readiness still 9129.1 ms (no demonstrated overall gain). Mac bridge now exposes
observed radio state, not optimistic pending writes; xLog waits for exact
frequency/mode and A RX/TX before success and rejects stale completion from an
older selection. 29 xLog and 58 xCat Swift tests passed; signed apps installed.
Live band-map selection JJ0PKS from B RX/A TX split confirmed simplex A at
18.082500 CW without logging/transmitting: 2629 ms from recorded spot arrival,
1755 ms from tune-task start. Timer now includes task scheduling. Read-only
local telemetry samples took 16–43 ms. This is one sample through the xLog
band-map route, not acceptance of the separate external xCluster launcher or
the full cross-band/rapid-selection matrix. Point 1 remains PARTIAL. RustDesk
and AnyDesk attachment both time out; Windows handoff remains necessary.
See `om0rx-radio-control/docs/WINDOWS_CODEX_LATENCY_HANDOFF_2026-10-11.md`.

Product owner and maker: **Oliver Bross OM0RX**  
Repository: `oliverbross/OM0RX-xLog` (public)

This is the living implementation and acceptance record for OM0RX-xLog. Update it whenever scope, behaviour, validation evidence, or release state changes.

## Status legend

- **DONE** — implemented and covered by local evidence.
- **PARTIAL** — useful implementation exists, but the stated acceptance criteria are not complete.
- **PLANNED** — accepted scope, not yet implemented.
- **EXTERNAL** — requires credentials, hardware, a service, signing/notarization, or operator acceptance.

## Product objective

Build a native, beautiful, local-first macOS logbook that removes RUMlogNG from the critical operating path while keeping Wavelog as the cloud logbook, award engine, statistics service, and distribution hub. xLog is the primary operator surface and local source of truth. It must continue logging offline.

The suite remains a hybrid ecosystem rather than one unsafe monolith:

```text
OM0RX-xCluster ── spot + classified snapshot ──► OM0RX-xLog
                                                      │
OM0RX-xCat ◄──── frequency / mode / station state ────┤
     │                                                │
     └──── Windows Agent / FLEX / KPA500 / KAT500     │
                                                      │
                                local SQLite logbook ─┤
                                                      │
                                      Wavelog API v2 ◄┘
```

xCat remains the single owner of safety-critical radio communication and interlocks. xLog may display station state and request tuning through xCat, but a logger crash must not interrupt radio protection.

## Current implementation matrix

| Area | Status | Current evidence / remaining acceptance |
|---|---|---|
| Native macOS application | DONE | SwiftUI/AppKit, macOS 13+, signed `.app`; no embedded web app. |
| OM0RX visual identity | DONE | Navy/teal/cyan/orange/pink system, distinct xLog ledger icon, dense operator layout. |
| Local SQLite authority | DONE | WAL database, stable local UUID, Wavelog ID, JSON field bag, dirty state, tombstones. |
| Offline logging | DONE | New/edit/delete/search work locally without Wavelog. |
| ADIF import/export | DONE | Unknown/custom fields survive round trips. |
| Wavelog create/read/update/delete | DONE | Built-in API v2 client and read-first reconciliation implemented; accepts site or full API-v2 URLs and does not require xBridge. |
| Two-sided sync conflict safety | DONE | Remote preflight occurs before push; last-synced baseline and explicit Keep local / Use Wavelog UI. |
| Field-level merge UI | DONE | Conflicts preserve complete local and remote records and expose a field-by-field local/Wavelog picker, plus whole-record shortcuts, before committing a merged result. |
| Durable retry/outbox visibility | DONE | Failed items remain in a persistent outbox with the exact error, attempt count, bounded exponential retry time and an explicit Retry now action; one failed contact does not block the remaining queue. |
| QSO session and draft recovery | DONE | The active contact keeps first-transmit time, peak measured output and route history; unfinished entry state is restored after restart and surfaced as a recovered draft rather than silently discarded. |
| Pre-log validation | DONE | Callsign, frequency, band consistency, mode, grids and likely recent duplicates are checked before save. Errors fail closed; warnings require an explicit Log anyway confirmation. |
| Automatic station metadata | DONE | New QSOs automatically retain TX power, antenna azimuth/path, station route history, radio identity and first-transmit timestamp where telemetry is available. |
| Complete Wavelog-style form | PARTIAL | QSO, contact/location, references/notes and station/QSL groups are visible together in a responsive single-screen editor at normal desktop sizes; the former detail tabs are removed. Narrow or short windows retain a scrollable adaptive fallback. Live split state is imported automatically; dedicated contest, satellite and manual split controls remain planned. |
| Compact three-row QSO entry | DONE | Row 1 is call/date/UTC/frequency/band/mode/RST; row 2 is name/comment/grid/country/county; row 3 is POTA/SOTA/IOTA/WWFF/castle. Live radio frequency, band and mode are white and read-only while xCat is connected. |
| Automatic TX power logging | DONE | Live station telemetry populates ADIF `TX_PWR`: non-zero measured output is retained for the active QSO after PTT returns to receive, current RF drive is used until output is observed, and the station-profile default remains the offline fallback. Existing QSOs remain unchanged while editing. Installed acceptance on 11 Oct 2026 captured 70 W during transmit and correctly retained 70 W after the live meter returned to 0 W. |
| Keyboard-first workflow | DONE | `⌘↩` logs from both entry surfaces. Operator Desk focuses Callsign on open, Return advances through editable report/identity/reference fields while skipping radio-owned frequency/band/mode, the final Castle field logs, and every compact logging path returns focus to Callsign. |
| QRZ enrichment | PARTIAL | Keychain credentials and live lookup are exercised. Callsign changes clear only prior automatic values, preserving operator edits. A precise QRZ grid/coordinate now becomes the map and automatic-rotor target; CTY centroids never trigger automatic turns. Reusable session/cache controls and personal-field privacy choices remain planned. |
| CTY / Club Log / LoTW / catalog | PARTIAL | Atomic last-known-good downloads, conditional ETag/Last-Modified revalidation and visible per-source cache/check/version status are implemented. The operator's Keychain-backed Club Log application key was accepted by the official CTY endpoint on 11 Oct 2026; the installed app downloaded and validated 10.2 MB, and LoTW refreshed to 6.3 MB. Wavelog catalog live refresh remains. |
| xCat radio integration | DONE | Loopback RigCtlD reads live frequency/mode and requests both on spot handoff. No direct radio ownership. |
| Low-latency atomic tune and station telemetry | PARTIAL | xLog sends one `xcat_tune` request, xCat maps it to one `set_frequency_mode` Windows-Agent command, prevents overlapping polls/tunes and records end-to-end timing in Operator activity. The acknowledgement window is 12 seconds so the accepted 7.204-second guarded route no longer produces a false timeout. xCat clears a previous split and selects VFO A before a new spot tune. Correctness and diagnostics are implemented; reducing the underlying station latency remains. |
| xCluster handoff | DONE | Callsign, frequency, mode, comment and detected special badges cross the `om0rx-xlog://spot` contract. |
| Award reference promotion | DONE | Tested POTA, SOTA, IOTA, WWFF and castle parsing populates the corresponding ADIF fields without inventing missing IDs. |
| International award catalogue | DONE | Insights calculates AJD, WAJA, JCC, JCG, AJA, WACA, WAGA, WAPC and WCSA from the complete local log, including historical Japanese entities, WAPC band/mode detail, WCSA school slots and case-normalized ADIF bands. Installed evidence: AJD 10/10, WAJA 47/47, JCC 433, JCG 97, AJA 1,473, WAPC 34/34 and WCSA Gold. |
| Official award-directory cache | PARTIAL | Official POTA park, SOTA summit, IOTA group and WWFF feeds are downloaded, schema/count validated, conditionally revalidated, atomically replaced and loaded immediately at startup before network synchronization. The installed profile holds 348,973 records (POTA 96,532; SOTA 182,280; IOTA 1,178; WWFF 68,983), and `US-1234` live-resolved to Pearl Lake State Park. The published WCA spreadsheet link currently returns 404, so full castle caching remains open; castle values are preserved rather than rejected. |
| Operator Desk | DONE | Logger, callsign intelligence, rotor, world map and selected band maps are simultaneously visible. Station Pulse was removed and its useful state moved to the header. |
| World map | DONE | Hybrid default plus satellite/standard styles, live spot layer, DXCC entity layer and semantic legends. |
| DXCC overlay | PARTIAL | Bundled GeoJSON boundaries render with grey/orange/green needed/worked/confirmed fills and strokes, while MapKit de-conflicts persistent entity labels as zoom changes. The source, retrieval date, checksum and reuse basis are recorded. Release-build/parser tests and installed hybrid-map rendering pass; prolonged operator observation remains. |
| Map label legibility and stability | PARTIAL | The flashing badge-style renderer was traced against the original plain-label implementation and removed. Zoomed spot callsigns and DXCC prefixes now use background-free semantic-colour text anchored beside a stable dot, with restrained shadow contrast, deterministic camera-based DXCC spacing and no MapKit collision arbitration. Spot annotations retain durable callsign identities even when xCluster regenerates snapshot UUIDs; unchanged annotations are updated in place and skipped by an explicit render signature, while all geometry/layer changes disable implicit animation. Automated and installed checks pass; prolonged operator observation remains. |
| Initial world-map framing | PARTIAL | With no active DX target, each newly opened map starts centered on the configured operator grid. Once a precise DX target exists, the existing automatic home/route/DX fit remains authoritative. Release build passes; installed camera acceptance remains. |
| Map operating presets | DONE | Persistent Simple, Detailed and DX presets atomically configure spot, DXCC, sun and greyline layers without requiring repeated individual toggles. |
| Rotor path | PARTIAL | Automatic QRZ-resolved SP turning was live-verified with VK8NSB (PH57kp, target 081°). Every xLog rotor request now carries the target band and xCat enforces that explicit value against the configured rotor-band set, avoiding stale station-route telemetry during a QSY. Explicit SP/LP controls, ADIF antenna-path recording and complementary map arcs are implemented and locally tested; final installed LP visual/physical acceptance remains. |
| Solar / greyline overlay | PARTIAL | Current subsolar point and an independently switchable day/night terminator are implemented with minute updates and a deterministic ephemeris test. Release build passes; installed visual acceptance remains. |
| Band-filtered map spots | PARTIAL | Map follows the Operator Desk selection and xCluster's filtered, sorted and display-limited snapshot, with each band's configured colour. At 40° longitude span or closer, callsign labels appear beside spot dots using deterministic visibility and stable identities; installed zoom-transition acceptance remains. |
| Band maps | DONE | Independent desk/detached selections; desk radio-follow; detached single-row/adaptive-grid layouts; full-band/CW/data/phone presets, pan, zoom, allocation lanes and xCluster colours. |
| Dense spot layout | DONE | Collision-aware dynamic columns replace overlapping labels. |
| Resizable / undocked maps | DONE | Separate World Map and Band Maps windows. Band maps consume available width and height; text scales persistently from 80–200% for 4K displays. |
| Callsign and DXCC intelligence | DONE | Separate exact-callsign and resolved-entity worked/confirmed matrices use the configured operating bands. The card also shows lookup provenance, DXCC number, grid, continent, CQ/ITU zones, distance, counts and last-QSO context. |
| Logbook confirmation status | DONE | The local table shows independent sent/received indicators for paper QSL and LoTW plus the imported ADIF Club Log upload status. Pending Wavelog sync remains visible as a callsign status dot. |
| Basic statistics | DONE | Local QSO, confirmation, year and DXCC counts. |
| Backup and restore | PARTIAL | A first-class `.xlogbackup` workflow now snapshots SQLite through the SQLite backup API, records settings/workspace/reference-data inventory, verifies SHA-256 plus `PRAGMA integrity_check`, previews content before restore, excludes Keychain secrets, creates an automatic pre-restore backup and retains a timestamped rollback database. Core round-trip and tamper tests pass; an operator-approved live recovery drill remains. |
| Shared xBridge/xCluster libraries | PLANNED | Wavelog/ADIF/handoff behavior is implemented locally, but reusable components have not yet been extracted into shared Swift packages as described in the original architecture. |
| Embedded cluster table | PLANNED | Operator Desk consumes xCluster's local classified feed; a complete embedded cluster table remains optional later scope. |
| Embedded station monitor | DONE | xLog consumes loopback-only xCat radio, KPA500, KAT500, rotor and propagation telemetry; xCat remains the sole hardware/interlock owner. The installed layout is accepted, and the guarded Windows deployment finished `CONFIRMED · READY` at 7.195 MHz/LSB with KPA standby/0 W, KAT 40 m ANT2, MOX false, recovery clear and zero alarms. |
| Station-monitor consolidation | PARTIAL | Rotor replaces Station Pulse; HF propagation has visible solar indices and day/night band ratings in the enlarged header; station actions/metrics/KPA/KAT are implemented beneath Settings. Installed visual and live telemetry acceptance pass with the coordinator READY and zero alarms; final direct operator acceptance of every xLog action button remains. |
| Safe CAT/RigCtl disconnect handling | PARTIAL | Read-only short-lived polling connections no longer unkey an independently keyed Maestro/FLEX session. Disconnect cleanup is retained only for the client session that successfully acquired PTT/CW ownership, and unit coverage distinguishes reads, rejected TX, acquired TX and release. Physical Maestro MOX acceptance is still required because the operator previously observed continued drop-out. |

## Active requirements register

This register is the release gate for all operator feedback in this build cycle. Nothing is considered complete merely because code exists.

| Requirement | Status | Acceptance / evidence |
|---|---|---|
| Preserve Wavelog configuration and local database across app replacement | DONE | On 2026-10-11 the live profile was found empty; the intact Trash backup was restored, including 67,815 QSOs and the saved preferences. Keychain Wavelog/QRZ secrets remained present. The empty replacement profile was retained in Trash for audit. |
| Verified backup and previewed restore | PARTIAL | The installed Settings surface creates portable `.xlogbackup` packages and inspects their manifest, checksum, SQLite integrity, counts and included data before offering Restore. Restore first takes a verified current-state snapshot, excludes Keychain credentials, and preserves the replaced DB for rollback. Automated round-trip/tamper tests pass; a live restore of the operator profile is intentionally deferred pending an operator-approved drill. |
| Live radio owns new-QSO frequency/band/mode | DONE | The three values update atomically from xCat, remain white/read-only while connected, and are preserved only when editing an existing saved QSO. |
| Three-row compact logger | DONE | Requested field order is implemented; portable references occupy the third row. |
| Automatic rotor targeting | DONE | Automatic movement occurs only after QRZ provides a precise grid/coordinate. VK8NSB resolved to PH57kp and live telemetry showed `Turning CW · 079° → 081°`. Duplicate commands are suppressed. |
| SP and LP rotor controls plus matching map route | PARTIAL | SP/LP selection, bearings, xCat commands, QSO antenna-path value and short/complementary long great-circle routes are implemented and tested. Final installed LP UI/physical check remains. |
| Rotor and intelligence card design | DONE | Installed visual acceptance confirms equal-height cards, consistent gutters, a 166-point graduated compass, enlarged current/target bearings, path, distance, source/status text and bottom-aligned regular-size SP/LP/Stop controls using the full card height. |
| Separate callsign and DXCC intelligence | DONE | Settings-backed 160/80/60/40/30/20/17/15/12/10 m defaults feed two independent matrices. Installed SP9AQQ acceptance showed exact-call history (2 worked) independently from DXCC #269 history (1,847 worked / 1,010 confirmed), with QRZ provenance and facts. |
| Enlarged header with HF day/night ratings | DONE | Installed visual acceptance confirms the enlarged radio/cluster/Wavelog/lookup/station rail and readable solar indices plus day/night band tiles. |
| Sidebar station controls | PARTIAL | The rail keeps its accepted width, large TX/SWR/drive tiles and readable KPA/KAT telemetry. Operate/Standby, Tune and Cancel are now full-width semantic tiles with explicit READY/BLOCKED state. xCat now filters unsafe or route-ineligible actions; installed visual/functional acceptance remains. |
| Station-command transport | DONE | The false 80 m route-policy rejection and combined-command publication defects are corrected in pushed source `90abbb4` and deployed Windows controller `c49dfd3`; xLog retains its 10-second station-action window and distinct timeout/closed-socket errors. Guarded live acceptance proved coherent combined tuning, exact route alignment, READY/zero-alarm state and no PTT, TUNE-start, CWX or RF transmission. |
| Persistent manual amplifier intent | DONE | One explicit Operate request persisted across a same-band retune, forced verified standby on prohibited 20 m without erasing intent, and restored Operate after returning to the exact allowed 40 m route. Explicit Standby cleared intent. Live acceptance kept MOX false and output 0 W throughout. |
| Per-band RF-drive defaults and Maestro override | DONE | A manual Maestro change to 30 W survived a same-band 40 m retune; transition to 20 m applied its 65 W barefoot default, and return to 40 m applied its 98 W default. Each route settled with matching KPA/KAT band and antenna, recovery clear and zero alarms. |
| Rotator band interlock | PARTIAL | xCat now advertises and accepts `rotor_goto` only when the current band is enabled in Rotator settings; `rotor_stop` remains available on every band. RUMlog automatic/commanded turns also respect the same band gate. Tests pass; installed 80m rejection and enabled-band acceptance remain. |
| Settings layout | DONE | Installed visual acceptance confirms the compact selector sits immediately beside a leading 920-point form canvas, with the former dead column removed. |
| Cluster spot destination | DONE | xCluster handoff populates the compact QSO, references and xCat tune request while remaining on Operator Desk by default. A persistent Integrations setting optionally opens the full Log QSO editor. |
| xCluster call/DXCC status from restored log | DONE | Installed xCluster reads all 67,815 local QSOs and visibly produces mixed Confirmed/Worked classifications across current spots; the prior all-ATNO state is no longer present. |
| Logbook QSL/LoTW/Club Log columns | DONE | Installed visual acceptance against 67,815 restored QSOs confirms independent sent/received arrows for paper QSL and LoTW, plus the stored `CLUBLOG_QSO_UPLOAD_STATUS` without inventing a receive state. |
| DXCC information layer | DONE | Installed visual acceptance confirms 337 entity-code boundary geometries with needed/worked/confirmed styling and concise main-prefix labels (for example `OM`, `OK`). Tooltips retain the full entity name, ADIF code and status; records without a valid prefix do not emit misleading fallback labels. Provenance and SHA-256 are recorded under `Sources/XLogCore/Resources`. |
| World-map home/DX path and automatic framing | DONE | Home marker, precise DX marker, SP/LP bearings, geodesic route and automatic fit are implemented. |
| Sun position and switchable greyline | PARTIAL | Toggle controls, subsolar marker, shaded terminator band and edge are implemented. Installed visual acceptance with DXCC, spots and SP/LP paths remains. |
| Official POTA/SOTA/IOTA/WWFF/castle directories and type-ahead confirmation | PARTIAL | POTA/SOTA/IOTA/WWFF use official bulk feeds with conditional atomic refresh, minimum-count/schema validation, offline exact matching and prefix suggestions displayed beneath the fields. An exact match with published coordinates offers an explicit map-target action that never auto-turns the rotor. The installed cache contains 348,973 validated records and `US-1234` visibly resolved to Pearl Lake State Park. Unknown/unavailable references remain loggable. Full WCA/castle ingestion awaits a working official bulk source; its advertised spreadsheet currently returns 404. |
| Independent/resizable band-map workspaces | DONE | Desk and detached selections are independent; detached layout supports one row or adaptive grid, full-height use, 80–200% text scale, segment zoom and cluster-filter inheritance. |
| Band-map spots on world map by active band colour | PARTIAL | World-map spots follow the desk band selections and xCluster-filtered snapshot, retain band colours, and reveal de-cluttered callsign labels at regional/local zoom. Installed visual acceptance remains. |
| New-contact clearing | PARTIAL | A clearly labelled coral `Clear QSO` control with an xmark icon sits immediately beside Log QSO in both compact and full editors and is visible in the installed app. Loading a different cluster spot, beginning a different callsign, or changing live frequency/band clears prior-contact identity, comment and activation-reference data while preserving the new live radio values and station identity. Release build passes; end-to-end operator workflow acceptance remains. |
| xLog-to-FLEX spot forwarding | PARTIAL | xLog can send the current xCluster feed to xCat's loopback RUMlog-compatible UDP spot bridge with deduplication, settings control and visible health; xCat remains the only FLEX owner and spot forwarding never keys PTT. XML/escaping/status unit tests and release build pass; live SmartSDR display acceptance remains. |
| Full castle/WCA reference directory | BLOCKED — AUTHORITATIVE SOURCE | Import requires a maintained authoritative bulk source with stable identifiers, schema/count validation, conditional download and last-known-good atomic replacement. The WCA site still advertises an Excel list but its target returns 404; the reachable ACRACB/DCE directory is a Spanish national programme rather than a complete global WCA source. No guessed, scraped or falsely complete list will ship. |

## 2026-10-11 recovery incident

- Symptom: the installed xLog opened with zero contacts, Wavelog and QRZ unconfigured, and no home grid; consequently callsigns could not become precise rotor targets.
- Evidence: the newly created live database contained zero QSOs. An intact recoverable backup at `~/.Trash/OM0RX-xLog` contained 67,815 QSOs, and a matching saved preferences plist was also present. Wavelog and QRZ Keychain entries were never lost.
- Root cause: moving the installed app bundle to Trash invoked macOS application-data cleanup and moved xLog's Application Support profile and preferences with it. Normal app quit did not remove data.
- Recovery: the empty live profile was archived to Trash, the full SQLite database (after a clean WAL checkpoint), reference data and preferences were restored, and the app visibly returned to 67,815 contacts with Wavelog synchronization active and JN88TQ restored.
- Hardening: xCat now exposes its configured rotor home grid on the loopback station bridge; xLog adopts it only when its own station grid is empty. Upgrades must overwrite in place or archive the old bundle outside Trash. The accepted backup/restore feature remains P0.

## Operator Desk acceptance

- Logger, world map and band maps remain visible at the same time on a normal desktop window.
- World Map and Band Maps can each open in an independent resizable window.
- The hybrid map is the default visual treatment; Standard and Satellite remain selectable.
- World-map spots are limited to the Operator Desk band-map selection and use configured band colours.
- Operator Desk and undocked band maps keep independent selections; radio-follow affects only the desk.
- The undocked view offers persistent single-row and adaptive-grid layouts and consumes the window's full usable height.
- Band-map text scaling is persistent and remains legible on high-density/4K displays.
- Map spots follow xCluster's active filters instead of reintroducing hidden spots.
- DXCC overlay can show spots, entities, or both.
- A configured station grid plus an active DX target produces a geodesic path, distance and SP/LP bearings.
- The configured home station is visibly marked on the map; the owner installation uses JN88TQ.
- A newly resolved DX target automatically fits the home marker, DX marker and complete path on screen; manual map movement remains possible afterward.
- Add an independently switchable greyline/day-night layer and current subsolar marker without obscuring DXCC, spot or path colours.
- Band maps show clear CW/data/phone lanes, accurate frequency positions, segment presets, zoom and pan.
- Busy-frequency labels must not overlap; extra width creates more columns and extra height creates more frequency separation.
- Clicking a spot loads the QSO and asks xCat to tune frequency and mode without hiding the Operator Desk.

## Logging-field scope

### Implemented

- QSO: date/time, callsign, mode/submode, band, TX/RX frequency, RST, name, gridsquare, country/location and comment.
- References: IOTA, SOTA, WWFF, POTA, SIG/SIG Info and DOK.
- Station: station profile, radio, RX band/frequency, TX power and operator.
- General: DXCC, continent, CQ/ITU zones, propagation mode, antenna path, state/county, QTH and email.
- Notes and QSL: local notes, QSL sent/received, method, via and message.
- Imported unknown/custom ADIF fields are preserved.

### Remaining

- Dedicated contest exchange and serial-number workflow.
- Satellite name/mode and propagation-specific validation.
- Manual split-operation controls; automatic xCat RX/TX VFO import and split-safe spot handoff are implemented.
- Operator policy for saving QRZ personal address/email data.
- User-editable regional band plans rather than the current reference lanes.

## Reference-data work

### Current

- Bundled CTY fallback.
- Club Log `cty.xml` download when an application API key is configured.
- LoTW user-activity download.
- Wavelog catalog download.
- Atomic replacement with last-known-good retention.
- Spot-text award reference extraction.
- Official POTA park, SOTA summit, IOTA group and WWFF directories with per-source byte/count/timestamp status.
- Offline exact confirmation and prefix suggestions directly beneath the compact QSO reference fields.
- Unknown and unavailable references remain preserved; a directory outage never blocks local logging.

### Next

- Restore full WCA/castle ingestion when its official bulk spreadsheet is available again; the published link currently returns 404.

## Verification evidence

Current local evidence at this revision:

- xLog: **38/38** Swift tests pass across seven suites, including the complete nine-award catalogue, Japanese entity dates, case-normalized bands, WAPC matrices, WCSA slot deduplication, database lifecycle, Wavelog reconciliation, CTY resolution, propagation, activation directories, FLEX spot mapping and verified backup recovery.
- xCat: **56/56** Swift tests pass, including CAT/RigCtl session transmit ownership, atomic frequency-plus-mode dispatch, clearing a prior split before a new spot tune and explicit target-band rotor command parsing/gating; read-only short-lived xLog polling disconnects cannot issue a cleanup unkey against an independently keyed Maestro session.
- Windows Remote Station Agent final gate at pushed source `90abbb4` / deployed controller `c49dfd3`: **888 Python**, **105 browser/widget**, **105 MSHV safety**, **210 standalone WindowsAgent**, **117 focused station**, and **1 native widget smoke** test passed. Guarded live acceptance used no PTT, TUNE-start, CWX or RF transmission.
- xCluster: **22/22** Swift tests passing, including the structured xLog handoff and local snapshot contract.
- Signed release builds pass strict `codesign` verification.
- Installed xLog launches and visibly receives the live local xCluster snapshot.
- Operator Desk, hybrid DXCC map, active-band filtering, clean allocation band map and undocked full-window band map were inspected in the running app.
- The installed Reference Data screen showed all 348,973 validated activation records immediately at launch while Wavelog synchronization was still running, proving cached POTA/SOTA/IOTA/WWFF data no longer waits behind network sync.
- The installed release immediately completed a read-only 67,815-contact Wavelog reconciliation; W1AW then resolved to United States / FN31pr through QRZ and the map automatically framed JN88TQ, W1AW and the full path.
- A live 3.698 MHz SP9AQQ band-map spot stayed on Operator Desk, preserved the radio-owned 3.698000 MHz / 80 m / SSB fields, imported POTA PL-2715 and WWFF SPFF-3124, resolved QRZ grid KN09KI, separated exact-call and DXCC history, fitted the map route and brought the rotor onto the 071° short-path target. No RF transmission was triggered.
- The Windows completion record at `om0rx-radio-control` commit `90abbb4` verifies deployed controller `c49dfd3`: coherent combined tune with no mixed pair, persistent Operate intent across allowed/prohibited routes, same-band 30 W Maestro preservation, 20 m/40 m band defaults, matching KPA/KAT routes, final READY/zero-alarm receive state and no RF-producing command. OM0RX-xCat documentation tip `958f54e` records the same protocol contract.

## External acceptance still required

- Live bidirectional edits and deletion reconciliation against the operator's production station profile. Read-only bootstrap/import has been exercised successfully.
- Live Wavelog catalog refresh. Authenticated Club Log CTY and LoTW refresh passed in the installed app on 11 Oct 2026.
- Tune-latency optimization below the accepted coherent-but-slow 7.204-second combined transition, without reintroducing mixed state or weakening interlocks.
- Rotor comparison of displayed SP/LP bearing against the physical station controller.
- Apple notarization and Gatekeeper validation on a clean Mac.

## Release checklist

- [x] Source tree, GPL-3.0-only licence, author and ownership documentation.
- [x] Distinct xLog icon and signed local app bundle.
- [x] Tests green and `git diff --check` clean.
- [x] Operator Desk and undocked map visual acceptance.
- [x] README architecture, setup, screenshots and limitations.
- [x] Final screenshot set refreshed from the current build.
- [x] Impeccable finish review returns SHIP with no blocker.
- [x] Create public `oliverbross/OM0RX-xLog` repository and push `main`.
- [x] Tag and publish xLog `v0.1.0` with the signed macOS archive.
- [x] Tag and publish xLog `v0.2.0` with the Developer ID-signed macOS archive and complete nine-award acceptance evidence.
- [x] Commit/push xCluster snapshot and award-handoff changes.
- [x] Tag and publish xCluster `v0.1.6` with the signed macOS archive.
- [x] Verify public repository descriptions, README rendering and release downloads.

## Priority backlog

### P0 — before calling v0.2 production-ready

1. Reduce the measured 7.204-second guarded combined-tune latency while preserving coherent frequency/mode publication and all station interlocks.
2. Complete external Wavelog catalog and physical rotor acceptance; QRZ, authenticated Club Log CTY, atomic xCat tune and the Windows station route are accepted.
3. Complete an operator-approved live backup/restore recovery drill; the verified implementation and automated round-trip/tamper coverage are complete.
4. Add notarization and clean-Mac Gatekeeper evidence.

### P1 — next functional release

1. Refine compact-logger responsive field priorities below the current two-column Operator Desk breakpoint; the requested three-row surface and keyboard-first field order are complete.
2. Complete the WCA/castle directory once its official bulk source is restored.
3. Dedicated contest, satellite and manual split logging fields/workflows; automatic split import and split-safe next-spot handoff are complete.
4. Complete live action/interlock acceptance and narrow-height responsive polish for the existing station-monitor integration; the rotor card, enlarged propagation header, station controls and KPA500/KAT500 telemetry are implemented without duplicating radio ownership.
5. Configurable regional band-plan allocations.

### P2 — ecosystem consolidation

1. Embed the full xCluster table as an optional xLog workspace while preserving standalone xCluster.
2. Extend the now-accepted xCat/KPA500/KAT500/rotator integration with deeper diagnostics without moving safety ownership into xLog.
3. Extract shared xBridge/xCluster/Wavelog/ADIF components into reusable Swift packages.
4. Extend the local award catalogue when additional programmes have stable, redistributable reference data; Wavelog remains the full cloud award engine.

## Change-control rule

Every newly accepted idea must be added here with a status and acceptance statement before release work continues. Marking an item DONE requires code plus proportionate test or live UI evidence; local tests alone never prove credentials, RF operation, rotor movement, notarization, or public release.
