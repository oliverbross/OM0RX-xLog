# Changelog

## Unreleased

## 1.0.0-beta.3 — 2026-10-17

- Prevented background services and credential-status checks from presenting repeated macOS Keychain dialogs, stalling the worker, or causing a periodic interface reload. Legacy credentials can be authorized once from a user-started sync or schedule change with **Always Allow**.
- Restored Wavelog parity for cluster callsign and DXCC status by classifying worked/confirmed history with Wavelog's phone, CW, and digital mode groups.
- Fixed macOS cluster startup ordering so the callsign, optional password and skimmer preference are delivered before the automatic `sh/dx/100` request.
- Warmed the retained Chaser snapshot and default Awards catalogue after the Operator Desk paints, without preloading network feeds or keeping hidden screens mounted.
- Reduced Chaser render work by reusing date formatters, memoizing facets and skipping map projection while the map is hidden.
- Made Callsign Intelligence fact boxes about 30% shorter and allowed callsign/DXCC band matrices to use balanced two-row layouts when their panel is wide enough.
- Reworked the Operator Desk rotor into a dial-first layout with callsign, observed bearing, selected SP/LP target and distance inside the dial; SP, LP and Stop remain at the bottom.
- Removed the manual HF propagation refresh controls and added a persisted 5/10/15/30/60-minute automatic refresh interval under Settings > Display, retaining one shared deduplicated native fetch across windows.
- Made Sync load its retained status immediately instead of waiting for native event subscriptions, so a delayed listener can no longer strand setup, scheduling and manual sync in a disabled `Reading...` state.
- Prefer stable Developer ID signing with stable helper identifiers on configured Macs so Keychain authorization survives rebuilt workers instead of following changing ad-hoc hashes.

## 1.0.0-beta.2 — 2026-10-17

- Kept the Operator Desk stationary while spot activation, radio readback, synchronization, or recovery feedback appears by moving actionable notices into a non-layout overlay.
- Applied the same non-shifting feedback behavior to detached Log QSO, Cluster, Band Maps, World Map, and Chaser & DX windows.
- Prevented redundant Canvas size updates and kept the layout toolbar on a stable single text line, reducing avoidable re-renders and compact-layout flicker.
- Added packaged-app acceptance for the stable feedback layer and the essential Station, Logbook, Wavelog, Sync, Rotator, Radio spots, and Workspace settings sections.

## 1.0.0-beta.1 — 2026-10-17

- Promoted the complete local-first xLog desktop application to its first 1.0 beta, including the integrated logbook, optional Wavelog synchronization, ADIF interchange, cluster, maps, awards and station workflows.
- Consolidated the macOS Logbook, Online and Window menus and retained direct Settings access without duplicate or obsolete menu entries.
- Completed the configurable Operator Desk and detached-window sizing work, including resizable panels, stable tables, compact Callsign Intelligence, Previous QSOs, Rotor and Propagation layouts, and non-shifting save feedback.
- Matched Wavelog call/DXCC spot classification and default colours while preserving user palette overrides; corrected band-plan mode classification and duplicate band-map spots.
- Enabled default-on configured cluster startup with `sh/dx/100`, while preserving offline-safe radio and rotor ownership, readback and recovery barriers.
- Repaired stale integration fixtures uncovered by the release review so the full renderer suite exercises the current rotor schema, startup policy, compact radio selector and Wavelog-compatible status model.

## 0.4.0-alpha.57 — 2026-10-17

- Added an optional Maidenhead locator grid to the World Map, using Wavelog's zoom-dependent field, square and subsquare calculation.
- Added a remembered Grid toggle to the map controls; the overlay remains off by default and redraws only after camera movement.
- Styled grid lines and labels in xLog's cyan map palette without obscuring spot selection or DXCC overlays.

## 0.4.0-alpha.56 — 2026-10-17

- Reflowed Callsign Intelligence facts into a balanced three-column first row and two-column second row across the Operator Desk, custom canvas and detached window.
- Centered fact labels and values, and kept Zones and Distance on one line without overflowing their boxes.

## 0.4.0-alpha.55 — 2026-10-17

- Matched Wavelog's exact band-and-mode call and DXCC classification model: New Callsign/New DXCC, Worked and Confirmed.
- Matched Wavelog's default spot colours: unworked `#CC372D`, worked `#E5A50A` and confirmed `#90EE90`, while retaining user-defined colour overrides.
- Migrated saved xLog filters, palettes and DX alert rules from the former expanded status taxonomy without discarding custom settings.

## 0.4.0-alpha.54 — 2026-10-17

- Connect configured DX clusters automatically when xLog starts, with a default-on Settings control.
- Request the latest 100 DX spots with `sh/dx/100` after each successful cluster connection, with a separate default-on Settings control.

## 0.4.0-alpha.53 — 2026-10-17

- Added one native Online menu before Window with direct access to xLog’s existing Wavelog, QRZ, Club Log and online reference-data workflows.
- Each action opens the relevant existing Settings section; Wavelog synchronization retains the integrated-logbook safety gate.
- Kept unsupported LoTW/eQSL account actions and duplicate DX Cluster, Logbook and Settings entries out of the menu.

## 0.4.0-alpha.52 — 2026-10-17

- Moved the single native Logbook menu directly after File instead of leaving it among the later workspace menus.
- Expanded it with existing xLog workflows: Operator Desk, Log QSO, Logbook, a detached Logbook window, ADIF import and export, Wavelog synchronization, and Awards.
- Kept every menu action connected to an existing navigation or window route; no disabled placeholders or duplicate Logbook submenus were added.

