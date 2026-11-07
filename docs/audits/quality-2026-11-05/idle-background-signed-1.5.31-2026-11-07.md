# Signed 1.5.31 background stability observation — 7 November 2026

**One 30-minute background observation completed and was independently verified.**
Shared-accounted family footprint rose initially, then stayed around **375–377 MiB**
over the final fifteen minutes and ended below its 20-minute sample. **WebContent
nevertheless rose at every sample, 205.220 → 223.517 MiB; not every owner is shown
to have settled.** Final-ten-minute family CPU is **2.273% of one core**, above the unchanged under-1% idle goal.
This is an absolute background observation, not foreground qualification, a matched
percentage-saving claim, long-term leak acceptance or attribution of the old ~7 GB incident.

The user chose to keep using the computer after two foreground preflights stopped
before sampling. The workload was explicitly changed to background observation;
the existing strict foreground observer was neither weakened nor relabelled as
passing. Its two rejections and zero samples remain retained separately.

Signed **1.5.31**, source `84d38f7e9cf6b63a5c9d07b610f9fcf0dab42639`, is the unchanged
bundle from the [candidate/install record](../../releases/v1.5.31-macos-quality-candidate.md).
The archive/host/bundled-worker/embedded-manifest pins and strict signatures were
verified again. No application or worker source change, build, rebuild, test,
profiler, new CI campaign, installation or public release occurred in this task.

## Memory samples

MiB = bytes / 1,048,576. Family footprint is the tool-provided shared-accounted
aggregate. It is not a sum of RSS, process footprints or lifetime peaks. The
compressed/swapped value is a subset, not extra memory or disk swap alone.

| Scheduled min | Actual UTC tool start | Actual elapsed s | Family footprint MiB | Compressed/swapped subset MiB |
|---:|---|---:|---:|---:|
| 0 | 09:49:50.546381 | 0.000000 | 357.113 | 308.062 |
| 5 | 09:54:50.597099 | 300.050718 | 369.473 | 266.531 |
| 15 | 10:04:50.653798 | 900.107417 | 376.098 | 277.312 |
| 20 | 10:09:50.662739 | 1200.116358 | 377.301 | 250.547 |
| 30 | 10:19:50.659583 | 1800.113202 | 375.442 | 279.125 |

Per-process footprint (MiB):

| Owner | 0 min | 5 min | 15 min | 20 min | 30 min |
|---|---:|---:|---:|---:|---:|
| Host | 42.407 | 42.407 | 42.439 | 42.485 | 42.501 |
| Worker | 82.344 | 82.344 | 82.344 | 82.344 | 82.344 |
| WebContent | 205.220 | 211.173 | 217.532 | 219.079 | 223.517 |
| GPU | 20.829 | 27.204 | 27.423 | 27.032 | 20.719 |
| Networking | 6.641 | 6.672 | 6.672 | 6.672 | 6.657 |

Per-process RSS, separately (MiB), never summed as family footprint:

| Owner | 0 min | 5 min | 15 min | 20 min | 30 min |
|---|---:|---:|---:|---:|---:|
| Host | 38.234 | 40.359 | 39.359 | 39.422 | 35.703 |
| Worker | 11.047 | 14.281 | 12.531 | 12.828 | 12.422 |
| WebContent | 37.562 | 64.875 | 63.953 | 85.516 | 78.656 |
| GPU | 10.109 | 8.953 | 9.578 | 10.375 | 12.219 |
| Networking | 1.328 | 1.328 | 1.328 | 1.312 | 1.281 |

Whole-interval family change: **+18.328 MiB**; final ten minutes: **-1.859 MiB**.
The family total is broadly flat across the last three samples. This does not
establish a retained-JS-heap trend or a long-term leak rate.

The family plateau must not conceal the renderer trend: WebContent rose
**18.297 MiB overall**, including **4.438 MiB in the final ten minutes**. GPU
footprint fell **6.312 MiB** in those final ten minutes, offsetting that rise in
the family total. Complete per-owner memory settlement is therefore **not
demonstrated**. A longer observation is needed to determine whether WebContent
eventually plateaus; these five samples alone do not diagnose a leak.

## Final-ten-minute CPU

Native per-owner Mach user/system deltas between the 20- and 30-minute samples,
as percent of one logical core. No lifetime CPU percentage is used.

| Owner | PID | CPU % one core | Actual interval s |
|---|---:|---:|---:|
| Host | 46897 | 0.686503 | 599.992524 |
| Worker | 46958 | 0.148481 | 599.992517 |
| WebContent | 46929 | 1.035620 | 599.992520 |
| GPU | 46926 | 0.400784 | 599.992522 |
| Networking | 46934 | 0.001201 | 599.992519 |
| **Complete family** | — | **2.272589** | per-owner intervals above |

The under-1% goal is unchanged and this observed background value exceeds it.
This run also does **not** qualify the foreground goal. Background visibility,
WebKit scheduling, ambient user activity, caches and compression differ from the
earlier foreground runs. No controlled percentage saving or foreground acceptance
is inferred. All family samples were below 1 GiB; the representative ~70k foreground
memory target still is not calibrated by this generated-100k background workload.

## Preparation, ownership and supervision

