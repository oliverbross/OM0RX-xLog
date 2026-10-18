# Declarative contest operator archives

This slice adds one bounded export projection to the shared declarative contest engine. A definition orders typed values already present in `ContestQSO` and assigns each a fixed width, alignment and required/optional state. The renderer supplies the common Cabrillo 3.0 envelope, ASCII checks, frequency/date/time formatting and deterministic QSO ordering. It does not evaluate expressions or invoke contest-specific Swift code.

The only admitted purpose is `operatorArchive`, with `retainAll` duplicate records. The result carries that purpose in `ContestExportArtifact`; Cabrillo adds `X-OM0RXXLOG-PURPOSE: OPERATOR-ARCHIVE`, and ADIF adds `APP_OM0RXXLOG_EXPORT_PURPOSE=OPERATOR_ARCHIVE`. Missing required values, unsafe text, oversized values, unknown field IDs, duplicate column sources, omitted required exchange/report fields and unsupported policies fail closed. Optional absent values occupy their declared width.

The portability workflow explicitly discovers and executes `ContestDeclarativeExportServiceTests` on macOS, Linux and Windows. Core goldens render all seven archive definitions and every supported mode, including CW plus the 10-10 SSB, AM and FM profiles. A valid exchange wider than its configured output column reaches the renderer's width guard; unsafe structured text is rejected by common engine validation and remains blocked by the renderer when its lower-level line API is called directly.

Export resolution starts from the atomic `ContestSessionReadSnapshot`. If the session has canonical declarative definition bytes, the export service decodes them, verifies their digest, canonical byte representation and exact session identity, and constructs the rule from those bytes. It never falls back to the current registry when persisted bytes exist but are invalid. Legacy static sessions with no persisted definition continue to use the existing registry path.

## Archive definitions

Archive-enabled definitions use version `2.0.0-declarative-archive`; the existing 10-10 and CW unique-call preview definitions remain byte-for-byte stable and keep their original digests.

- CW Open follows the official Cabrillo ordering: sent serial/name, contacted call, received serial/name. The log retains duplicate contacts. Each event session remains a separate xLog session; combined sponsor scoring is not implemented by replaying multipliers across sessions.
- CWT records name plus member number or location in both directions. Its official page directs score reporting to 3830, so this file is an operator archive and is not represented as a sponsor submission.
- ICWC MST records name/serial in both directions. The official rules say to submit scores without logs and keep logs available, so this file is also an operator archive.
- 10-10 records reports plus name, member number and QTH in both directions. Multiword QTH values remain one typed fixed-width field.

The official snapshots and hashes remain those pinned by the preceding shared-policy review: CWT `d98a97401dee2cf8106efb1756b78875ce900024715b3bebb19ef2919c646056`, CW Open `b73265ece8bc6e6d6e874a108ddf7ec1e2808c3d9fbdffd3b7380cd30629685a`, and ICWC MST `c594f23f513853a42c0644fb8243e5d24700b7a381a2611bc2dd44b862fef289`. The 10-10 provenance remains embedded in its definition and documented in `TEN_TEN_DECLARATIVE_PILOT.md`.

## Activation boundary

These definitions remain outside the active 16-rule catalog. Export is executable through the shared service for an admitted persisted definition, but the new contests are not submission-ready. Category and event-window modeling remains open for the cohort; CW Open separate-session aggregation and sponsor workflow remain open; ICWC MST regional frequency and 7030 kHz QRP running constraints remain open; 10-10 eligibility and edition-specific submission details remain open. ADIF uses the existing descriptor projection and is labeled as an operator archive.

The same projection is serializable in authored definitions, so a future Create Contest workflow can generate and validate it without adding a Swift contest class. A sponsor-specific layout or adjudication rule requires a new reviewed reusable policy; it cannot be silently approximated by this archive projection.
