# Pilot contest export format contract

This source-fixture-validated pilot formats an immutable `ContestExportInput` in memory. It does not write files, open a chooser, or issue an export receipt. `ContestExportService` constructs the input from one atomic repository snapshot containing the session revision, frozen station and session metadata, exact rule identity, reference-data version, and complete QSO collection.

## Snapshot and validation boundary

The input carries full session and workspace UUIDs, the aggregate revision, schema and formatter versions, an explicit UTC generation time, the frozen `ContestSessionSnapshot`, explicit operator/session metadata and Cabrillo categories, and every QSO to format. Both formatters require the input rule identity and reference version to match the frozen session. They reject mismatched station/header metadata, invalid lifecycle timestamps, duplicate QSO IDs, cross-session contacts, non-finite QSO times, and rule validation failures. A QSO operator must be the frozen station callsign or belong to its frozen operator list; an empty QSO operator is the one documented fallback and maps to the export metadata operator. Scoring is recomputed from the supplied contacts; a caller cannot inject a claimed score.

`ContestExportService` performs exactly one `sessionReadSnapshot` repository call, fences the full session ID, workspace generation, and revision, and derives all persisted export fields from that immutable value. Stored `Single Operator` and `single-op` aliases map through the version-one pilot category table to `SINGLE-OP`; unknown categories fail closed. The returned artifact separately preserves the stored session label, selected operator, and complete operational station snapshot. The caller supplies bounded Cabrillo submission metadata: `NAME` is the entrant's name and `LOCATION` is the contest location designator (`DX` for a foreign station, or the caller-supplied ARRL/RAC section where applicable). Neither field is inferred from the session label or the untyped operational `station.location`. The supplied `OPERATORS` list must cover the selected operator and every nonempty QSO operator, and may contain only identities from the frozen station/operator set. The caller cannot override the stored operator category, station callsign, rule, or reference-data version. The artifact creates no receipt and the service does not mutate drafts, reservations, QSOs, or revisions. These meanings follow the WWROF [Cabrillo V3 header definitions](https://wwrof.org/cabrillo/cabrillo-v3-header/) and [developer notes](https://wwrof.org/cabrillo/cabrillo-specification-notes/).

QSO ordering is UTC timestamp followed by the complete UUID string. Cabrillo output uses CRLF, retains duplicate QSO lines while the rule engine removes their score contribution, rounds Hz to the nearest whole kHz with ties to even (matching the pinned Python source), and fails instead of truncating fields wider than the Cabrillo columns. The golden CQ WW CW and CQ WPX CW documents exercise categories, score, exchanges, duplicates, ordering, frequency conversion, and leading-zero exchange text.

## Cabrillo source comparison

### Versioned submission projection

Explicit `pilot-1` inputs and default direct formatter calls retain the legacy
interpretation and golden output, including rejection of off-band contacts for
a single-band header. CW ADIF continues to use `pilot-1`; its preservation mapping
is unchanged. Unknown formatter versions are rejected.

`ContestExportService` selects the formatter policy pinned by the rule entry descriptor: `pilot-2` for the CW submission projection and `ssb-pilot-2` for SSB. ADIF artifacts likewise carry the descriptor's base policy (`pilot-1` or `ssb-pilot-1`).
This policy first validates every contact in the coherent captured snapshot,
then recomputes the claimed score over all contacts for `ALL`, or over the
selected band only. Every original valid contact is rendered in deterministic
order, including off-band contacts and duplicates. An invalid off-band contact
still rejects the export. Selected-band scoring starts a fresh rule-engine
pass, so an earlier WPX prefix on another band cannot consume selected-band
multiplier credit. No eligible contacts produces a zero claimed score. The
artifact metadata and Cabrillo claim use the same projection; a mismatched
caller-supplied score is rejected.

The supported projection preview category is single-operator CW or SSB with no overlay,
one transmitter, power `HIGH`, `LOW`, or `QRP`, assistance `ASSISTED` or
`NON-ASSISTED`, and `ALL` or one supported pilot band. Unsupported combinations
are explicit errors. This change does not alter stored session scores, rule
identities, historical receipts, serials, or previously prepared bytes. It does
not add event-window, operating-time, station-eligibility, or current sponsor
validation; both pilots remain source-derived previews, not submission-ready
implementations. The sponsor audit records the remaining gaps separately.

