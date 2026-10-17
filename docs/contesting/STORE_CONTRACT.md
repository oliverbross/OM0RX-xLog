# Contest store contract

`XContestStore` is the durable local persistence boundary for the first contest pilots. It depends on Foundation, `XContestCore`, and the existing `CSQLitePrototype` system module. The scoring and rule target remains free of SQLite, UI, network, hardware, clocks, and identity generation.

## Database ownership

`SQLiteContestStore` requires an explicit file URL whose parent directory already exists. It has no default production path and does not create application directories. Each instance is an actor with one serialized connection. SQLite is opened in full-mutex mode with foreign keys enabled and a bounded busy timeout. Schema migrations and mutations run under `BEGIN IMMEDIATE`; a failed mutation rolls back all state, receipt, revision, QSO, and serial changes.

Schema version 1 stores sessions, complete drafts, canonical operations and durable receipts, serial counters and reservations, and immutable QSOs. Workspace generation is a full UUID stored as SQLite `TEXT`; aggregate revisions remain unsigned integers. A session pins its complete rule identity, reference-data version, station/entity snapshot, operator list, display name, selected operator/category, generation, and aggregate revision. Codable snapshots prevent later reference-data changes from rewriting history. Unknown schema versions fail closed; only an explicit disposable-test harness may delete and recreate such a database.

## Mutation and recovery

Callers supply stable session, draft, request, reservation, QSO identities, generation UUIDs, and operation timestamps. The store creates none of these and does not consult a clock. Create uses a preallocated session ID, exact rule/reference identity, initial draft, and expected revision zero; its committed aggregate revision is one.

For every mutation, the store encodes a typed payload containing the operation kind and all semantic arguments with sorted JSON keys. The client `payloadDigest` is stored and returned for correlation, but it is not trusted as payload authority. The operation row stores a bounded immutable result: exact session/draft state, zero or one active reservation, aggregate score/count, derived draft validation/dupe evidence, receipt, and the operation-specific reservation or committed-QSO evaluation. It never copies the complete QSO log into every operation row.

Within one transaction the store first looks up `(sessionID, requestID)` and compares canonical bytes containing operation kind, session/generation/revision/draft scope, and semantic payload. Matching bytes return the original result and receipt even after mutable state advances. Different bytes reject the reused request ID. A new request then validates generation and revision, applies once, advances once, and writes the receipt atomically. Receipt recovery also checks the full generation UUID and correlation digest. A missing receipt remains unresolved; adapters must not invent success or a new request identity.

## Drafts, serials, contacts, and reads

Draft updates persist the full `ContestDraftSnapshot` at the new aggregate revision. After WPX serial reservation, callsign, received exchange, report, entity, and other contact fields remain editable. The transmitted serial always remains fixed; band remains fixed only for band-scoped reservations, and transmitter identity remains fixed only for transmitter-scoped reservations. A temporarily mismatched positive frequency and band can be saved as an incomplete draft, is reported in the immutable validation projection, and must be corrected before commit. The draft and active reservation advance together. Reserve binds the formatted serial into the draft sent exchange. CQ WW rejects serial reservation before any counter mutation.

A reservation is bound to one session, draft, and normalized `session`, `band`, or `transmitter` scope. Counters increase atomically per scope. At most one active reservation may exist for a draft; reserved, transmitted, uncertain, committed, and void records remain in the ledger and numbers are never recycled automatically. Generic transitions cannot mark committed. CQ WPX operator-entry commit requires its valid reservation. QSO commit checks session, draft, scope, sent serial, and pinned session/rule/reference snapshots; it validates and fully rescores before atomically inserting the QSO, committing the reservation, clearing the draft, and advancing the revision.

Session and draft ordering is deterministic. The adapter requires exactly one draft and fails closed otherwise. `sessionReadSnapshot` and manager snapshots are coherent read transactions. Bounded `sessionPageSnapshot` returns session, drafts, active reservations, one log page, and score in one read transaction. Log pages order by timestamp then ID and cap page size at 1,000. Score and page coordinates carry session ID, full generation UUID, and revision; `ContestEngine` remains scoring authority.

The UI worker is an adapter for camel-case DTOs in `UI_CONTRACT.md`. UUID generation is emitted as canonical lower-case text on the wire. No store method transmits, keys, spots, calls a network service, or writes the normal logbook.

## Evidence limits

P3 tests cover close/reopen recovery, immutable replay, stale revisions, canonical conflict, invalid-QSO rollback, WPX reservation requirements, non-serial contest rejection, serial non-reuse, reservation-preserving edits, scope-bound transitions, structural validation, deterministic/atomic reads, concurrent migration, migration rollback, schema-version failure, full UUID identity, and concurrent SQLite writers. macOS native and portable-manifest tests are not Windows/Linux execution evidence, production integration, crash/power-loss certification, or sponsor approval.
