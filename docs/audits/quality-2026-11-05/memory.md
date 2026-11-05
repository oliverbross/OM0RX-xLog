# Completed worker request retention

Status: reproduced in the released worker and corrected in source; integrated
signed-package A/B and the complete idle/GUI envelope remain pending.

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
unassigned. The user identified htop as the original observation tool, but its
exact ~7 GB column, timestamp and workload remain unknown.

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

Next evidence: repeat on the integrated signed candidate for empty/generated
100k/private representative workspaces; retain settled 5/15/30-minute desk and
operation-cycle measurements with complete WebKit ownership. The source fix
explains a substantial observed owner and removes demonstrated request-driven
growth. It does not establish that every byte of the original htop incident,
all reference caches or the whole desktop memory budget is resolved.
