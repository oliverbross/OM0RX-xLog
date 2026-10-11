# OM0RX-xLog project status

Last updated: 2026-10-11  
Product owner and maker: **Oliver Bross OM0RX**  
Repository: `oliverbross/OM0RX-xLog` (public repository creation is a v0.1.0 release gate)

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

## v0.1.0 implementation matrix

| Area | Status | Current evidence / remaining acceptance |
|---|---|---|
| Native macOS application | DONE | SwiftUI/AppKit, macOS 13+, signed `.app`; no embedded web app. |
| OM0RX visual identity | DONE | Navy/teal/cyan/orange/pink system, distinct xLog ledger icon, dense operator layout. |
| Local SQLite authority | DONE | WAL database, stable local UUID, Wavelog ID, JSON field bag, dirty state, tombstones. |
| Offline logging | DONE | New/edit/delete/search work locally without Wavelog. |
| ADIF import/export | DONE | Unknown/custom fields survive round trips. |
| Wavelog create/read/update/delete | DONE | Built-in API v2 client and read-first reconciliation implemented; accepts site or full API-v2 URLs and does not require xBridge. |
| Two-sided sync conflict safety | DONE | Remote preflight occurs before push; last-synced baseline and explicit Keep local / Use Wavelog UI. |
| Field-level merge UI | PARTIAL | Conflicts preserve complete local and remote records; per-field merge selection remains planned. |
| Durable retry/outbox visibility | PARTIAL | Dirty rows persist for retry and sync state is visible; richer per-item retry diagnostics remain planned. |
| Complete Wavelog-style form | PARTIAL | QSO, references, station, general, notes and QSL groups exist. Dedicated contest exchanges, satellite fields and split-operation workflow remain planned. |
| Compact three-row QSO entry | PLANNED | Replace the oversized callsign row with: (1) call/date/time/frequency/band/mode/RST, (2) name/comment/grid/country/county, and (3) POTA/SOTA/IOTA/WWFF/castle and other priority references. Auto-filled QRZ/CTY/spot values must remain visibly distinguishable and never overwrite operator edits. |
| QRZ enrichment | PARTIAL | Keychain credentials and live lookup are exercised. Callsign changes clear only prior automatic values, preserving operator edits. Reusable session/cache controls and personal-field privacy choices remain planned. |
| CTY / Club Log / LoTW / catalog | PARTIAL | Atomic last-known-good downloads exist. Conditional ETag/Last-Modified requests, detailed version UI and authenticated live acceptance remain. |
| xCat radio integration | DONE | Loopback RigCtlD reads live frequency/mode and requests both on spot handoff. No direct radio ownership. |
| xCluster handoff | DONE | Callsign, frequency, mode, comment and detected special badges cross the `om0rx-xlog://spot` contract. |
| Award reference promotion | DONE | Tested POTA, SOTA, IOTA, WWFF and castle parsing populates the corresponding ADIF fields without inventing missing IDs. |
| Official award-directory cache | PLANNED | See [ROADMAP.md](ROADMAP.md): validate/enrich references from official programme data with atomic updates. |
| Operator Desk | DONE | Logger, callsign intelligence, station pulse, world map and selected band maps are simultaneously visible. |
| World map | DONE | Hybrid default plus satellite/standard styles, live spot layer, DXCC entity layer and semantic legends. |
| DXCC overlay | DONE | CTY-derived entity centroids; grey needed, orange worked, green confirmed. Polygon boundaries remain a later enhancement if a suitable licensed DXCC geometry source is adopted. |
| Rotor path | DONE | Geodesic station-to-DX line plus distance and short-/long-path bearings; requires the configured station grid. The camera auto-fits both stations and the complete path. Core math is tested. |
| Solar / greyline overlay | PLANNED | Show the current subsolar point and a separately switchable day/night terminator. Keep Sun, station, DXCC and live-spot layers independently legible and toggleable. |
| Band-filtered map spots | DONE | Map follows the Operator Desk selection and xCluster's filtered, sorted and display-limited snapshot, with each band's configured colour. |
| Band maps | DONE | Independent desk/detached selections; desk radio-follow; detached single-row/adaptive-grid layouts; full-band/CW/data/phone presets, pan, zoom, allocation lanes and xCluster colours. |
| Dense spot layout | DONE | Collision-aware dynamic columns replace overlapping labels. |
| Resizable / undocked maps | DONE | Separate World Map and Band Maps windows. Band maps consume available width and height; text scales persistently from 80–200% for 4K displays. |
| Previous-QSO context | DONE | Callsign history and worked/confirmed band-mode matrix beside the active QSO. |
| Basic statistics | DONE | Local QSO, confirmation, year and DXCC counts. |
| Backup and restore | PLANNED | Add verified database backup, restore preview and recovery documentation. |
| Embedded cluster table | PLANNED | Operator Desk consumes xCluster's local classified feed; a complete embedded cluster table remains optional later scope. |
| Embedded station monitor | PLANNED | Surface xCat/KPA/KAT/rotator state while keeping those processes isolated. |
| Station-monitor consolidation | PLANNED | Add a compact rotor card between Callsign Intelligence and Station Pulse; show HF propagation in the header; add Operate/Tune, TX power, SWR and RF drive beneath Settings; then show KPA500 and KAT500 state. Reuse the existing station-monitor/xCat data path and retain one control owner. |

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
- Explicit split-operation controls and xCat split-state import.
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

