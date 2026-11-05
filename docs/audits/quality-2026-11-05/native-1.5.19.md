# 1.5.19 native macOS acceptance

**PASS within the disposable offline profile.** Exact source
`72a5926c2878ceedf70789ff4bae619ae5e14511`, macOS 27.2 (26B123), arm64,
system WKWebView. This records the local journey; the daily installed 1.5.15
and public release remain unchanged.

| Artifact | SHA-256 |
|---|---|
| macOS ZIP | `680c95bd7ebf05c2bdd1b77c461507b8b99d83bc548f75797146182dd3badfd5` |
| Host | `cebb5249d96865c9d3bd980b5589e40729bb3fbf4b21bd7730d75c0649d357bb` |
| Swift worker | `a34ca68f95b8a03b27e9eb9ea09034cfc83b7f4c7593fbc0bf615e7dbfe93c43` |

The canonical no-clobber recipe completed with exit zero. Extracted source,
version, arm64 executables, strict nested Developer ID signatures, privacy
scan and ZIP round-trip passed. All nine signed-worker process tests passed
under existing deadlines. Notarization was not run.

Before each native observation/input batch, process-only inspection verified
the exact host PID/executable/full private-root argument and matching child
worker. The marked window matched the fixture. Settings and callsigns below
are synthetic; station and external-service I/O stayed disabled.

| Action | Observed outcome |
|---|---|
| Keyboard setup; Skip radio and rotator; local logbook | K1TEST, K1TEST/P, FN31PR, fixture location and 37 W configured. |
| First save: K1SYN, 14.250 MHz, 20m SSB | Original durable receipt checked before editing: configured station fields and 37 W present. |
| Logbook search and historical edit | Unicode comment `QUALITY / edited 1.5.19 — Žilina` saved. |
| Historical frequency buffer `14..` → native Settings | View change blocked; invalid text retained; Update QSO disabled. |
| Same buffer → File / Close Window | Original host and matching worker remained alive; same marked editor retained `14..` and comment. |
| Explicit Cancel edit | Returned through queued Settings; saved row still showed 14.250000 and exact Unicode comment. |
| Ordinary Quit → stopped proof → explicit restart | Setup stayed complete and one saved row retained exact frequency/comment. |
| Second ordinary Quit | Host and worker positively stopped before further app binding. The automation's first shortcut attempt was rejected as stale; process inspection confirmed the original pair still alive, a fresh observation preceded the successful ordinary Quit. |
| Same-root worker ADIF export after GUI exit | OPERATOR, STATION_CALLSIGN, MY_GRIDSQUARE and TX_PWR=37 passed; logical snapshot unchanged; clean EOF. |

The WAL-aware post-journey checker passed integrity, one live synthetic QSO,
one original save receipt and one historical edit receipt. Every durable
frequency is 14,250,000 Hz. Logical snapshot SHA-256 is
`3b3eaa16d2579bf46763056a81d8673c2c9880e8cff93d240a3e443699cbb591`;
export SHA-256 is `f97f9d2a2914b88fbf44ea330952f86d13d595270d8d63b09cebe4fde0b505a3`.
Station location is proven by the stored QSO/first receipt; no existing ADIF
station-location mapping is claimed. Native veto observations come from this
task's tool transcript, separately from durable-data checks. Raw launch and
data receipts remain in ignored private evidence directories.

[Machine-readable disposition](native-1.5.19.json) and
[worker retention sanity](memory-signed-1.5.19.md) retain their own scope.
Equipment Browse/Save/Connect remains NOT RUN because isolated Station Control
refuses external services. Ordinary Windows/UAC, real Linux desktop, hardware,
scaling/multiple displays and whole-desktop memory/CPU budgets remain open.
Earlier failures and the 1.5.18 measurements remain preserved separately.