The parity reference is the read-only `contest-sw` checkout at `7c8b499225a73f7f8f792246881bd7aefc05452f`, specifically `not1mm/plugins/cq_ww_cw.py`, `not1mm/plugins/cq_wpx_cw.py`, and `not1mm/lib/plugin_common.py`. The pilot preserves their contest identifiers, QSO column layout, ascending chronology, integer-kHz output, headers, and CRLF convention.

Intentional differences are strict and deterministic: the formatter has no filesystem or clock access; it accepts no live database handle; it validates rather than silently dropping unencodable text; it breaks timestamp ties by full QSO UUID; it recomputes score from the supplied snapshot; and it binds the exact rule and reference identities. This is source parity evidence, not current sponsor approval or a submission-ready workflow.

## ADIF 3.1.7 mapping

The mapper reuses xLog's `ADIFRecord` writer and parser. It follows the released ADIF 3.1.7 field semantics: `QSO_DATE` and `TIME_ON` are UTC, `FREQ` is MHz, `MODE` is the descriptor's CW or SSB mode, `CONTEST_ID` names the contest, and `STX`/`SRX` contain numeric WPX serials. WPX CW and SSB advertise the numeric `stxSrx` mapping; WW advertises none. `STX_STRING` and `SRX_STRING` retain the exact exchange text, including leading zeroes. Lengths are UTF-8 byte lengths as emitted by `ADIFRecord`.

The current untyped operational `station.location` is used only to validate each QSO against its frozen station snapshot. It is not emitted as `MY_GRIDSQUARE`, `MY_CITY`, or Cabrillo `LOCATION`; those standards fields require a future typed station-location contract rather than guessing from a free-form value.

`APP_OM0RXXLOG_*` fields preserve the session ID, workspace generation, session revision, QSO ID, exact rule coordinate, reference-data version, provenance, input schema, and formatter version. Their `ADIFFieldMetadata` declarations are validated before output, and a parser round trip proves the extension field values survive. `ContestQSO` has no arbitrary imported-field bag, so this mapper does not claim lossless preservation of unknown fields from an earlier import.

