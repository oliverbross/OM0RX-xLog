# Changelog

## Unreleased

## 0.4.0-alpha.36 — 2026-10-17

- Restored the integrated local logbook choice as a prominent Settings → Logbook section, clearly separating local-only operation from optional Wavelog synchronization without changing or migrating existing contacts.
- Removed the redundant Station Status and Station Identity entries from the native Window menu while retaining their internal roles so older saved workspace layouts remain recoverable.

## 0.4.0-alpha.35 — 2026-10-17

- Redesigned Band Maps around a clear vertical frequency ruler, subtle allocation shading and simple unboxed callsign labels using the configured xCluster status colours and compact NC/NM/NB opportunity codes.
- Deduplicated live spots to one marker per normalized callsign and band; the newest report, including a QSY, moves that marker instead of adding another copy.
- Added persistent bottom controls for band, full-band or 1–40 px/kHz resolution, and 15/30/45/60-minute spot age, including direct band switching in the detached window.
- Preserved manually panned or zoomed custom ranges across window resizing while keeping full-band and fixed-resolution views responsive to the available chart size.

## 0.3.0 — 2026-10-12

- Added the complete 190-programme, 22-shared-profile worldwide awards research registry as a validated bundled resource.
- Rebuilt Insights as a searchable and filterable 192-entry awards library, preserving WAPC and WCSA alongside the imported registry.
- Added explicit live-calculation, research-tracking, blocked and historical states with sponsor sources, source dates, open dependencies and purpose/rule/evidence detail.
- Separated worked, evidence-eligible and sponsor-credited totals in every live native rule pack; sponsor credit remains unavailable until an authoritative source is imported.
- Added registry integrity, source URL, profile join, status accounting and delivery-ledger tests, plus a generated per-programme coverage report.
- Kept all non-executable research records fail-closed: they cannot display qualification readiness or masquerade as implemented rules.

## 0.2.3 — 2026-10-12

- Added a repeatable Keychain-backed Apple notarization workflow with mandatory acceptance, stapling, Gatekeeper verification and post-staple archive recreation.
- Removed recursive signing from the packaging step and retained strict deep verification of the finished app bundle.

## 0.2.2 — 2026-10-12

- Pinned GitHub's macOS 14 runner to its installed Xcode 16.2 toolchain so the Swift Testing suite runs in CI as it does in release builds.

## 0.2.1 — 2026-10-12

- Restored Swift 5.10/macOS 14 CI compatibility for semantic QSO timestamp normalization.

## 0.2.0 — 2026-10-12

- Added a complete local award catalogue for AJD, WAJA, JCC, JCG, AJA, WACA, WAGA, WAPC and WCSA.
- Added historical Japanese entity and designation-date handling, case-normalized ADIF bands, WAPC band/mode matrices and WCSA school-slot milestones.
- Bundled the ham-award-tools reference datasets and complete MIT attribution inside the signed application.
- Added native Insights detail views for all nine awards and verified them against the complete 67,823-contact local log.
- Added operator-intelligence summaries, propagation and weather presentation, compact xCluster opportunity classifications and stable graphical HF conditions.
- Added integrated rotor targeting and improved spot-to-radio reliability while retaining xCat as the single radio owner.
- Kept the station sidebar fixed and readable with live KPA500/KAT500 status, power, SWR, band, antenna and amplifier controls.
- Expanded release CI to prove the packaged application contains every award reference and licence resource.

## 0.1.0 — 2026-10-11

- Introduced the native macOS xLog contact editor and local SQLite logbook.
- Added Wavelog API v2 create, update, delete and reconciliation.
- Added QRZ callsign enrichment, CTY classification, LoTW activity and Wavelog catalog refresh.
- Added ADIF import/export with preservation of unknown fields.
- Added xCat live frequency/mode integration and `om0rx-xlog://spot` handoff.
- Added logbook search, previous-QSO context, band/mode matrix and basic station statistics.
- Added QSO editing, confirmed deletion with undo, and visible local/Wavelog conflict resolution.
- Added typed status notifications, improved control contrast and keyboard accessibility.
- Packaged SwiftPM reference resources and verified the signed app launches successfully.
- Added the unified Operator Desk with the logger, station context, world map and selected band maps visible together.
- Added resizable undocked map windows, a hybrid/satellite map, DXCC status overlay and great-circle rotor path with short-/long-path bearings.
- Added multi-band maps with CW/data/phone presets, pan/zoom controls, allocation shading and collision-aware spot placement.
- Bound world-map spots to the active band-map selection with the configured colour for each band, and made undocked band maps fully resizable.
- Added structured POTA, SOTA, IOTA, WWFF and castle-reference handoff from xCluster into ADIF fields.
- Split Operator Desk and undocked band maps into independent persistent workspaces, with optional radio-band following on the desk.
- Added full-height single-row and adaptive-grid layouts plus persistent 80–200% band-map text scaling for 4K displays.
- Made map spots consume xCluster's filtered/sorted snapshot so cluster filters apply consistently throughout the operator desk.
- Hardened Wavelog bootstrap synchronization: complete 5,000-row JSON ID scans combined with 1,000-row ADIF detail scans, stable-snapshot verification before deletion reconciliation, complete pagination, read-first reconciliation, preservation of local-only ADIF fields and full `/api/v2` URL normalization.
- Preserved award references from cluster spots independently of the optional human-readable logging note.
- Combined Wavelog's stable JSON-ID pages with its full ADIF pages so DXCC, country, LoTW and QSL confirmation state are imported instead of appearing as ATNO.
- Cleared only prior auto-populated callsign fields when the call changes, preventing stale QRZ/CTY identity while preserving operator edits.
- Automatically framed the station marker, active DX station and complete geodesic path whenever the resolved callsign changes.
- Restored configured Wavelog state immediately at launch and started the first automatic reconciliation without waiting for the periodic timer.
