# Contest Database Snapshot Contract

## Scope

`ContestDatabaseSnapshotter` creates a point-in-time copy of a schema-version-2
contest database. The result is a newly published directory containing one
`contest.sqlite` file. This foundation is for offline inspection and historical
recovery. It does not activate a restored contest in a running workspace.

The snapshot is not a signed archive, an authenticated backup, or proof of
origin. It has no manifest or content hash. Callers that transfer or retain the
directory must provide their own authentication and retention policy.

## Inputs and paths

The caller supplies both URLs explicitly:

- The source is an existing, readable, regular SQLite file opened read-only.
- The destination is an absent directory whose existing parent is supplied by
  the caller. An existing directory, even an empty one, is refused.
- Symlink ancestors, a symlink endpoint, and a multiply linked source file are
  refused. The fixed macOS `/var` and `/tmp` system aliases are canonicalized;
  arbitrary aliases are not followed.
- Inspection applies the same ancestor, endpoint, and single-link checks to the
  fixed `contest.sqlite` member before SQLite opens it.
- No production location or default path is selected by this API.

Work occurs in a private mode-0700 staging directory beside the destination.
On Windows the directory inherits the caller's parent ACL; the implementation
does not attempt to translate POSIX mode bits.
Failures and cancellation remove the staged database only while its retained
identity still matches, then remove the owned staging name only while its
directory identity still matches. A substituted object is preserved. The
source and any pre-existing destination remain untouched.

The path policy assumes a trusted caller and a staging parent private to that
caller. Validation rejects detectable substitutions and symbolic or multiply
linked endpoints. It is not a sandbox against a malicious process with the same
UID continuously racing arbitrary filesystem calls. In particular, path checks
before and after opening cannot prove that a source was never exchanged and
restored between those checks.

## Consistency and bounded work

The source is opened with SQLite read-only and query-only flags. A read
transaction is established by an initial query before `sqlite3_backup` starts,
so WAL commits made by another connection after that point cannot be mixed into
the copy. Backup advances in bounded page chunks. Busy and locked results have
a finite retry count and sleep interval. Invalid, zero, negative, or excessive
page and sleep options fail before staging is created. Busy sleep is divided
into short cancellation and monotonic-deadline-aware intervals.

One monotonic deadline covers source pinning, backup, verification, and
publication. Swift task cancellation is shared with SQLite progress handlers on
source, destination, integrity, foreign-key, schema, and inventory queries.
Every initialized backup is finished and every database handle is closed on all
paths.

The staged database uses `journal_mode=MEMORY` while the backup writes through
its already-open file, then switches to `journal_mode=DELETE` before
verification and publication. The published directory has no dependency on
source WAL or shared-memory files. The staged database is opened and
identity-pinned before the source-pinned callback can run. That same SQLite
connection receives the backup and remains open through verification, so a
later staging-path substitution cannot redirect backup or verification to
another database.

## Verification and metadata

The same read-only inspector is used before publication and by
`inspectSnapshot(at:)`. It requires:

- `PRAGMA integrity_check` to return `ok`;
- no rows from `PRAGMA foreign_key_check`;
- `PRAGMA user_version = 2`;
- exactly the contest tables, columns, defaults, primary/unique indexes,
  ordering indexes, and foreign keys defined by schema version 2;
- no additional triggers or views, and exact explicit-index membership;
- exact index uniqueness, origin, key order, collation, direction, and partial
  predicate status, plus exact foreign-key grouping, update/delete actions,
  and match behavior.

Integrity, schema, counts, and session inventory are read in one pinned SQLite
read transaction, so inspection never returns metadata mixed from different
writer commits.

Successful inspection returns immutable metadata: schema version, database file
name, per-table row counts, and per-session identity, workspace generation,
aggregate revision, and draft/operation/serial/QSO/audit counts. It does not
migrate or repair input.

The SQLite backup preserves stored snapshots, canonical operation payload
bytes, receipts, replay results, QSO audit records, tombstones, reservations,
and serial counters. Tests compare every persisted value in every contest table
between source and copy before reopening the copy.

## Publication

Publication closes the staged database first, then performs an atomic native
no-replace directory rename. On Darwin and Linux, the existing parent and the
created staging directory are retained by directory descriptors. Creation,
cleanup, and rename use descriptor-relative operations; device/inode identity
is checked before publication and after the rename. Detectable replacements
fail closed and cleanup does not delete the replacement object.

Supported publication primitives are:

- Darwin: `renameatx_np` with `RENAME_EXCL` and retained parent descriptor;
- Linux: `renameat2` with `RENAME_NOREPLACE` and retained parent descriptor.
- Windows: `SetFileInformationByHandle(FileRenameInfo)` with
  `ReplaceIfExists=FALSE` on the retained staging handle. Every existing
  ancestor through the destination parent is retained without delete sharing,
  so the absolute destination path cannot be redirected while publication is
  active. Reparse points, multiply linked database files, UNC paths, and device
  namespace paths are refused. `GetDriveTypeW` admits only fixed, removable,
  and RAM-disk volumes; remote, unknown, missing-root, and CD-ROM drives are
  refused before filesystem inspection or staging.

If the platform cannot provide that primitive, publication fails explicitly.
A destination created by another process between validation and publication is
never overwritten. Windows retains read-attribute identity handles while SQLite
is open. Cleanup requests delete access to that same file object with
`ReOpenFile`; if the filesystem or sharing state refuses it, cleanup preserves
the artifact instead of falling back to a pathname deletion.

On Darwin and Linux, the native rename binds the staging *name* relative to the
retained parent; the preceding identity check and rename are separate syscalls.
On Windows, the rename binds the retained staging handle and the ancestor
handles prevent destination-path redirection. The API does not claim protection
from a malicious same-user process continuously racing arbitrary filesystem
operations. Once the native rename succeeds, the directory is treated as
published immediately. A later location check or caller hook may report an
error, but failure cleanup never removes content from the published directory.

## Recovery boundary

Opening the copied database through `SQLiteContestStore` proves offline
historical recovery under the original session and workspace-generation values.
Those stored generations are part of mutation history and are not rewritten.

Runtime restore activation is deferred. A future restore flow must introduce a
fresh admission epoch and map it to the preserved historical session generation
instead of conflating the two identities.
