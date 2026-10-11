# OM0RX-xLog Design System

## Direction

Operate-mode native macOS console: precise, calm and information-rich. The visual world is inherited from the OM0RX suite, not reinvented. xLog should feel like the central desk of the station—fast enough for contest rhythm, readable enough for everyday logging, and never decorative at the expense of state.

## Surfaces

- Canvas `#07111F`; primary panels `#0B1728`; raised controls `#101F34`; separators `#243A55`.
- Primary text `#E6EDF6`; secondary text `#92A7BF`.
- Cyan `#35C8F5` for radio/frequency information, teal `#12D6A0` for connected/saved/confirmed state, amber `#F3B23C` for pending attention, orange `#FF8C00` for worked/unconfirmed, coral `#FF6B5E` for errors, and pink `#F47BC5` only for special/reference classification.
- No ornamental gradients, glass, glow, thick accent rails or card soup.

## Typography

Use the macOS system family throughout. UI labels are compact and semibold where necessary. Callsigns, frequencies, reports and timestamps use monospaced digits or a monospaced face because alignment carries meaning.

## Layout

- A 44-point station rail presents app identity and truthful xCat, Wavelog, QRZ and reference-data state.
- A native sidebar holds the deeper Log QSO, Logbook, map, insights, sync and settings workspaces; it is not the operating layout.
- The default Operator Desk keeps the compact logger, callsign intelligence, station pulse, world map and selected band maps visible simultaneously.
- World Map and Band Maps can be undocked into independent, resizable windows for multi-monitor or tall-spectrum layouts.
- The logging surface uses a primary editor plus a context inspector for previous QSOs and band/mode history; narrow windows stack the inspector below.
- Tabs map directly to QSO, Station, General, Notes and QSL field groups.
- Tables stay dense, use stable columns and reserve colour for semantic values rather than whole-row decoration.
- Maps default to hybrid cartography for geographic legibility. DXCC and spot overlays remain semantic and high-contrast over imagery.
- Band maps use frequency-accurate placement, allocation shading, collision-aware columns and zoom rather than allowing labels to overlap.

## Components and Interaction

- Standard macOS controls are restyled only enough to carry the suite palette.
- Corners use 6–10 point radii for controls and 12 points for major panels.
- Every control has visible hover/focus/disabled/loading/error behaviour.
- Primary actions use teal; destructive actions use coral; secondary actions remain neutral.
- Empty states explain the next useful action. Background work uses inline state or skeletons, not blocking spinners.
- Motion is limited to 150–220 ms state transitions.

## Signature Workflow

The active callsign anchors the screen. Entering it immediately reveals identity, prior contacts and the band/mode matrix while xCat supplies live frequency and mode. Logging writes locally first, clears the entry safely, and shows sync progress without interrupting the next contact.

## Icon

A distinctive macOS icon combining a contact log/ledger with a radio-wave trace and confirmed contact mark. It uses the suite navy/teal/cyan/orange palette, contains no text and must not resemble the xCat antenna/control icon.
