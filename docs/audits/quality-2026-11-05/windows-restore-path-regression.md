# Focused Windows restore path regression

The unchanged 1.5.20 [staged RPC run](ci-1.5.20-windows-diagnostic-rpc.md)
returned correlated errors at `backup_restore` on both Windows hosts after
18 passing stages. The underlying filesystem operation is not yet identified.

`WindowsRestorePathBoundaryTests` adds four required manager round trips with
native filesystem UTF-16 workspace lengths **174, 175, 177 and 178**. These
derive from the observed 91/92-unit TEMP roots, the owning direct-test/UI root
prefixes, a UUID and the actual workspace basename. Padding and receipts use
the native filesystem representation, including Windows drive handling.

Each fixture creates a sealed backup, captures its bytes, prepares an envelope,
holds the reference lease, creates and inspects the pre-restore Recovery
snapshot, installs the database/reference data and reopens the result. It
requires preserved QSO identity, comment, unknown ADIF fields, durable settings,
reference bytes, previous database/reference rollback and unchanged selected
backup bytes. Each operation has a separate stage. A delegating FileManager
observer records failed operations using only native path lengths and error
domain/code chains. No private paths or error descriptions are printed.

All four manager restores must succeed. There are no standalone tests requiring
a repair to Foundation itself, no accepted restore failure and no relaxed
data-preservation assertion. These fixtures cover the manager's path dimensions;
they are separate from the full LiveLogbookMethods transaction and exact-package
worker acceptance.

The focused Mac portable run passed **4/4**, with zero failures in 0.266 seconds
after compilation. Independent review found no remaining actionable issue.
Windows execution uses the existing `native-core-validation.yml`, with
`platform=windows` and `test_filter=WindowsRestorePathBoundaryTests`.
This is a tests-only source change: application sources/version and all 1.5.20
packages remain unchanged.

The [native Windows baseline](ci-windows-restore-boundary-baseline.md) ran all
four cases and failed all four at `install-reference`: Foundation's move from
the live Reference Data directory to its rollback name returned Cocoa error 516.
The destination lengths were 262, 263, 265 and 266 native UTF-16 units.
Database installation and Recovery snapshot creation passed first. Final reopen
and preservation checks were not reached. These failed expectations remain
unchanged while a narrowly scoped rename repair is prepared.

## Prepared repair and safety checks

`LocalFilePermissions.moveRestoreItem` routes Windows source or destination
names measuring at least 248 native UTF-16 units through the existing validated
extended-path conversion and [MoveFileExW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw)
with flags zero. It permits neither overwrite nor a cross-volume copy fallback;
native failures retain the underlying Win32 error code. Short Windows names and
all Unix calls retain the supplied FileManager dispatch. The existing caller
containment, link, lease and ownership checks remain authoritative.

Only the three reference-publication/recovery moves and two outer transaction
rollback moves use the helper. Routing also examines the source name so a long
rollback directory can return to the shorter live name after a later failure.
The original four failed manager fixtures remain byte-for-byte unchanged.

New safety tests cover Unicode file/directory renames in both directions,
occupied destinations without overwrite/merge, missing or invalid sources,
short-path injected failures, complete rollback after a later completion error,
and a genuine occupied rollback destination that preserves both copies and the
recovery block. A 251-unit collision-directory setup uses the existing
native-aware directory helper; its dimension and assertions were retained.

Focused Mac checks passed 18 XCTest cases and 15 Swift Testing tests; the final
eight rename cases passed again after that fixture-setup correction. Independent
review found no remaining actionable issue. The Windows-only validation will
select the path-boundary, rename, atomicity, envelope and restore-authority
suites through the existing native-core workflow. Native Windows verification
and a newly versioned application candidate remain pending. No 1.5.20 package
was rebuilt and no daily app was installed.
