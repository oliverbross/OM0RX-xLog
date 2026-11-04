# Durable country recovery after navigation

Native 1.5.11 acceptance applied only CQ zone to a synthetic OM3SYN contact, then
opened/cancelled the contact editor and returned to Logbook. The recovery button
was gone because the renderer retained its receipts only in component state.
The native receipt and before-values remained intact. This was a real UI defect,
not a storage failure or an accepted operational boundary.

The successor adds `logbook_country_correction_receipts`, an explicit read-only,
workspace-generation-fenced API. It keyset-pages at most 25 original country
receipts using UUID cursors and returns compact contact/date/field summaries plus
current revision eligibility. Ordinary edits inheriting correction metadata are
excluded by matching the original operation ID. The existing undo endpoint still
reloads durable before-values, checks the exact current revision, and uses the
existing durable mutation/replay receipt. A list result is not mutation authority.

The renderer exposes **Read saved country correction receipts** even after
remount/restart, plus bounded next-page controls. It validates response generation,
operation/contact identity, fields and bounds; undo acknowledgements must identify
the requested operation/contact. A read-only review found a delayed-undo-response
race across workspace changes. Sequence guards on success/error/finally prevent
an old workspace reply changing the newly displayed recovery list or status.

The narrow partial index is on existing receipt `operation_id`, restricted by
the original-country-operation predicate. It does not rebuild QSO expression
indexes or the QSO read projection. It does perform one JSON pass over historical
contact receipts when first created; this is a migration cost, not a claim that
all production-size receipt histories have been timed.

Focused native verification used the repository's explicit portable/Python/
concurrency settings and passed CountryIntegrationTests: 10 tests / one suite,
35.314 seconds. It covers reopen discovery, bounded pages, lowercase cursor
canonicalization, inherited ordinary edits, stale generations, already recovered
status and actual BackupManager restore discovery. The migration fixture contains
1,000 durable receipts (25 original corrections, 975 later ordinary edits) in a
16,850,944-byte private database. Complete reopen with index migration took
19.168 ms and left QSO revision unchanged. This is bounded synthetic evidence.

Native log archive:
`/Users/oliver/.local/state/lean-ctx/tee/XLOG_PORTABLE_ONLY_1_XLOG_CONTEST_PYTHON_ad9cefe4.log`.
One additional named filter in that command matched no tests; the counts above
are for the actual discovered suite. The focused Rust surface-authority test
passed. Final UI/typecheck, broader gates and signed restart/undo acceptance are
recorded by the integrator in the final release record.