One fresh supported generated-100k fixture was prepared by the same signed S31
bundled worker, with exact enum checks, local logging, automatic sync off, blank
station/callsign, credentials/network/cluster/station I/O disabled. Its successful
manifest was bound exclusively to this attempt; no failed preparation or stale
manifest was reused. Foreground LaunchServices startup used **no `-g`**. Complete
native host/worker private arguments, executable hashes, parent/birth identities,
LaunchServices originator, WebKit owners and resource/jetsam coalitions preceded
local AX preparation. Traditional Desk / Map / 58%, Standard bundled WebGL,
Detailed/Both, Sun/Greyline on and Heard me off were verified.

The first strict preflight found installed host 45797 foreground after warm-up;
the separate retry found RustDesk 7308 foreground. Both collected **zero samples**.
After the user's clarification, the private candidate alone received a normal Hide
request. The background observer uses read-only AppKit/window-server metadata,
nominal one-second states and 250 ms heartbeats, without a foreground veto, AX
event subscription, input, screenshot or capture API. The existing binary foreground
observer remains unchanged at **1800/1815 seconds**; the separately sealed background
controller uses the same duration/bound and unchanged native ownership/footprint/CPU
collector functions. Candidate-family ownership is positively re-established before
and after **each** of the five scheduled samples. The numeric record retains all ten
full ownership proofs, individual footprints/RSS and actual counter timestamps.

The background quiet warm-up was **60.005549 seconds**. The host was already **1472.381 seconds** old at the first memory sample after foreground preparation, failed preflights and the readiness discussion. This is **not a fresh-process or startup-memory comparison**. The fixture itself is fresh and no previous measured manifest was substituted.

The background observer completed **1800.767620 seconds**, with **1755 metadata states**, maximum heartbeat gap **0.438130 seconds** (limit 1), and maximum metadata-state gap **1.214141 seconds**. It reported hidden/inactive for all states and foreground PID 45797. However, the candidate's window-server onscreen flag was false in **61** states and true in **1,694**. These metadata channels did not always agree; no fixed visibility or continuous pixel-occlusion proof is claimed. Observer/footprint overhead is not subtracted.

No builds, tests, profilers, source/helper edits or interactive observations ran
during sampling. Only the sealed collector/metadata observer and read-only progress
log checks ran while the user remained free to use the computer.

## Reporting failure and independent validation

The original background controller exited **1 after collection**, because the shared
JSONL reader tried to parse `osascript`'s final empty result line. Its original
`complete:false` result and error are retained unchanged. The observer itself exited
**0**, with a successful 1800.767620-second finish receipt; all five samples and ten
before/after ownership proofs had already been saved.

A separate post-run exporter admits only that one final blank line, parses every
other record, verifies the complete observer receipt, all sample/raw-footprint
identities and units, stable native births/coalitions, exact source/helper pins,
and recomputes CPU from the retained counters. That independent validation passes.
This is a valid background counter/footprint observation with a reporting-step
failure, **not** a claim that the original controller succeeded. No running helper
or candidate was patched, and the raw failure was not overwritten. The earlier
JXA CFArray metadata-conversion preparation error is also retained; it preceded
sealing/sampling and was not an application failure.

## Ordinary closure and preservation

After the interval, a fresh complete private process proof preceded exact-PID
ordinary termination of **only the isolated candidate**. No activation or GUI
binding followed Quit. Complete candidate-family/coalition absence was verified
before reading private storage. The existing narrowly pinned kernel guard accounts
for the previously exited capture zombie if present; no general unreadable-process
exclusion was introduced.

SQLite integrity, all **100,000 generated QSOs / 12 stored columns**, and exact
settings/revision preservation pass. Ordered QSO hash remains
`c890ab242dca96dd196217168a1f05dcc299b1ba6a2e877149abbddeaea59af2`.

Installed signed **1.5.31** host/worker identities and bundle pins are unchanged;
its process stayed running. This task did not bind, activate, hide, quit, restart
or reinstall it, and did not open the production database, settings or audio.
Live-data byte identity is not asserted because the user continued normal use.
UTM's original PID/birth is preserved, Dock auto-hide ends at its original false
value, and the separate Skimmer work is untouched. A Dock-restore attempt detected
that the setting was already false and stopped before posting another shortcut.

## Evidence and next task

[Numeric receipt](idle-background-signed-1.5.31-2026-11-07.json) contains source/pins,
all five per-owner footprint/RSS samples, complete ownership proofs, CPU deltas,
state/heartbeat statistics, the original reporting failure disposition and closure
checks. The exact frozen [background controller](idle-background-signed-1.5.31-2026-11-07-controller.py)
and [metadata observer](idle-background-signed-1.5.31-2026-11-07-metadata.js) are
retained with their pre-run hashes; their referenced existing local S31 factory,
ownership and native counter helpers remain required. Raw private evidence is
under `.build/signed-s31-stability-20261107`, with
the fresh manifest and the two failed strict preflights under `.build/quit-fix-20261107`.

**Next:** a longer background soak of the same unchanged signed application,
focused on whether WebContent eventually plateaus. The family plateau alone
does not establish that. Foreground under-1% CPU qualification, the historical
incident, connected hardware and wider release qualification remain separate.
