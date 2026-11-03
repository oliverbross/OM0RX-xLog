# OM0RX-xLog 1.5.4 completion candidate

- Edit all six alert geography criteria per rule, with searchable DX/spotter entities.
- Bind nearby callsigns to the selected radio's RX/passband and current generations.
- Combine compatible IOTA locations while retaining recorded evidence and filters.
- Show active legacy award searches and clear text plus structured conditions together.
- Clear an antenna selection safely and recover stale profile IDs.
- Inspect POTA physical rows, countable contacts, programme records, duplicates,
  unknowns and exclusions against the UTC-day ten-contact threshold. Expansion-only
  threshold cases remain conditional; no portal credit is claimed.

Integrated qualification is pending. See [exact source and evidence](docs/releases/v1.5.4-macos-candidate.md).
No production installation or notarization has occurred; cold first execution
remains unqualified and separate from later warm/control success.

# OM0RX-xLog 1.5.3 candidate (historical reviewed baseline)

- Reuse typed saved filters across Logbook, ADI/ADX exports and exact award evidence.
- Inspect complete-log local WAC/WPX/IOTA/POTA/SOTA/WWFF progress by recorded station, band, mode and role.
- Review geography-aware alerts, accept nearby RX callsigns explicitly, and customize contextual shortcuts.
- Capture antenna/portable context per QSO and preview lossless, bounded multi-park POTA file sets.
- Display retained own-call RBN receivers and edit separate source-attributed visual band-map guides.

Existing native draft, logbook, radio, preferences and backup owners retain authority.
Sponsor eligibility remains accurately bounded. Historical contacts are not retagged.
The candidate indexes stable live-page ordering and restores scoped saved-filter reads in detached Logbook.
Strict guide JSON validation also supports Foundation hosts without CoreFoundation.
RBN map/sidebar/HF share ten-minute source-age expiry, including failed refreshes;
human spot history remains separate. The signed1.5.3 ZIP from `31088202` passed
required CI and representative isolated native upgrade/restart. Cold signed-worker
five-second startup remains unqualified; no installation or notarization is claimed.
See [candidate provenance, validation and remaining boundaries](docs/releases/v1.5.3-macos-candidate.md)
and [operator controls and rollback](docs/help/qlog-selected-workflows.md).

# OM0RX-xLog 1.0.0-beta.3

The third 1.0 beta of the native, local-first OM0RX macOS logbook, focused on faster navigation, correct cluster login ordering, compact operating panels and stable Keychain access across rebuilt workers.

Highlights:

- A complete integrated SQLite logbook that works without Wavelog, plus optional two-way Wavelog v2 synchronization with durable receipts, conflict handling and safe recovery.
- Operator Desk, full QSO editor, previous-QSO history, ADIF import/export, searchable logbook, awards, callsign/DXCC intelligence and configurable QSO detail fields.
- DX Cluster, live spot history, compact age display, Wavelog-compatible status classifications and colours, multi-band maps, world map and optional Maidenhead grid overlay.
- Configured clusters connect automatically by default and request the latest 100 spots after connecting; both behaviours remain user-configurable.
- Cluster startup now delivers the configured callsign before any automatic recent-spots command, preventing `SH/DX/100` from being interpreted as a login callsign.
- Chaser & DX and Awards warm their local retained data after the Operator Desk paints, while network feed refresh remains owned by the visible Chaser screen.
- Callsign Intelligence uses shorter fact boxes and balanced two-row status matrices; the Operator Desk rotor now puts target and bearing information inside a larger dial.
- HF propagation now refreshes automatically on a configurable 5/10/15/30/60-minute interval, without a redundant manual refresh control.
- Wavelog Sync now reads its saved state immediately and remains recoverable on window focus even if native event-listener registration is delayed, keeping schedule and manual-sync controls usable.
- Shared radio and rotor ownership with explicit connect/control actions, readback checks, safe stop handling and offline operation when station hardware is unavailable.
- Resizable and repositionable Operator Desk panels, responsive detached windows, stable row hover geometry and fixed save notifications that do not shift content.
- Spot, radio, synchronization and recovery feedback now floats above the Operator Desk and spot-driven detached windows without resizing or moving the working surface.
- Canvas measurements ignore unchanged dimensions, preventing redundant re-renders and compact-layout flicker during live updates.
- Packaged acceptance verifies the complete essential settings set: Station, Logbook, Wavelog, Sync, Rotator, Radio spots and Workspace.
- Clean macOS Logbook, Online and Window menus with direct Settings access and no obsolete Station Status, Station Identity or Connection Doctor entries.
- The existing worldwide awards research library and native award calculators, with coverage and evidence boundaries documented in `docs/AWARDS_COVERAGE.md`.

This beta prefers the configured Developer ID identity for stable Keychain authorization. Apple notarization remains a separate release gate and is not implied by a valid local signature.
