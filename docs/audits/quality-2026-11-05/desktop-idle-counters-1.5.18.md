# Per-process idle counters: 1.5.15 and 1.5.18

The two disposable hosts ran concurrently. The first optional counter snapshot arrived about 164 seconds after readiness; later samples arrived near 5, 15 and 30 minutes. [Full values, exact Mach intervals, units and executable/source hashes](desktop-idle-counters-1.5.18.json) are retained in role-only JSON.

| Role | Interval targets (minutes) | Actual seconds | CPU seconds | CPU % one core | Interrupt wakes | Disk read / write bytes |
|---|---|---:|---:|---:|---:|---:|
| baseline host | late first → 5 | 136.515 | 1.445645 | 1.0590 | 9123 | 0 / 0 |
| baseline host | 5 → 15 | 600.021 | 6.798177 | 1.1330 | 41436 | 4747264 / 0 |
| baseline host | 15 → 30 | 900.009 | 10.354989 | 1.1505 | 61344 | 1654784 / 0 |
| baseline worker | late first → 5 | 136.515 | 0.186720 | 0.1368 | 0 | 16384 / 0 |
| baseline worker | 5 → 15 | 600.021 | 0.942505 | 0.1571 | 1 | 17440768 / 0 |
| baseline worker | 15 → 30 | 900.009 | 1.330598 | 0.1478 | 0 | 507904 / 0 |
| baseline profile-associated Networking helper | late first → 5 | 136.515 | 0.000000 | 0.0000 | 0 | 0 / 0 |
| baseline profile-associated Networking helper | 5 → 15 | 600.021 | 0.003808 | 0.0006 | 17 | 106496 / 0 |
| baseline profile-associated Networking helper | 15 → 30 | 900.009 | 0.000000 | 0.0000 | 0 | 0 / 0 |
| candidate host | late first → 5 | 136.558 | 1.363954 | 0.9988 | 9502 | 0 / 0 |
| candidate host | 5 → 15 | 600.060 | 6.261840 | 1.0435 | 41248 | 634880 / 0 |
| candidate host | 15 → 30 | 899.954 | 9.605537 | 1.0673 | 61761 | 1253376 / 0 |
| candidate worker | late first → 5 | 136.558 | 0.186700 | 0.1367 | 1 | 16384 / 0 |
| candidate worker | 5 → 15 | 600.060 | 0.851245 | 0.1419 | 0 | 679936 / 0 |
| candidate worker | 15 → 30 | 899.954 | 1.343298 | 0.1493 | 3 | 561152 / 0 |
| candidate profile-associated Networking helper | late first → 5 | 136.558 | 0.000000 | 0.0000 | 0 | 0 / 0 |
| candidate profile-associated Networking helper | 5 → 15 | 600.060 | 0.003698 | 0.0006 | 17 | 0 / 0 |
| candidate profile-associated Networking helper | 15 → 30 | 899.954 | 0.000000 | 0.0000 | 0 | 0 / 0 |

Kernel responsibility/coalitions did not isolate either host’s helpers. A one-time exact-store lsof/stat observation associated one Networking helper with each private profile. This is profile association only, not exclusive ownership or coverage of WebContent/GPU/other helpers. Helper executable hashes were unavailable because an exact mapped-executable proof could not be completed; no hash is guessed. Host/worker executable and application source hashes are retained.

RSS and physical footprint remain separate per-process measurements. Helper memory is shared/unattributed; no whole-app memory total is computed. Network activity is unknown. Zero wakeup/disk counters can reflect accounting limitations. Initial unmeasured time is not extrapolated. Candidate focus, baseline occlusion, ambient builds/native tests, caches, compression and observer overhead were uncontrolled; this is not statistical improvement or whole-app budget acceptance.

Live PIDs, private marker/store paths, kernel ownership coordinates and unrelated candidates remain only in private evidence. The public export retains a hashed association receipt and exact counter intervals.
