# Contesting UI contract

The contest workspace is an isolated, local-only pilot for CQ WW and CQ WPX in CW and SSB. The React component receives the existing worker request function and never calls station, radio, keying, network, normal-log, or generic service methods.

## Request framing

Requests use the existing worker frame `{ id, method, params }`. The injected renderer request resolves `{ id, ok: true, result }` or `{ id, ok: false, error: { code, message, outcome } }`, where `outcome` is `confirmed` or `uncertain`. Confirmed validation and revision rejections remain editable and do not enter receipt recovery. Transport loss and explicitly uncertain worker outcomes do.

Method names are:

- `contest_catalog`
- `contest_sessions`
- `contest_create`
- `contest_open`
- `contest_draft_get`
- `contest_draft_apply`
- `contest_serial_reserve`
- `contest_qso_commit`
- `contest_qso_get`
- `contest_qso_correct`
- `contest_qso_delete`
- `contest_operation_receipt`
- `contest_log_page`
- `contest_score`

Wire DTOs use camel case and are defined in `prototype/src/contesting/types.ts`. `sessionID` always identifies one contest session. A rule is pinned by `ruleIdentity { id, version, edition, sourceRevision }` plus `referenceDataVersion`. Neither has an implicit active-session fallback. Catalog and session rule projections carry `entryDescriptorVersion: 1` plus the authoritative mode, Cabrillo QSO type and formatter policies, report defaults and UTF-8 bound, exchange meanings, ADIF exchange mapping, and serial requirement/scopes. The client rejects unknown descriptor versions or internally contradictory policies.

## Mutation scope and replay

Every mutation carries `sessionID`, `workspaceGeneration`, `requestID`, `expectedRevision`, optional `draftID`, `payloadDigest`, one finite ISO UTC `operationTimestamp`, and a structured `payload`. The timestamp is generated once before the operation is journaled and remains immutable across dispatch, receipt recovery, and retry. Receipt lookup remains exactly session, generation, request ID, and digest. Create preallocates its stable `sessionID`, uses `expectedRevision: 0`, and includes the exact rule and reference identities. The backend must canonicalize and compare the structured domain payload, including its mapped timestamp, before its revision check. It must reject the same `requestID` with different canonical payload bytes or timestamp; the client digest is correlation data, not authority.

For the pilot, create maps `operationTimestamp` to the session start and initial draft timestamp, draft apply maps it to draft update time, and QSO commit maps it to the logged contact `workedAt`. Serial reservation uses the same immutable operation time for its durable transition. The UI does not generate a different timestamp on retry.

The revision is the session aggregate revision. Draft apply, serial reserve, QSO commit, correction, and deletion compare it and atomically advance it. Draft mutations return the same new revision on the session, draft, and receipt; commit also returns that revision on the score. A correction or deletion returns a distinct bounded change result with its session revision, scalar score, QSO count, current target or tombstone, audit reference, and receipt. It never returns or replaces the operating draft. Pages, full-QSO reads, and scores carry the requested session, generation, and revision. Dates must be finite ISO timestamps. Mode, report widths/defaults, exchange fields, and serial admission come from the pinned entry descriptor; they are not inferred from a rule ID in the UI.

The shared session owner writes a mutation to its generation-scoped recovery journal before transport dispatch. A malformed or stale successful mutation response is still uncertain because the server may have committed it; only a validated success or an explicit confirmed rejection clears the journal. An unconfirmed mutation keeps its original method, scope, request ID, digest, timestamp, and payload across remounts. `contest_operation_receipt` receives exactly `sessionID`, `workspaceGeneration`, `requestID`, and `payloadDigest`. A `not_found` result remains unresolved: it is not success and does not allow the UI to mint a new ID. An explicit retry resends the same logical operation with the same identity and payload. A retry on a newly constructed owner reopens the pinned session after the exact mutation response before adopting state or loading projections. Receipt recovery retains the pending operation until that authoritative reopen succeeds.

Applying a validated correction or deletion first advances the session and draft revision metadata, then reloads the authoritative operating draft before refreshing the log and score. This refresh preserves the draft fields and active serial reservation while replacing stale validation and duplicate state with the backend result. The operating entry and contact editor own separate raw frequency text and validation errors. Opening, editing, or cancelling the contact editor cannot clear an invalid operating frequency, and an invalid editor frequency blocks correction without blocking deletion.

The UI blocks every context change while a mutation is running or unresolved. Rapid repeated actions are coalesced by a synchronous lock. The shared owner issues a mount lease and admission generation; unmount invalidates that lease before a remounted workspace can admit work. Every catalog, open, draft, projection, refresh, receipt, retry, success, failure, and finalizer checks the same lease/admission before changing owner or component state. `contest_open` always sends the expected `workspaceGeneration`, its response must match, and owner activation independently rejects another generation.

## Ownership and presentation

The backend owns durable sessions, drafts, serial reservations, QSOs, receipts, pages, and scores. One owner is shared for the lifetime of an injected workspace transport, scoped again by `workspaceGeneration`, and deliberately resets when that generation changes. It survives React remounts while a live promise settles. It serializes draft saves and drains the newest edit revision before reserve, commit, create, or session switch. A small local test-workspace recovery journal keeps separate unflushed field projections per session/generation plus the exact unresolved request identity. Opening another session never deletes a recovered draft. The journal never stores authoritative contacts, pages, scores, serial state, or fabricated fallback data. Test fixtures provide mock transport responses only.

The workspace uses xLog's existing colors, typography, field controls, table density, focus rings, and responsive card-to-row behavior. It provides:

- a manager to create/open CQ WW and CQ WPX CW/SSB sessions;
- immutable station, operator, CQ zone, and DXCC entity snapshots;
- compact mode-specific callsign, report, exchange, band, frequency, and serial fields;
- explicit validation and contest-dupe state;
- plain local Log QSO with no transmit, ESM, spot, or radio controls;
- paged contest-only contacts and score/multiplier projections;
- a contact editor loaded only by revision- and generation-bound `contest_qso_get`, with Save and Cancel plus one named deletion confirmation;
- visible rule source revision and verification state.

The contact list is a projection and never supplies editor defaults. The editor receives the full stored QSO. Callsign, reports, received exchange, frequency, and band are editable. Original UTC, provenance, operator, station location, and the allocated/sent exchange remain read-only. A correction sends every required field except `entity`; the worker resolves the changed callsign against the session's pinned CTY data at the original UTC and rejects caller-supplied entity data. While the callsign differs from the loaded QSO, the UI labels the displayed country as the original entity until the validated response provides the replacement. Confirmed rejections keep the edit buffer intact. Successful changes refresh the paged log and score after owner adoption and do not optimistically rewrite rows.

At 900 px the manager and operating areas become one column. At 560 px the entry fields and identity strip become two columns and the table becomes labelled contact rows. Long exchanges wrap in those rows without hiding their field names.

`ContestWorkspace.preview.html` is an isolated Vite-only visual harness with synthetic local data. It is not imported by the application and adds no product route. It exists solely to render the real component at review viewports; it must never be treated as backend, native-app, or end-to-end acceptance evidence.
