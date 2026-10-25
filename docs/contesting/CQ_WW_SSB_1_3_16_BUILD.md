# macOS 1.3.16 — compact spot frequencies and radio publisher recovery

Frequency display change: `5f668c13`. Radio recovery: `50ace297`.
Build from clean canonical main with `bash prototype/scripts/package-macos.sh`.
The version commit is embedded as sourceCommit in DistributionMetadata/components.json
and Not1MM/python-runtime.json; final installed evidence follows below.

Cluster tables/details, compact cluster, band-map ticks/ranges/tooltips and map
route/spot labels display frequencies to 100 Hz, e.g. 7.150.3 and 14.234.4.
Rounding handles MHz boundaries. Original numeric frequencies remain unchanged
for selection, tuning, storage and radio publication.

A failed initial publisher registration or worker restart could leave later
publications permanently stale. Recovery retries sequence one once using the
same publisher identity and timestamp, preserving retirement/supersession checks.
Only accepted admission resets the local counter. Current runtime inventory was
empty; this defect was reproduced, but no captured IPC trace proves it was the
sole cause of the operator's live failure.

Validation: 156 frequency/display/selection tests, 19 focused radio publication
and lifecycle tests, TypeScript and independent radio recovery diff review passed.
A combined signed candidate is built once. Production QSOs are never test data.
Recorded voice/routing/PTT/CW hardware limitations from the prior audit remain.
