# Completed worker request retention

Status: reproduced in the released worker and corrected in source; integrated
signed 1.5.18 worker A/B verified on empty, generated 100k and private
representative fixtures. The complete desktop/operation envelope remains open.

## Observed live session

The installed 1.5.15 host and worker were positively identified by mapped
executable and hashes before any test launch. Read-only capture at roughly
3.5 hours uptime on an eight-logical-core, 16 GiB Apple Silicon Mac, macOS 27.2
build 26B123, showed host footprint about 60 MB and worker footprint about
3.7 GB (recorded peak 4.1 GB). Nearby RSS was much smaller and variable.
`memory_pressure -Q` reported 39% system-wide free; that is not an Activity
Monitor pressure-color observation.

`footprint` attributed approximately 3,034 MB to Malloc Small, 718 MB to Malloc
Large and 15 MB to allocator metadata. SQLite's tagged cache was 384 KB dirty
and about 8.5 MB reclaimable. `vmmap` showed about 3 GB swapped allocation.
These tools use different units/sampling times; their rows are not a sum of
app-wide physical memory. WebKit/XPC services outside the parent tree remain
unassigned. The user identified htop and later specified its **MEM column**.
That exact label is retained; the process identity, field definition/units,
timestamp and workload behind the reported ~7 GB remain unknown. MEM is not
silently reinterpreted as RSS, virtual memory or macOS physical footprint.

The native heap summary's leading class was **897,311 Swift Task stacks,
2,053,251,840 bytes**, plus another 181,693 task-stack allocations using
58,141,760 bytes. Country/activation/cluster structures also retain substantial
memory (one activation-reference dictionary class accounted for 365,133,824
bytes). The latter is not automatically a leak. Raw summaries, stack samples,
addresses and process coordinates remain private. Sampling can perturb the
process; capture values are observations, not a controlled plateau.

## Retaining owner and repair

`Sources/XLogPrototypeWorker/main.swift` added every admitted request to a
long-lived `TaskGroup<Void>` but never consumed completed children with
`next()`. The 16-request admission counter bounded running requests, while
completed task results remained owned until pipe EOF. Swift's
[discarding task group](https://docs.swift.org/latest/documentation/swift/withdiscardingtaskgroup%28returning%3Aisolation%3Abody%3A%29/)
releases completed children and still joins outstanding children on scope exit.

The worker now uses that standard primitive. Admission, overload response,
correlation and serialized output are unchanged. EOF first cancels background
startup and retires station ownership, then the group scope joins requests,
then a fatal retirement result is handled. Independent review found no change
to that ordering. The complete release worker compiled, and nine real process
tests passed, including EOF drain, burst correlation, malformed/oversized
recovery and private-root production-ledger preservation. Existing deadlines
were unchanged.

## Controlled completed-request ladder

`prototype/scripts/benchmark-worker-lifetime.py` launches an explicit private
offline worker, verifies PID/executable/parent/full arguments, checks disabled
external I/O, creates a private empty workspace or SQLite-backup copies only
the retained generated 100k fixture, warms 1,000 health requests, and records
ten cycles of 2,000 sequential health requests. Each VM sample follows a 0.2 s
settle, with uncontrollable OS caches and other builds active. This is a
request-retention stress test, not a 5/15/30-minute normal-desk idle budget.

| Worker / fixture | Footprint growth over 20k completed reads | Outcome |
|---|---:|---|
| Released 1.5.15 / empty | 125,409,690 bytes (~119.6 MiB) | Repeatable near-linear growth |
| Released 1.5.15 / generated 100k | 121,739,674 bytes (~116.1 MiB) | Growth does not require contact materialization |
| New development worker / empty | 0 rounded bytes | Stable; 24 MiB regression budget passed |

Machine samples are retained in the adjacent `memory-*.json` files. Each actual
worker hash identifies the measured executable; raw development component
tests use the existing test-only metadata/symlink seam, with no GUI or app
distribution. Packaged measurements will identify the exact signed artifact
separately. SQLite fixture hashes identify the closed consistent backup,
including committed source WAL, rather than only the source main file.

An initial harness used a root prefix rejected by the owning runtime type.
It exited before service traffic; no GUI binding or production fallback was
attempted. The failure receipt is preserved privately. The corrected launch
uses the required `xlog-wave1-` prefix and fresh process proof. An initial build
selected the default Swift manifest without the portable product; it failed
without packaging. Both failures are excluded from passing evidence.

The [final signed 1.5.18 comparison](memory-signed-1.5.18.md) records all eleven
samples per run and exact artifact/fixture identity. Released 1.5.15 grew
116–120 MiB over 20,000 reads on all three fixtures. Signed 1.5.18 was flat on
empty data and settled downward on the larger fixtures, with clean EOF.
Candidate post-run verification uses closed WAL-consistent backup-API snapshots.
All 69,696 stored representative rows match the protected source and recovered
baseline. Original empty/generated baseline post-run snapshots are unavailable;
their raw reports omitted disposable target coordinates. The generated pre-run
copy hash matches across versions. An unpublished initial integrity summary
used an insufficient main-file-only read; its corrected v2 and raw originals
remain retained, with the correction recorded in the published numeric receipt.

Historical JSON fields named `cpuLifetimePercent` contain `ps %cpu` samples,
not lifetime/interval averages. New reports normalize them to `psCpuPercent`
without rewriting the raw measurements. Negative footprint growth can reflect
settling, compression or reclamation; it is not an app-wide memory saving.

The [5/15/30-minute generated-100k desktop observation](desktop-idle-1.5.18.md)
completed with normal Quit and unchanged stored QSO hashes. Candidate worker
footprint remained 84.3 MiB; its host rose 37.7→38.8 MiB. This is a concurrent,
passive offline profile with unverified focus/occlusion after readiness.
[Public per-process counters](desktop-idle-counters-1.5.18.md) record CPU,
wakeups, pageins and kernel-accounted disk bytes with exact intervals. The
candidate host alone averaged about 1.05% of one core, so the provisional
under-1% idle goal is not met here. No CPU target was relaxed.

The [single-candidate ten-minute follow-up](desktop-steady-ten-1.5.18.md)
measured host 2.0063% and worker 0.1422% of one core over 599.989382 seconds.
The host result differs from the concurrent pair; initial control focus and
visibility contexts differ, so no causal comparison is claimed. The goal
remains unmet in this isolated profile. A separate short Instruments recording
completed, then both test processes were absent before post-profile GUI
observation or Quit. Native logs and trace metadata show `exit(0)`; the
initiator/cause remains unobserved. This sequence is not normal-Quit acceptance.
WAL-aware post-exit checks preserve all generated QSO rows and the original
database family. Earlier native and paired-idle normal-Quit receipts keep their
separate, observed outcomes.

[Saved host-profile analysis](host-profile-1.5.18.md) identifies WKWebView/Tauri
transport work as an investigation lead, without identifying commands or
feature callers. The JavaScriptCore image share includes native allocator
scavenging and is not JavaScript application CPU. Two samples include offline
profile guard file reads; this does not quantify production overhead or justify
weakening isolation. Sparse profiler sample weights are not CPU durations.

Next evidence: redacted per-command/timer/subscriber counters, relevant operation
close/expiry cycles and complete WebKit ownership under a calibrated ordinary
desktop profile. Current kernel
responsibility/coalition probes identify a broader shared owner for both test
hosts and WebKit candidates; those helpers remain shared/unattributed.
The source fix explains a substantial observed owner and removes demonstrated
request-driven growth. It does not establish that every byte of the original
htop incident, all reference caches or the whole desktop budget is resolved.
