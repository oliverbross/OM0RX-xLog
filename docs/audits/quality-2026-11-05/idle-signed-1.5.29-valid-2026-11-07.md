# Valid signed 1.5.29 idle observation — 7 November 2026

**The unchanged 30-minute visibility protocol passes.** All five scheduled samples and the final-ten-minute native CPU deltas were collected from the retained signed app. Complete-family CPU is **4.003% of one core**, above the unchanged provisional under-1% idle goal. This is valid measurement with an unmet CPU goal, not a whole-release acceptance or signed before/after saving.

Reference host: **MacBookPro17,1, 8 logical CPUs, 16 GiB RAM, macOS 27.2 / 26B123**. Canonical main began clean/fast-forward current at `d93f6dae`. Application **1.5.29**, frozen source `78681662f9104264d0903329996d15962c395711`, Developer ID signed arm64 host and bundled worker matched the retained archive/executable/manifest pins. No app build, package, install, version change, optimization, CI campaign or public release occurred.

## Memory and CPU results

Memory units are **MiB = bytes / 1,048,576**. Family footprint is the tool-provided shared-accounted value, not a manual sum of RSS or per-process peaks. The compressed/swapped column is a **subset**, not additional memory and not disk-swap usage alone. The tool JSON provides that subset for the family; it does not split it by process.

| Elapsed min | Actual UTC sample start | Shared-accounted footprint MiB | Compressed/swapped subset MiB |
|---:|---|---:|---:|
| 0 | 05:54:38.614755 | 325.676 | 191.484 |
| 5 | 05:59:38.611368 | 338.817 | 191.859 |
| 15 | 06:09:38.615870 | 317.363 | 167.859 |
| 20 | 06:14:38.619334 | 317.363 | 182.156 |
| 30 | 06:24:38.605073 | 313.270 | 164.891 |

Per-process footprint (MiB):

| Owner | 0 min | 5 min | 15 min | 20 min | 30 min |
|---|---:|---:|---:|---:|---:|
| Host | 41.314 | 41.298 | 41.298 | 41.298 | 41.314 |
| Worker | 84.188 | 84.173 | 84.188 | 84.188 | 84.188 |
| WebContent | 161.220 | 175.142 | 160.236 | 160.298 | 156.251 |
| GPU | 32.673 | 31.923 | 25.329 | 25.251 | 25.204 |
| Networking | 6.641 | 6.641 | 6.625 | 6.625 | 6.625 |

Per-process **RSS** (MiB), reported separately and never summed as footprint:

| Owner | 0 min | 5 min | 15 min | 20 min | 30 min |
|---|---:|---:|---:|---:|---:|
| Host | 67.188 | 64.156 | 48.969 | 48.266 | 48.062 |
| Worker | 18.625 | 18.719 | 14.516 | 14.438 | 14.578 |
| WebContent | 118.141 | 113.969 | 110.078 | 111.312 | 112.000 |
| GPU | 15.312 | 9.922 | 11.281 | 11.000 | 11.578 |
| Networking | 1.922 | 1.891 | 1.891 | 1.875 | 1.859 |

Final ten minutes: actual per-owner intervals **599.980806–599.980807 seconds**, from native user/system Mach-counter deltas between the 20- and 30-minute samples. CPU is percent of **one CPU core**; no lifetime CPU percentage or summed memory peak is used.

| Owner | CPU % one core |
|---|---:|
| Host | 1.059537 |
| Worker | 0.170854 |
| WebContent | 2.498135 |
| GPU | 0.274218 |
| Networking | 0.000000 |
| **Complete family** | **4.002745** |

The worker footprint stays approximately **84.19 MiB**; family footprint ranges **313.27–338.82 MiB** and ends lower than its first sample. This run did not reproduce multi-GiB idle memory. These five samples do not establish retained JS heap behavior, a leak/growth rate, a matched optimization benefit or the cause of the historical ~7 GB incident. The representative ~70k target still needs calibration; the generated100k workload and normal connected station are distinct scopes.

## Readiness and unchanged supervision

No Computer Use tool, screenshot, video, screen-sharing or capture API was used in this continuation. A local metadata/AX helper handled preparation and ordinary Quit. A fresh private generated-100k profile used the supported `--offline-contest-acceptance=<private-root>` route. Owning-source enum validation admitted `normal_logging`; worker health verified station I/O, credential access, live cluster and network contact disabled. Logging was local, automatic sync off, station identity and callsign blank.

Full signed-byte/executable/native-birth/parent and complete private argv proof preceded every scoped AX action. Dedicated LaunchServices originator plus matching resource/jetsam coalitions positively attributed host, worker, GPU, WebContent and Networking; all sample boundaries preserved those owners. Daily app remained closed as found and installed/available. UTM remained the same original running process.

