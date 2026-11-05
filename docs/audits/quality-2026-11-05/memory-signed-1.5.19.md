# Signed 1.5.19 worker retention sanity

Each isolated worker case completed 1,000 warmup health requests and ten sequential batches of 2,000 measured health requests. All CLI launches had exact process/executable/root proofs, UUID-correlated replies and clean stdin EOF. The active native GUI fixture was not controlled.

| Fixture | Live / physical QSOs | Historical 1.5.15 footprint start → end / delta MiB | Signed 1.5.19 footprint start → end / delta MiB |
|---|---:|---:|---:|
| empty | 0 / 0 | 25.8 → 145.4 / +119.6 | 20.2 → 14.1 / -6.1 |
| generated-100k | 100,000 / 100,000 | 28.3 → 144.4 / +116.1 | 30.3 → 19.0 / -11.3 |
| representative-private | 69,695 / 69,696 | 28.2 → 147.3 / +119.1 | 22.3 → 14.8 / -7.5 |

All 11 samples per candidate and historical baseline case are retained in the adjacent sanitized JSON, with raw report hashes, source/artifact hashes, units, separate RSS/rounded physical footprint, CPU display/snapshot values and batch timings. Legacy raw `cpuLifetimePercent` remains unchanged and is normalized to `psCpuPercent`; it is a ps snapshot, not lifetime or interval CPU.

Postrun validation used normal read-only, query-only SQLite sources with WAL honored through the backup API. Closed standalone destinations passed integrity, expected live/physical/tombstone counts and exact ordered stored-QSO hashes. Original source main/WAL bytes remained unchanged. The protected representative backup and retained generated input were preserved. Historical 1.5.15 representative postrun logical state was already recovered with WAL honored; historical empty/generated postrun target coordinates are unavailable.

The generated and representative fixtures reuse retained data. All source hash and fixture checks are numerical; no contacts, private paths, markers or PIDs appear in this export. These are worker-only retention checks. GUI/WebKit budgets, physical hardware, idle behavior and the earlier high-memory incident remain separate. Ambient native qualification/builds, caches/compression and observer overhead were uncontrolled; no CPU/timing causal improvement is claimed.

Source `72a5926c2878ceedf70789ff4bae619ae5e14511`; version `1.5.19`. Signed host SHA256 `cebb5249d96865c9d3bd980b5589e40729bb3fbf4b21bd7730d75c0649d357bb`; worker SHA256 `a34ca68f95b8a03b27e9eb9ea09034cfc83b7f4c7593fbc0bf615e7dbfe93c43`; ZIP SHA256 `680c95bd7ebf05c2bdd1b77c461507b8b99d83bc548f75797146182dd3badfd5`.

Comparison limit: populated pre-run copied database hashes differ from the historical 1.5.15 copies, so the table is a historical comparison at matched request/count bounds, without byte-equivalent A/B or causal timing claims. The representative stored-QSO hash matches the prior WAL-correct baseline snapshot. Historical generated/empty post-run logical state is unavailable. The cause of whole-file hash differences was not investigated in this bounded sanity.