### Next

- Official POTA park, SOTA summit, IOTA group, WWFF and castle directories.
- Per-source schema validation, record-count sanity checks, version/retrieval UI and automatic refresh cadence.
- ETag/Last-Modified conditional requests and rollback evidence.
- Name/coordinate enrichment after a valid reference is detected.
- No directory outage may block local logging; unrecognized values must remain preserved.

## Verification evidence

Current local evidence at this revision:

- xLog: **12/12** Swift tests passing, including database lifecycle, local-only ADIF preservation during remote merges, complete multi-page sync, fail-closed unstable-pagination handling before deletion reconciliation, API-v2 URL normalization, CTY resolution, sync-conflict preflight, great-circle calculations and award parsing.
- xCluster: **22/22** Swift tests passing, including the structured xLog handoff and local snapshot contract.
- Signed release builds pass strict `codesign` verification.
- Installed xLog launches and visibly receives the live local xCluster snapshot.
- Operator Desk, hybrid DXCC map, active-band filtering, clean allocation band map and undocked full-window band map were inspected in the running app.
- The installed release immediately completed a read-only 67,815-contact Wavelog reconciliation; W1AW then resolved to United States / FN31pr through QRZ and the map automatically framed JN88TQ, W1AW and the full path.
- No RF transmission or live spot tune was triggered during this acceptance pass.

## External acceptance still required

- Live bidirectional edits and deletion reconciliation against the operator's production station profile. Read-only bootstrap/import has been exercised successfully.
- Live Club Log authenticated CTY refresh and Wavelog catalog refresh.
- Physical-radio confirmation that xCat changes both frequency and mode for xLog handoffs without interlock regression.
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
- [ ] Create public `oliverbross/OM0RX-xLog` repository and push `main`.
- [ ] Tag and publish xLog `v0.1.0` with the signed macOS archive.
- [ ] Commit/push xCluster snapshot and award-handoff changes.
- [ ] Tag and publish xCluster `v0.1.6` with the signed macOS archive.
- [ ] Verify public repository descriptions, README rendering and release downloads.

## Priority backlog

### P0 — before calling v0.1 production-ready

1. Complete external Wavelog/QRZ/Club Log and physical xCat/rotor acceptance.
2. Add database backup/restore and a recovery drill.
3. Add notarization and clean-Mac Gatekeeper evidence.

### P1 — next functional release

1. Redesign Active QSO as the compact three-row operator entry surface described above, with keyboard-first field order and responsive field priorities.
2. Official award-directory cache and reference enrichment.
3. Dedicated contest, satellite and split logging fields/workflows.
4. Integrate the station-monitor presentation: rotor card, header propagation, station controls, KPA500 and KAT500 telemetry, without duplicating radio ownership.
5. Field-by-field sync conflict merge.
6. Conditional reference-data downloads and visible dataset versions.
7. Configurable regional band-plan allocations.

### P2 — ecosystem consolidation

1. Embed the full xCluster table as an optional xLog workspace while preserving standalone xCluster.
2. Surface xCat station monitor, KPA500, KAT500, Windows Agent and rotator state inside xLog without moving safety ownership.
3. Extract shared xBridge/xCluster/Wavelog/ADIF components into reusable Swift packages.
4. Expand local award/statistics views while Wavelog remains the full cloud award engine.

## Change-control rule

Every newly accepted idea must be added here with a status and acceptance statement before release work continues. Marking an item DONE requires code plus proportionate test or live UI evidence; local tests alone never prove credentials, RF operation, rotor movement, notarization, or public release.
