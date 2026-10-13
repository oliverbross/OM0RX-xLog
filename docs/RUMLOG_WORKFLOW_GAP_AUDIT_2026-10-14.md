# RUMlog workflow comparison — 14 October 2026

This is a partial evidence-backed comparison, not a claim of feature parity.
Implementation uses xLog's own code. No RUMlog code, artwork, settings or logbook
data was copied. No station command, credential change or log mutation was made.

## Evidence and limits

- Installed reference: RUMlogNG 6.5.1, build 727 (bundle metadata).
- Read-only native inspection observed the running Band Map window, top-level
  menus and expanded Window menu. Subsequent accessibility and screenshot calls
  timed out. The Settings window and remaining menu contents were **not** inspected.
- Official online documentation was read as a fallback. Its contents page labels
  the documentation version 6.4; documentation is not proof of installed 6.5.1
  behavior. Local bundled-help reads were unavailable through the context tool.
- Original comparison baseline: alpha.15, source `a2c0446`. Alpha.16 is now
  installed (source `03840acb`), adding independent Spot History and Logbook column
  controls. The user is testing that build while later window work remains source-only.
- A further read-only inspection attempt confirmed RUMlogNG is already running,
  but its native accessibility read timed out again before exposing Settings.
  No RUMlog setting or logbook was changed; the Settings inspection gate remains open.

## Native menu observations

The observed top-level menu order was RUMlogNG, Edit, Logbook, QSO, QSL, Contest,
CW, Transceiver, Online, Window, Help. Window groups normal macOS placement and
closure actions with named operating surfaces: main logging, entity/QSO search,
band maps (including New band map), network, RTTY, awards, CW tools, cluster
terminal, DX spots, maps/grayline, sun and calculations. Awards has individual
entity, zone, reference and regional views. Disabled menu items remain visible.

xLog should preserve familiar naming and discoverability without exposing dead
commands. Its current native menu can route all registered screens, but routing
to the main window is not equivalent to opening an independent window. Do not
remove the fallback sidebar until navigation, keyboard access and main-window
recovery are accepted on Mac. Do not add empty QSL/Contest/Online menu categories
merely to look like RUMlog.

## Prioritized gaps

| Requirement / useful convention | xLog evidence and next acceptance |
| --- | --- |
| Independent named windows; saved size/position | Alpha.15 supports seven roles: Log QSO, Logbook, Awards, DX Cluster, World Map, Band Maps, Monitor. Fourteen panel roles lack an independent implementation. Spot History is the next source slice. Maps/Monitor still depend on main-renderer projections. Keep the full Windowed preset disabled until its actual role inventory and main-absent lifecycle work. |
| Adjustable, persistent table columns | RUMlog documents width, ordering and header visibility controls. xLog's current source adds visible columns, bounded keyboard/pointer resizing and separate docked/detached preferences, with Callsign retained. Ordering and desk-specific context remain follow-up; map/logbook stacking is still open. [Logbook Table](https://dl2rum.de/RUMlogNG/docs/en/pages/LogbookTable.html) |
| Import with explicit duplicate/update policy | RUMlog documents ADI/ADX, duplicate checking and choosing fields for an update. xLog already has bounded ADI batches and semantic duplicate suppression. Import preview, explicit update policy, ADX and stronger parser/partial-result review remain open. Current UI immediately imports after file selection; do not describe it as a preview workflow. [ADIF Import](https://dl2rum.de/RUMlogNG/docs/en/pages/AdifImport.html) |
| Export selected or searched contacts | RUMlog documents selected-contact ADI/ADX export, search CSV and activity-specific output. xLog currently exports the complete log through paged ADI reads. Add explicit all/filtered/selected scope and a consistent export snapshot so concurrent sync cannot shift pages. Activity formats need their own field/roundtrip tests. [Export](https://dl2rum.de/RUMlogNG/docs/en/pages/Export.html) |
| Settings follow task boundaries | Documented RUMlog groups include General, QRGs, Modes, DXCC, DX Cluster and TRCVR. xLog already separates station, services, reference data, independent rotator, CW, display, workspace and backups. Audit editable band/mode choices and the actual settings interaction before changing taxonomy. Retain Keychain storage, not the older credential-storage model described in that manual. [First Steps](https://dl2rum.de/RUMlogNG/docs/en/pages/FirstSteps.html) |
| Radio selection/configuration versus actual connection | RUMlog documents an explicit CAT enable choice, interface selection and per-radio options. xLog must retain its separate active/viewed provider, explicit Apply/Connect and independent rotor ownership. Settings navigation must never reconnect or control equipment. Physical Mac acceptance remains separate. [CAT Settings](https://dl2rum.de/RUMlogNG/docs/en/pages/CAT-Prefs.html) |
| Cluster configuration separate from display filters | RUMlog documents connection profiles, display filtering and a terminal retaining incoming data. xLog has profile/filter/console paths and its separate Spot History archive. Verify changes do not disconnect unrelated sockets or erase received/history records. [DX Cluster Settings](https://dl2rum.de/RUMlogNG/docs/en/pages/Dx-Cluster-Setting.html) |

## Large requirements remain open

1. All-window ownership: automatic behavior, map/intelligence projections, every
   role, geometry/monitor recovery and main-window-absent operation.
2. Performance: packaged local Save latency under sync load, cold Awards/startup,
   selected-feed first paint and realistic large-log percentile measurements.
3. Sync: native completion notifications without the main renderer, explicit
   conflict/held-record visibility and two-way live acceptance without synthetic
   operator contacts. The fresh alpha.15 read-only local snapshot has 67,972
   mapped contacts and no dirty rows/outbox/conflicts, up from 67,970 at install;
   that is not a direct remote comparison or blanket two-way/hardware acceptance.
4. ADIF preview/scope/roundtrip and safe optional cloud backup destinations.
5. Clear after QSY: authoritative RX observation, shared draft/editor veto and
   revision-fenced native clear. A display telemetry change must not directly
   call the existing manual Clear operation. No non-working checkbox is added.
6. Finish native RUMlog Settings/remaining-menu inspection; audit contest, QSL and
   alert workflows in bounded read-only stages before selecting implementations.

RUM-01 is now **partial** (native Window/menu inventory plus official docs);
RUM-02 is **partial** (this prioritized gap comparison); RUM-03 remains an ongoing
sequence of independently implemented, reviewed and separately accepted slices.
