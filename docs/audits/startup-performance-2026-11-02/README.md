# Remaining startup performance

Installed outcome: [signed macOS 1.4.8 acceptance](installed-1.4.8.md), including
controlled bundled-worker timings, native checks and protected installation.

## Cause and change

The workspace's full `PRAGMA integrity_check` recomputed three JSON expression
indexes over the same large contact payloads. A private, consistent SQLite backup
of the 69,582 stored / 69,581 live contact log reproduced the cost. No profiling
command wrote to the production workspace.

Replace those derived indexes with a compact read projection and ordinary scalar
indexes. SQLite triggers maintain it in the same transaction as each supported
contact insert, update or delete, including external SQL writers and old-version
ordinary writes. Preserve raw JSON value types and the existing distinction
between authoritative JSON fields and scalar search columns. Statistics, awards,
DXCC/history candidates, cluster contacts and reference history read the compact
projection; full contact editing/export still reads the original records.

Migration checks complete schema definitions and row count, rebuilds incomplete
derived state transactionally, and leaves every authoritative QSO byte, tombstone,
baseline and revision intact. Older applications may recreate their indexes;
their ordinary writes still execute compatible built-in SQLite triggers. No new
SQLite extension or custom function is required.

Keep the complete integrity check at every workspace open. Explicitly validate
every source contact's JSON as well, since index expressions no longer provide
that incidental check. Keep workspace identity/path, restore, snapshot revision,
mutation receipt, draft recovery and station-output guards unchanged.

The first upgrade requires a one-time projection build. Do not report that launch
as representative of subsequent startup, and do not pre-migrate production data
outside the application to conceal its cost.

## Diagnostic evidence

Private Python/SQLite 3.54 diagnostic, milliseconds (host/cache conditions vary):

| Operation | Observation |
| --- | ---: |
| Original full integrity check, two samples | 9,498 / 11,857 |
| Full check without the three expression indexes | 2,353 |
| Compact projection full check | 3,670 |
| Explicit all-contact JSON validation | 571 |
| Compact statistics read | 100 |
| Compact award-field read | 304 |
| Compact cluster-field read | 186 |
| One-time compact projection build | 11,800 |

Statistics and award-field digests matched the original SQL. All original record
payloads and deletion states remained identical. A compact JSON-tuple expression
index was also measured; it did not materially improve validation and was rejected.
These diagnostics select an implementation, not a native app startup acceptance.

The installed 1.4.7 worker's separate offline three-launch baseline opened the same
private log in 5,278 / 4,913 / 3,931 ms. Authoritative settings/draft/preferences
hydration then took 4–10 ms; first page 7–12 ms and map context 99–109 ms. This
baseline uses the native bundled SQLite and must not be compared numerically with
the Python diagnostic above. Isolated workers exited normally; no live cluster or
station output was started.

## Validation

All 348 native core tests across 47 suites passed after the change, including
projection migration/reuse, raw value types, missing/altered triggers, missing
derived rows, physical deletes, primary-key changes, tombstones, transaction
rollback, JSON corruption rejection, aggregate snapshots, persisted cache
invalidation, map projections, history, import and workspace path isolation.

Initial new-test failures were fixture assumptions: comparing a pre-save value
with the database-normalized saved value, and then exercising confirmation logic
after deliberately assigning a non-UUID contact identity. Both fixtures were
corrected; source behavior did not need weakening.

Private diagnostic scripts, databases and detailed receipts are retained under
`.build/startup-fast-20261102/` and private temporary roots; none are shipped or
committed. An unbundled worker correctly rejected the offline profile because it
lacked the owning application identity. No GUI binding or production fallback was
attempted. Exact-source package, bundled-worker timings, native UI and installation
acceptance remain separate gates.
