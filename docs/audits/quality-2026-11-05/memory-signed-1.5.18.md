# Signed 1.5.18 worker retention checks

Isolated worker evidence. Each frozen 1.5.15 baseline and 1.5.18 candidate used 1,000 warmup health requests followed by ten sequential batches of 2,000 correlated health requests. All runs completed clean EOF.

| Fixture | Live / physical QSOs | 1.5.15 footprint start → end / growth | 1.5.18 footprint start → end / growth |
|---|---:|---:|---:|
| empty | 0 / 0 | 25.8 → 145.4 / +119.6 MiB | 19.8 → 19.8 / +0.0 MiB |
| generated-100k | 100,000 / 100,000 | 28.3 → 144.4 / +116.1 MiB | 30.3 → 19.0 / -11.3 MiB |
| representative-private | 69,695 / 69,696 | 28.2 → 147.3 / +119.1 MiB | 23.4 → 14.1 / -9.3 MiB |

Physical footprint and RSS remain separate. All 11 sample values per run, metric units, raw-report hashes, fixture hashes, counts, logical-QSO hashes, source and exact worker hash are in the [sanitized JSON](memory-signed-1.5.18.json).

Historical raw `cpuLifetimePercent` labels are normalized to `psCpuPercent`; these are ps snapshots, not lifetime or interval CPU percentages. Original reports and earlier 1.5.17 results were not changed.

The generated source is the retained 100k fixture, with no new rows generated; its pre-run closed-copy hash matches the frozen baseline. All three candidate post-run snapshots were copied with SQLite backup API from read-only sources with WAL honored, then checked as closed standalone files. They pass integrity, expected counts and stored-QSO hashes. The representative baseline was recovered the same way and its 69,696 stored rows match the candidate and protected source. Frozen baseline empty/generated post-run logical snapshots are unavailable because those reports retained no target coordinates. Database schema/read-projection migration may change whole-file hashes while stored QSO content remains identical.

No whole-app/WebKit budget, 7 GB incident attribution, hardware acceptance or exact-version 30-minute idle claim follows from these health-request checks. Ambient builds/native tests, OS caches, compression and observer overhead were uncontrolled.

Candidate source: `0b7c669663841c2e55569b0c21c76ad03805cad7`. Worker SHA-256: `31ac2cdda0254df08b57058a07b29ceae1f83acd365debdcdb13f15eea639f67`.

This v2 supersedes the initial summary’s insufficient main-file-only immutable post-run reads. Retained WAL/SHM was found in stopped fixtures; source main/WAL hashes remained unchanged while making consistent backups. Raw memory/EOF reports and the initial summary are preserved.
