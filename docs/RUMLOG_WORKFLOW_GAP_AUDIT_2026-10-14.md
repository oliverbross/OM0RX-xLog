# RUMlog workflow comparison — 14 October 2026

This is an evidence-backed comparison, not a claim of feature parity.
Implementation uses xLog's own code. No RUMlog code, artwork, settings or logbook
data was copied. No station command, credential change or log mutation was made.

## Evidence and limits

- Installed reference: RUMlogNG 6.5.1, build 727 (bundle metadata).
- Read-only native inspection observed the running Band Map window, top-level
  menus and expanded Window menu. A later local resource/default-key inventory
  inspected names only; it did not open a log, reveal a saved value or change a
  RUMlog preference.
- Official online documentation was read as a fallback. Its contents page labels
  the documentation version 6.4; documentation is not proof of installed 6.5.1
  behavior. Local bundled-help reads were unavailable through the context tool.
- Original comparison baseline: alpha.15, source `a2c0446`. Alpha.27 is the
  installed baseline; alpha.28 remains source-only until final review, packaging
  and installed visual acceptance.
- A further read-only inspection attempt confirmed RUMlogNG is already running,
  but its native accessibility read timed out again before exposing Settings.
  No RUMlog setting or logbook was changed.

The local inventory confirms explicit WSJT-X UDP address/port, CAT, callsign
checking, QSO-save and activity-window preferences; separate N1MM/Fldigi network
inputs; Club Log, LoTW and eQSL upload/download surfaces; and multiple independent
Band Map windows. These are useful workflow signals, not permission to copy
RUMlog implementation, artwork, text or data.

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
| Independent named windows; saved size/position | Alpha.28 source now has nineteen consistent task roles, thirteen independently keyed Band Maps, saved geometry and a persistent Canvas/Separate Windows choice that restores the exact prior Canvas preset. Packaged simultaneous-window, multiple-display and main-hidden acceptance remains open. |
| Adjustable, persistent table columns | Logbook and Spot History now have separate docked/detached visibility plus bounded pointer, keyboard and numeric width controls. Callsign/identity remains visible. Column ordering remains a follow-up. [Logbook Table](https://dl2rum.de/RUMlogNG/docs/en/pages/LogbookTable.html) |
| Import with explicit duplicate/update policy | xLog now previews bounded ADI/ADX input, reports invalid records, shows insert/duplicate counts and applies only explicitly selected update fields against frozen revision-checked targets. Sources through `79ce6b9` cover every published ADIF 3.1.7 record scalar type family at both ADX boundaries, including ordinary/multiline/international strings, credit lists and sponsored-award lists, without weakening ADI fallback. Packaged import/export roundtrip acceptance remains open. [ADIF Import](https://dl2rum.de/RUMlogNG/docs/en/pages/AdifImport.html) |
| Export selected or searched contacts | xLog now freezes a consistent all/filtered/selected snapshot before paged ADI export. ADX export and activity-specific formats remain open. [Export](https://dl2rum.de/RUMlogNG/docs/en/pages/Export.html) |
| Settings follow task boundaries | Documented RUMlog groups include General, QRGs, Modes, DXCC, DX Cluster and TRCVR. xLog already separates station, services, reference data, independent rotator, CW, display, workspace and backups. Audit editable band/mode choices and the actual settings interaction before changing taxonomy. Retain Keychain storage, not the older credential-storage model described in that manual. [First Steps](https://dl2rum.de/RUMlogNG/docs/en/pages/FirstSteps.html) |
| Radio selection/configuration versus actual connection | RUMlog documents an explicit CAT enable choice, interface selection and per-radio options. xLog must retain its separate active/viewed provider, explicit Apply/Connect and independent rotor ownership. Settings navigation must never reconnect or control equipment. Physical Mac acceptance remains separate. [CAT Settings](https://dl2rum.de/RUMlogNG/docs/en/pages/CAT-Prefs.html) |
| Cluster configuration separate from display filters | RUMlog documents connection profiles, display filtering and a terminal retaining incoming data. xLog has profile/filter/console paths and its separate Spot History archive. Verify changes do not disconnect unrelated sockets or erase received/history records. [DX Cluster Settings](https://dl2rum.de/RUMlogNG/docs/en/pages/Dx-Cluster-Setting.html) |
| Receive WSJT-X logged contacts | Commit `d9b46da` adds an opt-in receive-only UDP listener for the official big-endian Logged ADIF message type 12. It accepts loopback or IPv4 multicast, starts only from saved explicit enablement, writes through xLog's local semantic duplicate boundary and never sends a WSJT-X packet or station command. Native parser/import coverage is 5/5 and UI/settings coverage is 24/24; live WSJT-X acceptance remains open. [WSJT-X protocol source](https://sourceforge.net/p/wsjt/wsjtx/ci/master/tree/Network/NetworkMessage.hpp) |
| Optional online log services | Keep Wavelog as the richer two-way reconciliation service. QRZ documents an ADIF-over-POST Logbook API with per-logbook keys; Club Log documents separate real-time and batch APIs and requires a product API key plus user Application Password; HRDLOG provides a dedicated upload code. Implement these as independent durable upload adapters, never as assumed two-way sync. Club Log must disable automatic delivery immediately on HTTP 403, and no connector should ship before fixture, durable receipt and live account acceptance. [QRZ API](https://www.qrz.com/docs/logbook/QRZLogbookAPI.html) · [Club Log API keys](https://clublog.freshdesk.com/support/solutions/articles/54910-api-keys) · [Club Log upload safety](https://clublog.freshdesk.com/support/solutions/articles/54905) |

## Large requirements remain open

1. Packaged all-window acceptance: simultaneous roles, multiple display scales,
   geometry recovery and main-hidden operation.
2. Performance: packaged local Save latency under sync load, cold Awards/startup,
   selected-feed first paint and realistic large-log percentile measurements.
3. Sync: native completion notifications without the main renderer, explicit
   conflict/held-record visibility and two-way live acceptance without synthetic
   operator contacts. The fresh alpha.15 read-only local snapshot has 67,972
   mapped contacts and no dirty rows/outbox/conflicts, up from 67,970 at install;
   that is not a direct remote comparison or blanket two-way/hardware acceptance.
4. Finish DATA-10 schema/packaged roundtrip and production capability for optional
   cloud backups.
5. Add optional QRZ/Club Log/HRDLOG delivery only behind durable per-service
   receipts, Keychain credentials, bounded retry and truthful upload-only labels.
6. Audit contest, QSL and alert workflows in bounded read-only stages before
   selecting further implementations.

RUM-01 and RUM-02 are **source complete at the read-only comparison boundary**.
RUM-03 remains an ongoing sequence of independently implemented, reviewed and
separately accepted slices; WSJT-X receive-only intake is the latest completed slice.
