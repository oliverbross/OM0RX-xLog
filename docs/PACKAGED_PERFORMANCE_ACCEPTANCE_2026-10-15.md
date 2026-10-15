# Packaged macOS performance acceptance

Date: 15 October 2026

## Scope and result

An ad-hoc signed macOS bundle at exact source `cb5d450` completed five
independent 100,002-contact packaged runs. Every run passed all **39/39** native
acceptance checks with `embeddedUi: true`, `worker: true`,
`large_log_requested: true` and `station_io: false`.

Each run created a disposable private workspace, imported 100,000 generated ADIF
records, and added two contacts through the rendered UI. The harness denies
platform services, credentials, network contact and station I/O. It did not use
or modify the operator logbook, Wavelog, online-log accounts, radio, amplifier,
tuner, rotor, PTT or CW.

The reports are:

- `dist/perf-cb5d450-run1.json`
- `dist/perf-cb5d450-run2.json`
- `dist/perf-cb5d450-run3.json`
- `dist/perf-cb5d450-run4.json`
- `dist/perf-cb5d450-run5.json`

## Five-process results

Nearest-rank p95 for five process-level samples is the maximum observation.
Times begin at browser navigation for launch readiness, before route selection
for screen readiness, and around the named local worker/UI action for the other
measurements.

| Operation | Minimum | Median | p95 / maximum |
| --- | ---: | ---: | ---: |
| App UI mounted | 320 ms | 472 ms | 533 ms |
| Operator workspace ready | 522 ms | 721 ms | 847 ms |
| Import 100,000 generated contacts | 178,436 ms | 186,994 ms | 211,152 ms |
| First Logbook display after mutation | 117 ms | 229 ms | 244 ms |
| First Awards open | 1,029 ms | 1,151 ms | 1,522 ms |
| Repeat Awards open | 64 ms | 66 ms | 91 ms |
| First local 12,500-contact entity history | 254 ms | 282 ms | 366 ms |
| Repeat local entity history | 239 ms | 276 ms | 383 ms |
| Rendered 50-contact callsign intelligence | 23 ms | 33 ms | 33 ms |

Each run also made five painted navigation passes through six core screens. The
combined 25-sample distributions were:

| Screen | Minimum | Median | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Logbook | 79 ms | 99 ms | 132 ms | 132 ms |
| DX Cluster | 57 ms | 70 ms | 100 ms | 117 ms |
| Band Maps | 64 ms | 67 ms | 69 ms | 81 ms |
| Awards (warm) | 65 ms | 67 ms | 69 ms | 69 ms |
| Settings | 65 ms | 66 ms | 67 ms | 68 ms |
| Operator Desk | 65 ms | 83 ms | 85 ms | 93 ms |

This cleanly separates local rendered intelligence from remote QRZ latency: no
QRZ or other network request exists in these measurements. First-open Awards is
the remaining visibly slower local path; the warm route is consistently fast.

## Regression found and fixed

The first pre-fix package at `540e437` passed 15 earlier checks but timed out when
the 2x native Desk split briefly vetoed the Home-key persistence action. Its
failed report is `dist/perf-540e437-run1.json`; it is not counted in the timing
distribution.

Commit `cb5d450` keeps the exact persisted/ARIA min/max proof and retries only
the same idempotent rendered Home/End target after the divider is visibly
enabled. It does not bypass a mutation guard or treat an ignored event as a pass.
The new transient-veto regression and existing Desk Map/Logbook tests pass
**16/16**.

After the five runs, the complete frontend suite passes **2,395/2,395 across
160 files**, the Rust/Tauri suite passes **460/460**, the production frontend
and detached-window bundle gate pass, and the ad-hoc bundle still passes strict
deep signature verification.

## Bundle identity

- Host SHA-256:
  `efe9a2d49a47fcdef7ec3ad76b83ab6f41985b2323e11c5dca051db583698a85`
- Worker SHA-256:
  `78d30ae2ef2d95b486e08c23d877708e01333eab713d538466ee854c3d6a195d`
- Host architecture: arm64.
- Worker architectures: x86_64 and arm64.
- `codesign --verify --deep --strict` passes.

The development bundle is not installed, Developer ID signed, notarized or
stapled. Windows and Linux were deliberately not built. These measurements do
not cover physical cold-disk behavior, memory pressure, an authenticated QRZ
lookup, live sync/cluster contention, multiple displays, the operator's current
workspace, or other operating systems. Those remain separate acceptance gates.

After all five isolated processes exited, only the installed alpha.29 host and
worker remained. A read-only check of its live database returned **68,042 active
contacts**, all **68,042** linked to Wavelog, zero dirty rows, zero outbox rows,
zero conflicts, QSO revision **68,330**, and SQLite `quick_check` `ok`. The
increase from the earlier baseline is normal activity of the already-running
installed application; none of the disposable performance workspaces opened
this database.