Local AX readback verified **Traditional**, **Map view**, **58% map/tools**, working **Standard bundled WebGL**, **Detailed/Both**, **Sun/Greyline on**, **Heard me off**, blank call and 20m Band maps. The first map-selection helper read too soon after opening the menu and stopped; its failure is retained. A fresh read verified the exposed Standard item, and a bounded menu-settle/readback correction completed preparation without blind Escape or app relaunch.

The prior capture helper received ordinary termination, and its software-cursor/window-sharing surfaces disappeared. Its process subsequently remained as an exited zombie awaiting parent reaping; no force kill or parent-app control was used. The normal **Cmd-Option-D** Dock mapping was verified before input, auto-hide temporarily enabled, and the pointer parked at the active display origin +12,+12, outside the candidate. After normal hide animation and warm-up, the Dock surface no longer intersected above the candidate. Dock auto-hide was restored from true to its original false after measurement. No overlay whitelist, classification change or observer predicate relaxation was needed.

A documented **60.005121-second warm-up** preceded the successful actual-predicate preflight at **05:54:37 UTC**. The first memory sample started **05:54:38.614755 UTC** (15:24:38 Darwin), the last **06:24:38.605073 UTC** (15:54:38 Darwin). The observer completed **1800.471345 seconds**, with **1,591 geometric state samples**, **zero registered AX/workspace events**, maximum heartbeat gap **0.280585 seconds** (limit 1 second), and maximum geometric state gap **1.256313 seconds** for the nominal one-second window-list checks. The candidate stayed foreground, unminimized, fully on one active display and unobstructed under that predicate.

The existing protocol combines continuous logical focus/window/session notifications with sampled geometric window-list checks; it is **not continuous pixel occlusion proof**. The observer source SHA remains `96f9d812e75fa09a85ad13cad8b9cc1ecaeab39226f5ff7118ade141bc117ebd`. No builds, tests, profilers or GUI automation ran during sampling; only the established collector/observer plus read-only progress-log checks ran. The observer used **1.029868 user + 0.934148 system CPU seconds**; observer/footprint overhead was not subtracted. Global pressure, caches and ambient system activity were not controlled.

## Ordinary closure and preservation

After the successful observer receipt, a fresh local AX read still showed the blank Standard-map Desk. Dock was restored, then fresh pre-Quit process proof and exact-PID ordinary termination closed only the isolated candidate. No binding or AX observation followed Quit.

The original **30-second full-user coalition absence gate FAILED and is retained**: all 81 scans found no candidate survivors, but the old capture-helper PID **79847** was unreadable to the live-task API. A separate kernel `sysctl(KERN_PROC_PID)` bracket positively established **SZOMB=5**, original parent **79485**, UID 501, stable birth and no executable (`ESRCH`). This is an already-exited status record awaiting parent reaping, not a live owner. The exact scoped [kernel guard](idle-signed-1.5.29-exited-capture.c) and raw failure are retained; no broad exclusion of unreadable processes was introduced.

A subsequent independent full scan found no live candidate coalition members and no other unresolved process; known candidate/root/owner PIDs were absent and UTM identity matched. That specific zombie disposition was saved **before** storage was read. The original bounded gate is not relabelled as passed. A read-only source-to-owned standalone snapshot then passed integrity, **all 100,000 generated QSOs / all 12 stored columns**, and exact settings/revision preservation. Ordered QSO hash remains `c890ab242dca96dd196217168a1f05dcc299b1ba6a2e877149abbddeaea59af2`. Daily app, user data, audio, hardware and separate Skimmer were untouched.

## Evidence and next task

The [numeric receipt](idle-signed-1.5.29-valid-2026-11-07.json) retains exact bytes/timestamps, per-process RSS and footprint, family compressed/swapped subset, CPU deltas, native owner identities, visibility statistics, helper pins and closure disposition. The [local preparation helper](idle-signed-1.5.29-local-helper.m) is retained for review; it never launches an app and requires fresh exact-source process proof before AX access. Raw proofs, complete `footprint` JSON, visibility JSONL, closure failure and fixture snapshot are under `.build/quality-mac-s29-observation-20261107`; previous failed attempts remain unchanged.

The strict interval is now complete for this signed offline100k scope. Public-release, physical/connected-equipment, remaining platform, representative longer/operation-cycle soak and original-incident gates remain separate/open. **Single next task:** profile the remaining signed WebContent idle timer/IPC work on this same reproducible Desk (**2.498% of one core**, the largest owner) before choosing another product change.
