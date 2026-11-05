# 1.5.20 native macOS acceptance

**PASS within the disposable offline journey.** Source
`3d9cb0981c30764f1188db350ffebc22a5f328a7`, macOS 27.2 (26B123), arm64,
system WKWebView. The daily installed 1.5.15 and public release remain unchanged.

| Artifact | SHA-256 |
|---|---|
| macOS ZIP | `270bb128db22010fb61283a6645b19c75cb6b073204ae7248e57f76f7061a119` |
| Host | `47de7a980d2785493bc28eb25642f143ec7e150a2cef2b6a9af9fcf23236bbdb` |
| Swift worker | `7255c27b49c059bba416b1164d010bdef9185bcc5866d3f97d0b16b385b08ff5` |

The canonical no-clobber recipe completed with exit zero. Extracted source,
version, arm64 executables, strict nested Developer ID signatures, privacy
scan and ZIP round-trip passed. All nine signed-worker process tests passed
under existing deadlines. Notarization was not run.

Before each native binding/observation/input batch, process-only inspection
verified the exact host PID/executable/full private-root argument and matching
child worker. The marked window matched the fixture. All settings/contacts
below are synthetic; external services and station I/O stayed disabled.

| Action | Observed outcome |
|---|---|
| Keyboard setup, Skip radio and rotator, local logbook | K1TEST / K1TEST/P / FN31PR, fixture location and 37 W configured. |
| First save: K1SYN, 14.250 MHz, 20m SSB | Original durable receipt checked before any edit: configured own-station fields and 37 W present. |
| Logbook search and historical edit | K1SYN found; clipboard Unicode comment `QUALITY / edited 1.5.20 — Žilina` saved and read back. |
| Historical frequency buffer `14..` → native Settings | View change blocked with retained-text message; invalid buffer retained and Update QSO disabled. |
| Same buffer → File / Close Window | Original host and worker positively alive before further AX observation; same marked editor retained invalid text and Unicode comment. |
| Explicit Cancel edit | Queued Settings view appeared; logbook still held 14.250000 and exact saved Unicode comment. |
| Ordinary Quit → stopped proof → explicit restart | Both processes stopped; restarted setup stayed complete; one saved row retained exact frequency/comment. |
| Second ordinary Quit | Host and matching worker positively absent before further app binding. |
| Same-root worker ADIF export after GUI exit | OPERATOR, STATION_CALLSIGN, MY_GRIDSQUARE and TX_PWR=37 passed; logical snapshot unchanged; clean EOF. |

The automation rejected one stale File-menu action before it was sent. A fresh
process proof and AX observation preceded the successful menu action. No blind
Escape, force Quit, production fallback or guard bypass was used.

The WAL-aware checker passed integrity, one live synthetic QSO, the original
save receipt and one historical edit receipt. Every durable frequency is
14,250,000 Hz. Logical snapshot SHA-256:
`ca2c9871bb3f46fed5fa80016027485b85eec6e2c2dc26e6e78cdefc6bcdc6df`;
ADIF SHA-256: `5227deca4784f62b5a3d106fcb9ccd580db4b51a01ff724c9bc219a267c9e5e1`.
Station location is proven in stored/save-receipt fields; the existing exporter
has no corresponding ADIF tag. Native veto evidence is the observed task
transcript, separate from durable-data checks. Raw launch/data receipts remain
in ignored private directories. [Machine-readable disposition](native-1.5.20.json).

The QTC first-input repair passed [257 affected source-level tests](qtc-first-input-race.md);
this normal-logging journey does not claim a native QTC scenario. Swift Sources,
Tests and Package.swift are unchanged from the measured 1.5.19 source, but its
[retention](memory-signed-1.5.19.md) and [snapshot lifetime](preview-export-lifetime-1.5.19.md)
results retain their original artifact hashes and scope. No 1.5.20 CPU/memory
measurement is inferred. Equipment Browse/Save/Connect, ordinary Windows/UAC,
real Linux desktops, hardware, scaling/displays and complete desktop budgets
remain open; the cross-platform gate has its own disposition.
