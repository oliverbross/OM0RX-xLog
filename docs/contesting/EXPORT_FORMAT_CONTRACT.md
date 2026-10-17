# Pilot contest export format contract

This source-fixture-validated pilot formats an immutable `ContestExportInput` in memory. It does not write files, open a chooser, or issue an export receipt. `ContestExportService` constructs the input from one atomic repository snapshot containing the session revision, frozen station and session metadata, exact rule identity, reference-data version, and complete QSO collection.

## Snapshot and validation boundary

The input carries full session and workspace UUIDs, the aggregate revision, schema and formatter versions, an explicit UTC generation time, the frozen `ContestSessionSnapshot`, explicit operator/session metadata and Cabrillo categories, and every QSO to format. Both formatters require the input rule identity and reference version to match the frozen session. They reject mismatched station/header metadata, invalid lifecycle timestamps, duplicate QSO IDs, cross-session contacts, non-finite QSO times, and rule validation failures. A QSO operator must be the frozen station callsign or belong to its frozen operator list; an empty QSO operator is the one documented fallback and maps to the export metadata operator. Scoring is recomputed from the supplied contacts; a caller cannot inject a claimed score.

`ContestExportService` performs exactly one `sessionReadSnapshot` repository call, fences the full session ID, workspace generation, and revision, and derives all persisted export fields from that immutable value. Stored `Single Operator` and `single-op` aliases map through the version-one pilot category table to `SINGLE-OP`; unknown categories fail closed. The returned artifact separately preserves the stored session label, selected operator, and complete operational station snapshot. The caller supplies bounded Cabrillo submission metadata: `NAME` is the entrant's name and `LOCATION` is the contest location designator (`DX` for a foreign station, or the caller-supplied ARRL/RAC section where applicable). Neither field is inferred from the session label or the untyped operational `station.location`. The supplied `OPERATORS` list must cover the selected operator and every nonempty QSO operator, and may contain only identities from the frozen station/operator set. The caller cannot override the stored operator category, station callsign, rule, or reference-data version. The artifact creates no receipt and the service does not mutate drafts, reservations, QSOs, or revisions. These meanings follow the WWROF [Cabrillo V3 header definitions](https://wwrof.org/cabrillo/cabrillo-v3-header/) and [developer notes](https://wwrof.org/cabrillo/cabrillo-specification-notes/).

QSO ordering is UTC timestamp followed by the complete UUID string. Cabrillo output uses CRLF, retains duplicate QSO lines while the rule engine removes their score contribution, rounds Hz to the nearest whole kHz with ties to even (matching the pinned Python source), and fails instead of truncating fields wider than the Cabrillo columns. The golden CQ WW CW and CQ WPX CW documents exercise categories, score, exchanges, duplicates, ordering, frequency conversion, and leading-zero exchange text.

## Cabrillo source comparison

The parity reference is the read-only `contest-sw` checkout at `7c8b499225a73f7f8f792246881bd7aefc05452f`, specifically `not1mm/plugins/cq_ww_cw.py`, `not1mm/plugins/cq_wpx_cw.py`, and `not1mm/lib/plugin_common.py`. The pilot preserves their contest identifiers, QSO column layout, ascending chronology, integer-kHz output, headers, and CRLF convention.

Intentional differences are strict and deterministic: the formatter has no filesystem or clock access; it accepts no live database handle; it validates rather than silently dropping unencodable text; it breaks timestamp ties by full QSO UUID; it recomputes score from the supplied snapshot; and it binds the exact rule and reference identities. This is source parity evidence, not current sponsor approval or a submission-ready workflow.

## ADIF 3.1.7 mapping

The mapper reuses xLog's `ADIFRecord` writer and parser. It follows the released ADIF 3.1.7 field semantics: `QSO_DATE` and `TIME_ON` are UTC, `FREQ` is MHz, `CONTEST_ID` names the contest, and `STX`/`SRX` contain numeric WPX serials. `STX_STRING` and `SRX_STRING` retain the exact exchange text, including leading zeroes. Lengths are UTF-8 byte lengths as emitted by `ADIFRecord`.

The current untyped operational `station.location` is used only to validate each QSO against its frozen station snapshot. It is not emitted as `MY_GRIDSQUARE`, `MY_CITY`, or Cabrillo `LOCATION`; those standards fields require a future typed station-location contract rather than guessing from a free-form value.

`APP_OM0RXXLOG_*` fields preserve the session ID, workspace generation, session revision, QSO ID, exact rule coordinate, reference-data version, provenance, input schema, and formatter version. Their `ADIFFieldMetadata` declarations are validated before output, and a parser round trip proves the extension field values survive. `ContestQSO` has no arbitrary imported-field bag, so this mapper does not claim lossless preservation of unknown fields from an earlier import.

Authoritative field semantics were checked against the [released ADIF 3.1.7 specification](https://adif.org/adif/) and its definitions for ADI byte lengths, UTC date/time, MHz frequency, contest identifiers, serial fields, and application-defined fields.

## Deferred integration

File writes, save panels, durable receipts, API and UI exposure, import reconciliation, and tombstones remain outside this pilot. The bridge relies on the durable repository's atomic `sessionReadSnapshot`; formatters cannot independently certify how a caller constructed any input outside that bridge. Sponsor conformance and actual submission acceptance also remain open.
