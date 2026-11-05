# 1.5.18 native macOS acceptance

**PASS within the disposable offline profile.** Exact source
`0b7c669663841c2e55569b0c21c76ad03805cad7`, macOS arm64, Developer ID signed.
This is acceptance of the recorded local journey, not full desktop parity or
permission to install or publish. Installed 1.5.15 remains unchanged.

| Artifact | SHA-256 |
|---|---|
| macOS ZIP | `4225147985aaf5d9bb3bb6dfe6c04029f47b415df1cac512c75127493d577ead` |
| Host | `4f95f35d234919d7bf81d5cba50f0f33041056a927bf362978c35d7a3bae8ffa` |
| Swift worker | `31ac2cdda0254df08b57058a07b29ceae1f83acd365debdcdb13f15eea639f67` |

The canonical no-clobber recipe produced the archive and verified its extracted
version/source manifest, arm64 executables, strict nested signatures and privacy
scan. All nine signed-worker process tests passed under their existing deadlines.
Notarization is separate and was not performed.

Before every GUI observation or input batch, process-only inspection verified
the exact host executable/PID, complete private-root argument and matching child
worker. The marked window matched the private fixture. No station or external
service guard was weakened. All callsigns and settings below are synthetic.

| Action | Observed outcome |
|---|---|
| Keyboard setup, Skip radio, Skip rotator, local logbook | Completed; K1TEST operator, K1TEST/P station, FN31PR grid, fixture location and 37 W configured. No connection or transmission. |
| First desk save: K1SYN, 14.250 MHz, 20m SSB | Original durable save receipt checked **before editing**: all configured own-station fields and 37 W present. |
| Logbook search and historical edit | K1SYN found; comment saved as `QUALITY / edited 1.5.18 — Žilina`. Clipboard paste preserved Unicode. |
| Historical frequency buffer `14..` → native Settings menu | View change blocked with retained-text message; buffer remained `14..`; Update QSO disabled. |
| Same buffer → File / Close Window | Original host and matching worker still alive; same marked editor and `14..` remained visible. No force quit or blind Escape. |
| Explicit Cancel edit | Discarded the disposable invalid edit. No extra historical mutation receipt was created. |
| Ordinary Quit → process-only stopped check → explicit restart | Both processes stopped; setup remained complete; one saved row retained frequency 14.250000 and the exact Unicode comment. |
| Second ordinary Quit | Host and matching worker positively absent before any further app binding. |
| Explicit same-root worker ADIF export after GUI exit | OPERATOR, STATION_CALLSIGN, MY_GRIDSQUARE and TX_PWR=37 verified; logical store snapshot unchanged; normal EOF. |

The post-journey checker reports integrity `ok`, one live synthetic QSO, the
original save receipt and one edit receipt. Every durable frequency is
14,250,000 Hz. Stored rows alone do not prove the menu/Close veto; that result
comes from the separate observed native sequence above. Raw launch coordinates
and local data receipts remain private under the ignored native evidence
directory. AX observations are recorded in this task's tool transcript.
[Machine-readable disposition](native-1.5.18.json).

Equipment Browse/Save/Connect is **NOT RUN** in this profile: isolated Station
Control deliberately refuses external services. Windows ordinary-account/UAC,
Linux real-session UX, physical hardware, scaling/multiple displays and the
complete memory budget need their own evidence. Earlier 1.5.16 first-contact
failure and 1.5.17 Linux input-race failure remain preserved and held.
