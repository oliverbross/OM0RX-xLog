# SCP query latency evidence

This is local release-build core query evidence, not renderer typing latency or
Windows/Linux performance acceptance. The production index implementation was
unchanged: source SHA-256 `d188378f8ab9cb64df6fa893a8f98fa3940a3b3effb4462f755b158e891fcce6`,
accepted in `58a6007`; the measuring worktree was at `1b54a850c27247b081868a0a50084e5727b71ea2`.

[Raw results](evidence/scp-release-query-latency-2026-10-18.json), SHA-256
`9c07a39a897ecd4ac95397e2c7cb4abd7d94fd31be571c173424a757db92da91`,
record Apple Swift 6.4, arm64 macOS 27.0.1, eight processors and 16 GiB RAM.
Other work was running on the host; these are observed timings, not an isolated
hardware benchmark or a universal performance guarantee.

The pinned MASTER.SCP contains 359,363 bytes and 50,009 raw lines, producing
50,003 imported records. Its verified SHA-256 is
`94c2b46ef4fd80a6591f986195a6941970a36aaa6ad4c91c50df0d5a424d8efc`.
The second dataset contains 100,000 deterministic synthetic records.

| Dataset | Exact repeated-query p95 | Partial p95 | No-match p95 | Index build |
| --- | --- | --- | --- | --- |
| MASTER.SCP, 50,003 records | 1.82 ms | 2.18 ms | 1.75 ms | 25.6 ms |
| Synthetic, 100,000 records | 8.11 ms | 3.02 ms | 5.79 ms | 45.5 ms |

Each case has 50 measured repeated queries after three warmups and 20
first-query measurements on fresh indexes. Monotonic timing surrounds only
the awaited query; file reads, import, digest computation and index construction
are measured separately. A fresh index does not mean a cold OS filesystem cache.
The existing query budget is 100,000 records and the result limit is 20.
The query/result checksum is consumed to prevent unused-result elimination.
The JSON includes exact query strings, p50/p95/ranges, CPU time and retained
heap deltas. Retained heap deltas are not allocation counts or transient peak
memory proof; a zero process high-water increment does not prove no allocations.

The measured cases fit within the 50 ms core-query budget without optimization.
Worker transport, cancellation under typing, renderer scheduling, suggestion
selection and target-platform hardware still require integrated measurements.
No approximate matching or altered ranking is justified by these results.

The original local harness is preserved under
`/Users/oliver/.codex/worktrees/contest-portability/OM0RX-xLog/.build/scp-benchmark/`.
It links the worktree's actual `XContestCore` product. Its `Package.swift` hash
is `e5ba8f64784b0d9f6b71e5d08c6a54dfdb62e1f052e2d553527e9a1715a658fd`;
`Sources/SCPBenchmark/main.swift` is
`ea2ea952ea9a1cb54a817fcd9b548d94383a020392007bf26e16d102ffa7aeb0`.
The harness is local scratch evidence, not yet a portable checked-in benchmark.
