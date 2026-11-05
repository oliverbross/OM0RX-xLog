# Single-candidate ten-minute steady CPU observation

The final signed 1.5.18 candidate ran alone with a fresh generated 100k fixture. Public kernel rusage snapshots at 0/300/600 seconds retain exact start identities, raw Mach CPU counters and timebase units. The CPU rates use each owner’s actual Mach interval. Host and worker stay separate; helpers are excluded.

| Owner | Target interval s | Actual interval s | User CPU s | System CPU s | Mean % of one core |
|---|---|---:|---:|---:|---:|
| host | 0–300 | 300.005235 | 5.190596 | 2.300553 | 2.4970 |
| worker | 0–300 | 300.005235 | 0.269294 | 0.144580 | 0.1380 |
| host | 300–600 | 299.984147 | 3.147146 | 1.399172 | 1.5155 |
| worker | 300–600 | 299.984147 | 0.284135 | 0.154905 | 0.1464 |
| host | 0–600 | 599.989382 | 8.337742 | 3.699725 | 2.0063 |
| worker | 0–600 | 599.989382 | 0.553429 | 0.299486 | 0.1422 |

| Owner | Target s | Actual capture elapsed s | RSS MiB | Physical footprint MiB |
|---|---:|---:|---:|---:|
| host | 0 | 0.297915 | 108.828 | 38.142 |
| worker | 0 | 0.297915 | 46.062 | 87.516 |
| host | 300 | 300.298837 | 92.812 | 38.251 |
| worker | 300 | 300.298837 | 19.188 | 87.516 |
| host | 600 | 600.304947 | 78.625 | 42.564 |
| worker | 600 | 600.304947 | 18.688 | 87.516 |

Initial observation: Root positively reverified exact host and worker before each GUI step, observed marked Operator Desk with blank callsign/frequency/comment and external station I/O disabled, clicked observed Desk Callsign, then fresh AX confirmed focused control still blank. OS frontmost and continuous visibility not independently verified. No root GUI interaction during baseline; end observation and profiling remain separate.

End observation: After the separate ten-second Time Profiler attach completed successfully, process-only verification found both marked host and worker absent. Root stopped before any post-profile AX observation or Quit; no root Quit was requested. End GUI focus/visibility was not observed.

Only initial control focus was observed. OS frontmost, continuous visibility/focus/occlusion and end GUI state were not independently verified. The sampler periodically verified exact host/worker coordinates and absence of another xLog GUI host. The root procedure reserved GUI interaction and stack profiling for after the final CPU capture.

Source `0b7c669663841c2e55569b0c21c76ad03805cad7`; version `1.5.18`. Signed host SHA256 `4f95f35d234919d7bf81d5cba50f0f33041056a927bf362978c35d7a3bae8ffa`; signed worker SHA256 `31ac2cdda0254df08b57058a07b29ceae1f83acd365debdcdb13f15eea639f67`. Sealed build manifest SHA256 `d7bad62ab9443270be1299a126d0447ff3c943261e2a057d187332da9f877d70`.

Generated fixture controls: 100,000 physical/live QSOs, 100,000 generated comments, zero tombstones, same 27 settings fields as the earlier candidate fixture. Exact stored-QSO hash `c890ab242dca96dd196217168a1f05dcc299b1ba6a2e877149abbddeaea59af2` was preserved in the post-exit check. Preparation used a worker-created empty workspace, generated-only SQLite backup, supported migration/settings APIs and fenced blank draft clear. No QSO was committed; no production store/settings were read or installed app modified.

Lifecycle limitation: after the separately labelled ten-second profiler phase, process-only verification found both exact host and worker absent. Root requested no Quit and stopped before post-profile AX observation or binding. Exit cause remains unobserved and under investigation; this is not ordinary Quit qualification. The completed baseline precedes that profiler phase. Subsequent integrity/QSO checks used normal readonly SQLite on a byte-matching DB/WAL/SHM copy with WAL honored and no immutable mode. Original fixture family hashes/bytes and the baseline manifest remained unchanged.

The machine JSON retains all three snapshots, actual intervals, hashes of verified process-start identities and exact units, raw/converted counters, source/artifact/tool hashes and initial/final stored-data checks. It omits PIDs, marker identities and private paths. Ambient load/caches and observer overhead were uncontrolled. These owner measurements establish no whole-application budget or attribution of the earlier high-memory incident.

The provisional under-1% CPU goal is **not met in this profile**. The [numeric receipt](desktop-steady-ten-1.5.18.json) retains the complete measured intervals. The [separate saved-profile analysis](host-profile-1.5.18.md) gives an IPC investigation lead; it does not identify a feature owner or prove the cause of exit.
