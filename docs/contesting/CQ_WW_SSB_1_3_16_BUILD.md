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

## Installed acceptance — READY WITH LIMITATIONS

Exact installed source: `ec981e72a896ddb0a26e48f43ecd6822f9d7bf9d`.
Both source receipts and installed/candidate component hashes match. Developer ID
deep/strict signatures passed; notarization remains unclaimed. Candidate and
installed packaged Python each passed 35 disposable checks; all 35 isolated native
checks passed with station I/O disabled. Focused display/selection tests passed 156
checks and publication recovery tests passed 19; TypeScript and diff checks passed.

Fresh backup preserved 342 contacts, 30 databases and 55 settings/service files.
All QSO, identity and audit rows matched exactly before relaunch. The existing
contest restored and ShackCQ reconnected with classified 40m spots. Compact
frequency labels were observed in the installed cluster. The operator resumed,
so no test draft, QSO or radio tune was performed. The previously empty accepted
radio inventory grew after startup; the receipt records samples across a renewal
interval. On 25 October 2026, the operator confirmed: “Yes, spots are visible”
on Flex/Maestro. Physical marker display is therefore operator-confirmed for
1.3.16. Long-term renewal beyond the previous failure interval remains unobserved.

Backup: `/Users/oliver/Documents/Backups/OM0RX-xLog-1.3.16-before-install-20261025`.
Rollback: `/Applications/OM0RX-xLog-previous-1.3.15-20261025.app`.
Previous 1.3.14 is also retained as a known operator-confirmed Flex rollback.
Recorded voice, routing, PTT and actual CW/transmitter acceptance remain separate.

[Installed source evidence](evidence/cq-ww-ssb-1.3.16/release-verification.json).
