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
packages remain unchanged. Windows results and the repair decision are pending.
