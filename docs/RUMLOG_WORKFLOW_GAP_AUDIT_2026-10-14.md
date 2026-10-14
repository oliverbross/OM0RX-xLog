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
- Original comparison baseline: alpha.15, source `a2c0446`. Signed/notarized
  alpha.29, source `db7ed47`, is now the installed xLog baseline.
- A 15 October read-only native accessibility inspection opened the installed
  RUMlogNG 6.5.1 Settings window successfully. It inspected only visible labels,
  control types and menu structure, then closed Settings. No field, preference,
  logbook, connection, credential or device state was changed.

The local inventory confirms explicit WSJT-X UDP address/port, CAT, callsign
checking, QSO-save and activity-window preferences; separate N1MM/Fldigi network
inputs; Club Log, LoTW and eQSL upload/download surfaces; and multiple independent
Band Map windows. These are useful workflow signals, not permission to copy
RUMlog implementation, artwork, text or data.

The live Settings inspection confirmed separate General, TX 1, TX 2,
microHAM/Fldigi, CW, Phone, QSL, LoTW/eQSL, QRGs, Modes/Sat, DX Cluster,
DX Alarm, DXCC, Databases and UDP tabs. General groups operator identity,
units/twilight/date/table sizing, user ADIF-field mappings and auto-start items.
QRGs exposes editable band edges and CW/Data/Phone segment boundaries;
Modes/Sat exposes explicit enabled-mode/submode and satellite lists. UDP groups
Fldigi-compatible spots, N1MM radio/spot/app information, Flex/ADIF and WSJT-X
inputs with separate save/callsign/PTT/CAT choices. These observations identify
workflow candidates only; xLog must keep its own data model and stronger
least-authority/device fences.

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
| Import with explicit duplicate/update policy | xLog now previews bounded ADI/ADX input, reports invalid records, shows insert/duplicate counts and applies only explicitly selected update fields against frozen revision-checked targets. Sources through `79ce6b9` cover every published ADIF 3.1.7 record scalar type family at both ADX boundaries without weakening ADI fallback. Alpha.29 passes packaged ADX roundtrip and installed 100,002-record functional acceptance. [ADIF Import](https://dl2rum.de/RUMlogNG/docs/en/pages/AdifImport.html) |
| Export selected or searched contacts | xLog freezes a consistent all/filtered/selected snapshot before paged ADI or ADX export. Packaged ADX semantic roundtrip passes; activity-specific formats remain a separate prioritization decision. [Export](https://dl2rum.de/RUMlogNG/docs/en/pages/Export.html) |
| Settings follow task boundaries | Installed RUMlog Settings confirms General, QRGs, Modes/Sat, DXCC, DX Cluster and device/service-specific groups. xLog already separates station, services, reference data, independent rotator, CW, display, workspace and backups. Editable band-edge/mode visibility is now evidenced as a candidate, not an automatic taxonomy change. Retain Keychain storage and xLog's revision/authority boundaries. [First Steps](https://dl2rum.de/RUMlogNG/docs/en/pages/FirstSteps.html) |
| Radio selection/configuration versus actual connection | RUMlog documents an explicit CAT enable choice, interface selection and per-radio options. xLog must retain its separate active/viewed provider, explicit Apply/Connect and independent rotor ownership. Settings navigation must never reconnect or control equipment. Physical Mac acceptance remains separate. [CAT Settings](https://dl2rum.de/RUMlogNG/docs/en/pages/CAT-Prefs.html) |
| Cluster configuration separate from display filters | RUMlog documents connection profiles, display filtering and a terminal retaining incoming data. xLog has profile/filter/console paths and its separate Spot History archive. Verify changes do not disconnect unrelated sockets or erase received/history records. [DX Cluster Settings](https://dl2rum.de/RUMlogNG/docs/en/pages/Dx-Cluster-Setting.html) |
| Receive WSJT-X logged contacts | Commit `d9b46da` adds an opt-in receive-only UDP listener for the official big-endian Logged ADIF message type 12. It accepts loopback or IPv4 multicast, starts only from saved explicit enablement, writes through xLog's local semantic duplicate boundary and never sends a WSJT-X packet or station command. Native parser/import coverage is 5/5 and UI/settings coverage is 24/24; live WSJT-X acceptance remains open. [WSJT-X protocol source](https://sourceforge.net/p/wsjt/wsjtx/ci/master/tree/Network/NetworkMessage.hpp) |
| Optional online log services | QRZ now has a source-only INSERT foundation with a separate vault key, exact-revision/payload claims, durable receipts, ambiguous-outcome no-replay and bounded 429-only retry. It is not wired to settings or a scheduler and made no live request; explicit new-contact enrollment and live account acceptance remain gates. Keep Wavelog as the richer two-way reconciliation service. Club Log and HRDLOG remain unimplemented independent adapters; Club Log must disable automatic delivery immediately on HTTP 403. [QRZ acceptance](QRZ_UPLOAD_FOUNDATION_ACCEPTANCE_2026-10-15.md) · [QRZ API](https://www.qrz.com/docs/logbook/QRZLogbookAPI.html) · [Club Log API keys](https://clublog.freshdesk.com/support/solutions/articles/54910-api-keys) · [Club Log upload safety](https://clublog.freshdesk.com/support/solutions/articles/54905) |

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
4. Finish DATA-10 live-sync acceptance and production capability for optional
   cloud backups. Packaged ADX roundtrip and 100,002-record functional acceptance
   pass in alpha.29.
5. Finish QRZ opt-in UI, new-contact enrollment, native scheduling and live
   account acceptance; add Club Log/HRDLOG independently behind the same durable
   receipt, vault, bounded-retry and truthful upload-only boundaries.
6. Audit contest, QSL and alert workflows in bounded read-only stages before
   selecting further implementations.

RUM-01 and RUM-02 are **source complete at the read-only comparison boundary**.
RUM-03 remains an ongoing sequence of independently implemented, reviewed and
separately accepted slices. WSJT-X receive-only intake is source-complete; QRZ's
durable upload foundation is the latest source-complete slice, with UI and live
acceptance still open.
