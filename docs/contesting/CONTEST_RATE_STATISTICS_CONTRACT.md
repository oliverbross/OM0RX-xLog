# Contest Rate and Statistics Contract

This contract is source-backed by the pinned `contest-sw` tree at
`7c8b499225a73f7f8f792246881bd7aefc05452f`, specifically
`not1mm/ratewindow.py`, `not1mm/statistics.py`, and the `DXLOG` schema in
`not1mm/lib/database.py`.

## Logged contacts and score authority

The source windows count every current retained log row. xLog therefore uses
every nondeleted QSO for rate, current-hour, band, mode, distinct-call, WPX,
and Run/Search-and-Pounce counts. Duplicate and invalid rows remain visible in
those operational counts. xLog also exposes accepted, duplicate, and invalid
counts separately. Credited points come only from the authoritative full
rescore, so duplicates and invalid QSOs contribute zero points.

Deletion removes a QSO from the projection. Correction replaces its current
band, mode, callsign, prefix, time, and credited-point contribution. Because
every mutation is followed by a full rescore, deleting or correcting an
earlier QSO may promote a later duplicate and change accepted counts and
credited points. Reopening the same database must reproduce the same
projection.

## Rate intervals

The trailing window is `(asOfUTC - 3600 seconds, asOfUTC]`. The current-hour
window is `(UTC hour start, asOfUTC]`, matching the source's strict lower
boundary. Latest samples use timestamp then QSO UUID ordering. The latest-10
and latest-100 rates are absent until the full sample exists. A multi-contact
zero-duration sample has no rate instead of retaining a stale display value.
A single trailing-window QSO reports 1 Q/h, as the source does. Future-dated
contacts are excluded from an as-of projection.

The projection exposes the full current nondeleted log count separately from
the as-of logged count so future-dated rows are visible without contaminating
rate windows or current-hour statistics.

The worker captures one server `asOfUTC` for each atomic read together with
the session revision. A later read refreshes elapsed-time windows even when
the persisted revision is unchanged; statistics reads create no mutation
receipt or persistent write.

## Band, mode, prefix, and operating style

Mode buckets preserve the source mappings for CW, phone, and digital modes and
add an explicit `other` count so a logged QSO is never hidden. Band rows use
`ContestBandPlan` order for supported standard bands, followed by lexical order
for supported nonstandard bands and then lexical order for any remaining stored
bands.

WPX counts use the existing pinned source-compatible xLog prefix calculator,
stored as per-QSO projection facts. Per-band counts are distinct nonempty
prefixes. The total is distinct `(band, prefix)` pairs, matching the source
query. This statistic is separate from each contest rule's authoritative
multiplier kinds and claimed-score calculation.

Run/Search-and-Pounce is a per-QSO historical fact captured by the sole contest
owner at commit. Legacy rows omit it and are counted as `unknown`; current UI
state is never inferred for old QSOs. Corrections retain the original style,
and deletion removes the row from current counts. The compatible persistence
change requires the optional property to be omitted when absent so legacy
canonical QSO JSON and request receipts remain byte-identical.

## Ownership and presentation

The store produces one atomic snapshot of current nondeleted QSOs, persisted
statistics facts, and the authoritative rescore at one session revision. The
worker/native projection is read-only and carries the exact contest session,
workspace generation, session revision, and as-of time. The main contest owner
loads and publishes it. Detached Rate and Statistics surfaces do not read the
database directly, mutate contacts, or create another session owner.

The native `monitor` ready projection is schema version 1. It carries the
session revision, canonical millisecond UTC `asOfUTC`, full-log and as-of
disposition counts, current-hour count, total/current-hour operator-style
counts, trailing-60-minute rate, nullable latest-10/latest-100 rates, and a
busy flag. Each rate contains `qsoCount`, nullable finite nonnegative
`spanSeconds`, and nullable finite nonnegative `qsosPerHour`.

The native `propagation` ready projection retains version 1 score-only decoder
compatibility. Version 2 adds the same revision/time and full-log/as-of counts,
plus complete unique band rows and a total row. Every row carries logged and
accepted counts, distinct callsigns, exhaustive CW/phone/digital/other mode
counts, distinct WPX prefixes, and credited points. The score remains the
authoritative full-log score, while the added rows are the as-of statistics.
Band arrays accept up to 64 complete unique rows; publication rejects overflow
or inconsistent counts instead of truncating them.

The TypeScript client validates the complete atomic worker result before it can
reach presentation state. The mounted contest owner refreshes the read-only
clock projection without acquiring mutation ownership and discards delayed
results from another session, workspace generation, or revision. Refresh
failure leaves an already validated same-coordinate sample visible with an
explicit unavailable status.

Native surface revisions advance independently per panel. A Rate-only clock
refresh publishes only `monitor`; it cannot stale an unchanged Entry action.
An actual Entry projection change still advances `active-qso` and keeps its
mutation fence strict. `monitor` carries Rate schema 1, while `propagation`
carries Statistics schema 2 and retains score-only schema 1 compatibility.
