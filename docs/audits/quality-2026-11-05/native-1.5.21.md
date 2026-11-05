# 1.5.21 native macOS acceptance

**PASS within the recorded disposable offline journey.** Source
`b0d6a93c314bfa2f24036121acd7b4a42ecdd173`, macOS 27.2 (26B123), arm64,
system WKWebView. Two earlier export-helper failures remain recorded below.
The daily installed 1.5.15 and public release remain unchanged.

| Artifact | SHA-256 |
|---|---|
| macOS ZIP | `139d4d1de65798779180cae31db0908e371c73da10d8a40cf835bd37b5aa5b4b` |
| Signed host | `13812b80c5d7b434b57b48b8c67f44efe7da6dbbe761ac5a71111aaa0f6b8901` |
| Signed Swift worker | `06a1f4c006de90ad36f89a700f98b5765399190f95a857d50c5a768d28b54367` |
| Sealed build manifest | `93f5468f564bdf0703c6c3ba1c0133a6b864b0f2b3fa8313d95bda499b1b750f` |
| Artifact seal | `56745722533a1df8c99912f0c7c80b28fd927a4afbd41f1fe58923e359a8e871` |

The canonical no-clobber recipe completed with exit zero and its final clean-source
guard passed. ZIP round-trip, extracted source/version, both arm64 executables,
strict Developer ID signatures and privacy scan passed. All nine signed-worker
process tests passed without deadline changes. Build-manifest inputs describe
pre-sign files; the executable hashes above identify the signed extracted bytes.
Notarization was not run.

Before every native binding, observation and input batch, process-only proof
verified the exact host executable/process/full private argument and matching
child worker, marker and `normal_logging` profile. The marked window/private
WebKit store matched the fixture. All settings and contacts were synthetic;
external services and station I/O stayed disabled.

| Action | Observed outcome |
|---|---|
| Keyboard setup; skip radio/rotor; local integrated logging | K1TEST / K1TEST/P / FN31PR, `Isolated quality fixture`, default 37 W. |
| First save: K1SYN, 14.250 MHz, 20m SSB | Before any edit, the row AND unique original durable save receipt contained configured own fields, 37 W and `QUALITY 1.5.21 initial`. |
| Native search, row edit and Unicode paste | The sole contact was edited to `QUALITY / edited 1.5.21 — Žilina`; reopened logbook retained one row and 14.250000 MHz. |
| Historical `14..` buffer → Settings | Navigation vetoed, raw text retained and Update QSO disabled. |
| Same buffer → native File/Close Window | Same host/worker positively alive before further observation; marked editor retained `14..`, 37 W and saved Unicode comment. Close was vetoed. |
| Explicit Cancel Edit | Returned to a clean new draft. Settings did NOT open automatically; it was requested again and displayed all configured own fields and 37 W. |
| Ordinary Quit → stopped proof → explicit restart | Both processes stopped; same sealed artifact/fixture restarted with distinct positively verified processes. No setup wizard appeared. |
| Restart readback | One contact retained valid frequency/final Unicode comment; Settings retained own fields and 37 W. |
| Second ordinary Quit | Process-only stopped proof passed before any further binding. GUI work ended; neither binding was queried again. |
| Final separately authorized worker export | Four correlated requests passed, standard ADIF own-station fields and 37 W matched, logical data stayed equal, EOF exit zero/no signals/stopped proof retained. |

No Escape, force Quit, production fallback, guard bypass, station command or
installation action occurred. GUI veto/persistence observations are separate
from SQLite/ADIF checks; durable data alone does not prove a menu interaction.

## Export-helper attempts, preserved separately

1. **Helper revision1 FAILED before any RPC**, after closed-store checks passed.
   Its identity guard rejected the explicit worker, but actual operands were not
   retained. EOF cleanup returned; the actual child exit/stopped receipt was not
   retained for this attempt. Do not retroactively assign its failed operand or
   claim an observed exit zero from the later diagnostic.
2. **Observation revision2 FAILED the unchanged guard before any RPC.** The
   scoped row matched expected process/parent/full arguments, but combined-column
   `comm` retained only 15 characters. All four separate owned-process queries
   returned exit zero, no error/stderr/truncation and exact coordinates; sole-column
   `comm` retained the full 135-character executable. Owned process liveness,
   actual EOF exit zero, no signals and stopped proof were retained.
3. **Proof revision3 and final export PASSED.** Executable proof required exact
   full sole-column `comm`; all four independent queries were mandatory, along
   with live owned process and scoped exact process/parent/full arguments.
   Combined-column `comm` remained diagnostic; no prefix was accepted as proof.
   No global query, parser change, retry loop, signal or deadline increase was
   introduced. The final four UUID-correlated requests were health, workspace
   status, export begin and export read. Actual EOF exit zero/stopped proof was retained.

These were helper-proof outcomes; no application failure is inferred from the
two rejected proofs. Earlier result/helper/provenance versions are preserved.
The final result does not relabel either failed attempt.

## Durable preservation and byte-layout limits

The WAL-aware mode=ro checker passed integrity, exactly one physical/live QSO,
the unique original first-save receipt and one historical edit receipt. Every
durable contact/edit frequency is 14,250,000 Hz. Both initial and final own-station
fields retained 37 W. Logical snapshot SHA-256:
`11359c43ab8044f42a3eddaabc144e6c51e57ffb5b8831d41aea56f19d5ee516`.
ADIF SHA-256:
`58f8efd3891b60dd3a66af7f658ebfb35fe9ec83200f090586c26aa204a70d1d`.

ADIF retained OPERATOR K1TEST, STATION_CALLSIGN K1TEST/P, MY_GRIDSQUARE FN31PR,
TX_PWR=37, FREQ=14.250000 and the exact Unicode comment. Station location is
proven in stored/save-receipt fields; the existing exporter has no such tag.

Each mode=ro read verified unchanged main/WAL bytes within that read. **Physical
bytes were NOT unchanged across the worker/checkpoint lifecycle:**

| Closed-store sample | Database SHA-256 | WAL SHA-256 |
|---|---|---|
| Before final export worker | `239df015d5e354fb830c49d4ecaabd7bc22aafcc04d0e218d9b17307212a4ea6` | `e59b1cc153e4e06ce873060a9a80390618edbdbbde3051cba3b7595f83c66f10` |
| After final export worker | `efb9466cdab8e85b27b682564b12aa029a0faee2098da546a7b674826e76703c` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty WAL) |

The final logical QSO/settings/receipt snapshot matched exactly. This receipt
claims per-read byte stability and cross-worker logical equality, not physical
file equality across export. Raw coordinates/launches/queries/data stay private;
the [machine-readable record](native-1.5.21.json) exposes only synthetic values,
numeric outcomes and hashes.

This is functional offline acceptance, not latency or resource qualification.
Native equipment Browse/Save/Connect, notarization, ordinary Windows/UAC/upgrades,
real Linux desktops, hardware/RF/audio, display/scaling parity, whole-desktop
memory ownership and the unmet provisional idle CPU goal remain OPEN. Previous
memory/lifetime/profiler results retain their original artifacts and limits;
none is repeated or inherited as 1.5.21 evidence. The all-platform gate has its own
disposition; this Mac journey makes no all-platform pass or public-release claim.
