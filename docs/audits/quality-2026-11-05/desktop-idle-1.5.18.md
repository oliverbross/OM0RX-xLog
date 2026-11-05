# Desktop idle with 100k generated contacts

Separate host and worker observations from exact retained signed 1.5.15 and final signed 1.5.18. Both private fixtures closed after ordinary Quit with all 100k generated QSOs and exact stored-column QSO hashes preserved. The 27 private settings fields supplied through supported setup APIs matched exactly between versions. [All samples and controls](desktop-idle-1.5.18.json) are machine-readable.

Concurrent pair: root initially observed each marked Operator Desk; 1.5.18 was observed last/frontmost. Subsequent focus, occlusion, minimization and continuous visibility were not verified. OS caches, ambient load and observer overhead were uncontrolled. These data establish no whole-application budget or attribution of the reported high-memory incident.

| Version | Owner | Target min | Actual s | RSS MiB | Rounded physical footprint MiB | CPU time s |
|---|---|---:|---:|---:|---:|---:|
| 1.5.15 | host | 0 | 5.64 | 110.36 | 37.4 | 1.35 |
| 1.5.15 | host | 5 | 300.12 | 62.30 | 37.4 | 4.52 |
| 1.5.15 | host | 15 | 900.13 | 33.72 | 37.6 | 11.31 |
| 1.5.15 | host | 30 | 1800.12 | 37.59 | 38.3 | 21.67 |
| 1.5.15 | worker | 0 | 5.64 | 49.38 | 87.7 | 3.11 |
| 1.5.15 | worker | 5 | 300.12 | 19.33 | 88.9 | 3.52 |
| 1.5.15 | worker | 15 | 900.13 | 16.77 | 88.7 | 4.47 |
| 1.5.15 | worker | 30 | 1800.12 | 17.02 | 92.4 | 5.80 |
| 1.5.18 | host | 0 | 5.17 | 111.48 | 37.7 | 1.52 |
| 1.5.18 | host | 5 | 300.12 | 62.44 | 37.9 | 4.57 |
| 1.5.18 | host | 15 | 900.14 | 33.20 | 38.0 | 10.84 |
| 1.5.18 | host | 30 | 1800.12 | 37.16 | 38.8 | 20.44 |
| 1.5.18 | worker | 0 | 5.17 | 48.09 | 84.3 | 3.20 |
| 1.5.18 | worker | 5 | 300.12 | 18.64 | 84.3 | 3.62 |
| 1.5.18 | worker | 15 | 900.14 | 13.98 | 84.3 | 4.47 |
| 1.5.18 | worker | 30 | 1800.12 | 14.00 | 84.3 | 5.82 |

RSS and footprint are distinct metrics; no owner RSS values are summed. VMMap footprint is rounded. CPU time comes from ps display precision; average percentages below are derived over actual per-owner sample timestamps.

| Version | Owner | RSS delta MiB | Rounded footprint delta MiB | CPU delta s | Approx mean % of one core |
|---|---|---:|---:|---:|---:|
| 1.5.15 | host | -72.77 | 0.9 | 20.32 | 1.132 |
| 1.5.15 | worker | -32.36 | 4.7 | 2.69 | 0.150 |
| 1.5.18 | host | -74.33 | 1.1 | 18.92 | 1.054 |
| 1.5.18 | worker | -34.09 | 0.0 | 2.62 | 0.146 |

No WebKit/helper is assigned by this table. Separate attribution evidence governs helper association; names, timing, PPID-1 or matching coalitions alone do not establish ownership. [Public counters and association limits](desktop-idle-counters-1.5.18.md) document availability, narrower profile-file associations and the late initial counter sample. No network, GPU, JS heap, audio/IQ or SQL-cache budget is inferred.

Exact artifact provenance (retained signed bundles; host and worker hashes are after signing):

- Version `1.5.15`, source `1873dc1d1c4d1aa95b44d07f7af0482417680f5f`.
  Host SHA256 `388114efe485ea83fc56256af0774d6ee6b4f4bd9561798ba215fdd025399ef2`; worker SHA256 `0b4121e278d42546f793a7947af3ce3cf0b99b0cfc423f66ef1b3fb664202d6c`.
  Sealed build manifest SHA256 `4096bf02eb386fe76ba08c202305e7038db4b5e56ff520f3df5cd0565eff4a13`.
- Version `1.5.18`, source `0b7c669663841c2e55569b0c21c76ad03805cad7`.
  Host SHA256 `4f95f35d234919d7bf81d5cba50f0f33041056a927bf362978c35d7a3bae8ffa`; worker SHA256 `31ac2cdda0254df08b57058a07b29ceae1f83acd365debdcdb13f15eea639f67`.
  Sealed build manifest SHA256 `d7bad62ab9443270be1299a126d0447ff3c943261e2a057d187332da9f877d70`.

Exact stored-QSO hash: `c890ab242dca96dd196217168a1f05dcc299b1ba6a2e877149abbddeaea59af2`. Main/WAL bytes and database hashes are retained independently from QSO content in the machine JSON. Supported migration/cache work can change the database hash while preserving the stored-QSO hash. All fixtures/evidence remain available. No production store/settings were read, and the installed app was not modified.

Fixture controls: separate canonical offline roots with mode 0700, home directories and workspace identities; validated normal_logging enum; no connected loopback; worker-created empty workspace, generated-only SQLite backup, supported worker migration/settings restoration and revision-fenced blank draft clear. No QSO was committed during preparation. All 100,000 generated comments and zero tombstones were verified. Backend isolation health and Desk observations confirmed external station I/O disabled. Both ordinary Quit lifecycles and subsequent closed-store hash checks passed.

The provisional under-1% idle CPU goal is **not met by this observation**:
the candidate host alone averages approximately 1.05% of one core, before its
worker and unknown helpers. No target was relaxed. Complete memory-budget
acceptance is **UNAVAILABLE** because WebContent/GPU and shared helper ownership
remain unresolved. These passive concurrent observations do not reproduce the
20,000-request retention stress and do not establish a statistical improvement.

Full process coordinates/proofs, raw ps/vmmap traces and isolated-root identities are retained privately. This export omits process identifiers, marker identities and private paths. Machine JSON includes all four samples per version, exact source/artifact hashes, database/WAL sizes, actual sample timing, dataset controls and final preservation evidence.