Authoritative field semantics were checked against the [released ADIF 3.1.7 specification](https://adif.org/adif/) and its definitions for ADI byte lengths, UTC date/time, MHz frequency, contest identifiers, serial fields, and application-defined fields.

## Deferred integration

File writes, save panels, durable receipts, API and UI exposure, import reconciliation, and tombstones remain outside this pilot. The bridge relies on the durable repository's atomic `sessionReadSnapshot`; formatters cannot independently certify how a caller constructed any input outside that bridge. Sponsor conformance and actual submission acceptance also remain open.

## Prepared artifact transport

`ContestExportLane` exposes typed prepare, read, and release operations for a future worker adapter. Prepare accepts a caller-generated canonical export UUID, the full session/workspace/revision coordinate, an explicit UTC generation time, format, and bounded Cabrillo header. It returns `Prepared` metadata, byte count, SHA-256, chunk limit, and monotonic lifetime; it never reports a file as saved. Reads are scoped to the artifact, session, and workspace and return bounded base64 chunks from the immutable cached bytes. Release is scoped and idempotent.

The in-memory cache holds at most four artifacts, 64 MiB in aggregate, and 32 MiB per artifact; raw read chunks are capped at 64 KiB. Before formatting starts, each producer reserves an artifact slot and the full 32 MiB allowance, so the default aggregate bound permits at most two worst-case producers at once. Success and failure release that reservation exactly once. Release, generation discard, and shutdown retire and cancel pending work but keep its reservation charged until the producer actually settles, including producers that ignore cooperative cancellation. The cache also retains at most 1,024 bounded canonical request identities and tombstones, after which new preparation fails with `cache_full` rather than forgetting an old ID. Exact prepare replays for a known ID return the original artifact. An ordinary formatter failure retains the canonical request and permits an exact retry; changed input remains a conflict. Expired or released IDs cannot silently recapture current database state. Restarted processes report old artifact reads unavailable because prepared bytes are deliberately not durable; callers must allocate a new export ID before preparing again in a fresh process. Every operation checks the current workspace generation before and after its response using ordered observations enforced by both the lane and cache; a delayed older sample cannot discard or authorize a response after a newer sample. Overlapping callers may therefore receive `workspace_fence_failed` when one observation supersedes another even if the sampled UUID is unchanged; this means the response was not authorized, rather than proving the workspace changed, and the caller may retry the same export ID with the exact same payload. Historical reads remain valid across later session revisions in the same workspace generation. UTC request timestamps must round-trip through the strict millisecond formatter exactly, rejecting normalized dates or `24:00` before cache admission.

This transport writes no files and exposes no arbitrary path. A later native save layer must reuse the audited native writer and own destination selection, temporary-file publication, flushing, and save receipts. Cache shutdown, expiry, and generation changes only discard memory; they do not create QSO receipts, audits, or database revisions.

The worker exposes this transport only as `contest_export_prepare`, `contest_export_read`, and `contest_export_release`. The existing main-window admission boundary permits those exact methods; detached windows and production profiles reject them. Export operations use the dedicated export actor rather than the serialized contest-mutation tail, so a pending formatter does not block release or ordinary contest work. Terminal shutdown is checked before admission and after every generation or export await; shutdown cannot lazily create a new cache or authorize a late response. The methods are classified as bounded, non-retiring reads by the native worker session because they cannot mutate the contest database or station state. A timeout or uncertain read response may be retried with the exact artifact coordinate and byte range. A transient `workspace_fence_failed` preparation may likewise retry the same export ID and identical payload. `artifact_unavailable` is terminal for that prepared artifact: the caller must allocate a new export ID and explicitly prepare a new snapshot rather than silently recapturing current data.

The typed client accepts no path and validates exact response schemas. UUID coordinates accept the full Foundation UUID domain only in canonical lowercase `8-4-4-4-12` hexadecimal form; they do not impose UUID version or variant policy. It caps prepared artifacts at 32 MiB and raw chunks at 64 KiB, requires contiguous offsets and truthful EOF, checks every chunk against the prepared session, workspace, revision, byte length and digest, decodes canonical base64, and verifies the SHA-256 of the complete in-memory result. The generated Swift fixture at `docs/contesting/fixtures/contest-export-worker-wire.json` records actual `LiveWorker` prepare, exact replay, chunk read, release, unavailable, unknown-method, wrong-profile, and shutdown frames. Window-label denial remains native Rust evidence because Swift `LiveWorker` has no window identity. This checkpoint is worker transport only and does not claim a saved file, native dialog, UI workflow, or sponsor acceptance.

## Native save boundary

The native `contest_export_save` command accepts only the prepared artifact coordinate and is compiled for the main Contesting Test window. Its `prepared.artifactID` is copied exactly from the typed `Prepared.artifactID`; native code never generates or substitutes an artifact ID. The renderer cannot provide a destination path. Native code reads the already-prepared artifact from the existing worker in chunks of at most 64 KiB, pins every read to the first worker generation, validates the complete artifact/session/workspace/revision/length/digest coordinate, and verifies SHA-256 before opening the native save panel. It renews runtime admission immediately before the panel, then checks admission and artifact availability after selection and again after the temporary file has been flushed, synced, and closed, immediately before exclusive publication. A later contest revision does not invalidate the historical prepared bytes, while worker restart, workspace change, release, expiry, shutdown, malformed chunks, or digest mismatch fail closed.

The chooser starts with the product-facing `xLog Contest.log` or `xLog Contest.adi` filename based only on the prepared format; implementation identifiers are not exposed in the suggestion, and the operator can rename it in the native panel. Cancellation creates no file. Publication creates an owned temporary file only after selection, writes, flushes, syncs, closes, and uses exclusive no-clobber persistence; an existing destination is never replaced and owned temporary files are cleaned on failure. One native lease lives inside the blocking operation, so cancellation of the async command waiter cannot admit a second panel while the first save still runs. Success and cancellation release the prepared cache entry on a best-effort basis; release failure after successful publication cannot downgrade `saved`. A failure retains the artifact for an explicit retry. Results distinguish `saved`, `cancelled`, and `failed` and report the artifact ID and verified hash. `filename` is present only after a safe native selection and contains the bounded basename, never a path; cancellation and failures before selection omit it. An optional message is a bounded native error category. These are save outcomes rather than QSO receipts. A command/IPC loss after invocation is outcome-unknown because the file may already have been published; callers must not automatically save again, and this milestone makes no exactly-once claim.

This milestone has no export button or other renderer integration. Native dialog and filesystem tests use injected adapters; an actual packaged Test app foreground save remains separate runtime evidence.
