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
