# Signed 1.5.18 large-log worker checks

**PASS within the recorded generated-data workflows.** Source
`0b7c669663841c2e55569b0c21c76ad03805cad7`, signed worker SHA-256
`31ac2cdda0254df08b57058a07b29ceae1f83acd365debdcdb13f15eea639f67`.
Existing country and QLog diagnostic scripts ran sequentially after the idle
apps had exited. Each worker launch used a fresh marked offline root, matching
PID/executable/parent/full-root arguments, external-I/O health guards and normal
EOF. No GUI, station, credentials or production log was used.

The retained older generated 100k fixture was copied with SQLite's backup API
and migrated through the supported worker path. Original input and both
post-workflow copies pass integrity/foreign-key checks and retain the exact
ordered stored-QSO hash. This diagnostic uses explicit BLOB type tags; hashes
from other encoders must not be compared directly. Full timings, correctness
and raw-script/report hashes are in [the numeric receipt](worker-workflows-1.5.18.json).

| Country workflow | Result |
|---|---:|
| First page / warm page | 9.760 / 3.378 ms |
| Cold country snapshot and lookup | 282.303 ms |
| Forty warm lookups, median / maximum | 0.806 / 3.179 ms |
| Complete 100k country review | 17,864.911 ms |
| Concurrent correlated health reply | **0.299 ms**, before review completion; existing 2,000 ms budget met |

Review compared all 100,000 records; all were flagged as affected and 28,000
unresolved in this deliberately synthetic input. No country corrections were
applied. Reference revision is retained in JSON. The earlier 1.5.15 review
baseline was approximately 18.58 seconds; uncontrolled caches/load and one
review per candidate do not establish a performance improvement.

| QLog RPC, milliseconds | First process | Reopened process |
|---|---:|---:|
| Workspace open | 6,968.443 | 1,059.990 |
| First / warm page | 9.540 / 3.454 | 9.152 / 3.646 |
| Literal search page/count | 105.557 | 105.674 |
| Statistics | 689.752 | 223.878 |
| Typed band/mode page/count, first / warm | 403.569 / 3.532 | 404.307 / 3.636 |
| Typed filtered frozen export snapshot | 1,557.610 | 1,593.837 |
| First 20-record export chunk | 0.781 | 0.666 |
| Global award progress, cold / warm | 2,568.224 / 1.877 | 2,539.490 / 1.728 |
| Literal-filter frozen export snapshot | 953.488 | 948.509 |

Both runs checked 100k page/stat totals, 25k literal-search/export matches,
33,334 typed-query/export matches, 20 records in the first chunk and eight
global award units supported by all 100k QSOs. First open includes migration;
reopened means a new worker on the same private copy, with OS caches uncontrolled.
These are RPC measurements, not visible-save latency. No percentile is inferred
from two process runs. No schema/index/cache/durability tuning was introduced.

An initial wrapper failed in preflight because its diagnostic hash encoder
omitted SQLite BLOB handling. No worker was launched. That failure and original
script remain retained; a fresh v2 directory used a type-preserving encoder.
All passing post-run reads honored committed WAL pages. Expiry/close/cancel
memory retention, concurrent durable-save latency and full desktop budgets
remain outside this check.