## 0.4.0-alpha.51 — 2026-10-17

- Replaced the cluster clock-time column with a compact live `For` age on both the Operator Desk and detached Cluster window.
- Kept spot ages current without waiting for another cluster message, using `Now`, minutes, hours and days as appropriate.
- Preserved the existing internal column identity so saved visibility, order and width preferences continue to work.

## 0.4.0-alpha.50 — 2026-10-17

- Made the detached Propagation window open at a compact content-fitting height instead of leaving a large empty area below the forecast.
- Replaced the generic 480-pixel detached-window floor with a shared Propagation-specific minimum, including geometry restoration, so the window can be resized shorter without snapping back.

## 0.4.0-alpha.49 — 2026-10-17

- Removed Connection Doctor from the native Window menu.
- Retained its internal window role only for compatibility with previously saved workspace layouts.

## 0.4.0-alpha.48 — 2026-10-17

- Reworked the detached Rotor window into a compact operating layout with the compass and bearing on the left and automatic-rotor controls on the right.
- Removed the redundant Rotor, Connection, Generation and Position observed diagnostic rows while preserving explicit stop and automatic-control errors.
- Kept the rotor controls usable in narrow windows with a responsive single-column fallback.

## 0.4.0-alpha.47 — 2026-10-17

- Centered the Zones and Distance facts as a balanced pair in the detached Callsign Intelligence window.
- Kept the callsign and DXCC matrices side by side at ordinary compact-window widths so the content fits without forcing the whole window to scroll.
- Confined overflow to the intelligence panel only at genuinely small sizes and added a compact-height layout for short restored windows.

## 0.4.0-alpha.46 — 2026-10-17

- Fixed the detached Previous QSOs window so it fits the available macOS window height instead of inheriting the main application's 640-pixel minimum.
- Removed the unnecessary outer page scrollbar; larger histories now scroll only inside the bordered contacts table while the heading and window frame remain stationary.

## 0.4.0-alpha.45 — 2026-10-17

- Replaced the oversized shared-radio explanation with a compact active-radio status and a contextual switch action.
- Kept the observed working radio visible when the secondary selection snapshot is temporarily unavailable; recovery is now a small retry control instead of a false radio-unavailable warning.
- Removed duplicate requested-radio, rotor-retention and successful-selection receipt text from the provider row.

## 0.4.0-alpha.44 — 2026-10-17

- Replaced layout-shifting save confirmations with compact fixed overlays that disappear after 1.5 seconds without moving page content.
- Applied contextual save feedback across Settings, credentials, Sync, Rotator, Workspace, radio spots, cluster settings, saved filters, station connection setup and DX alert rules.
- Kept failures and receipt-recovery controls explicit while separating them from ordinary successful-save feedback.

## 0.4.0-alpha.43 — 2026-10-17

- Centered Station identity labels and editable values for a cleaner, more consistent settings layout.
- Generalized automatic transmit-power capture so explicit measured-watt telemetry from a radio or amplifier can use the same freshness, session and provenance safeguards.
- Kept radio drive percentages separate from measured output watts; the configured default remains the fallback and manual TX power remains authoritative.

## 0.4.0-alpha.42 — 2026-10-17

- Fixed the Operator Desk world map after route returns by repairing automatic camera fits that were calculated against MapLibre's temporary 400×300 construction viewport.
- Disabled wrapped world copies so a transient or unusually shallow viewport cannot repeat the same geography across the map.
- Preserved operator-controlled camera position during ordinary window, canvas and map/logbook split resizing.

## 0.4.0-alpha.41 — 2026-10-17

- Added a persistent Log QSO canvas where Active contact, QSO details, Callsign intelligence, Previous QSOs and Band / mode matrix can be repositioned and resized in an explicit keyboard-accessible Arrange mode.
- Added Settings → Display controls for choosing the optional fields shown in QSO details. Core contact fields remain visible, hidden values remain stored, and the selection synchronizes across app windows.
- Added a responsive stacked fallback for narrow QSO windows and retained strict detached-window bundle budgets with a narrow allowance for the validated preference controls.

## 0.4.0-alpha.40 — 2026-10-17

- Removed Logbook row bounce by reserving the upload follow-up control at a fixed size and revealing it with CSS instead of inserting and removing it on every hover.
- Pinned Operator Desk cluster rows to a fixed height and limited hover feedback to an inset paint effect so moving between spots cannot alter table geometry.

## 0.4.0-alpha.39 — 2026-10-17

- Made Spot History easier to scan by showing band and mode as compact, separately coloured labels using the same established palette as DX Cluster, Logbook and Previous QSOs.

## 0.4.0-alpha.38 — 2026-10-17

- Made Chaser & DX paint retained local results before starting network work, while reducing each automatic feed cycle from five full result projections to one priority update plus one coalesced batch.
- Reduced 68,142-contact cold reference-history projection time from 2.315 seconds to 0.059 seconds in the isolated production-size benchmark, with reopened persisted-cache reads at 0.005 seconds.
- Added a revision-safe persisted opportunity-history cache and a partial SQLite index that scans only contacts carrying POTA, SOTA, IOTA, WWFF or castle references.

## 0.4.0-alpha.37 — 2026-10-17

- Moved the single Settings command into the standard OM0RX-xLog application menu on macOS, preserving Command-, and removing the duplicate Settings entry from Station.
- Clarified every detached-window command in Window with an `Open … Window` action label so navigation and window creation no longer appear as duplicate menu items.

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
