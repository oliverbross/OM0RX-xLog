# Pilot contest export format contract

This source-fixture-validated pilot formats an immutable `ContestExportInput` in memory. It does not write files, open a chooser, issue an export receipt, or certify that a database read was atomic. A later store adapter must construct the input from one atomic snapshot containing the session revision, frozen station and session metadata, exact rule identity, reference-data version, and complete QSO collection.

## Snapshot and validation boundary

The input carries full session and workspace UUIDs, the aggregate revision, schema and formatter versions, an explicit UTC generation time, the frozen `ContestSessionSnapshot`, explicit operator/session metadata and Cabrillo categories, and every QSO to format. Both formatters require the input rule identity and reference version to match the frozen session. They reject mismatched station/header metadata, invalid lifecycle timestamps, duplicate QSO IDs, cross-session contacts, non-finite QSO times, and rule validation failures. A QSO operator must belong to the frozen station operator list; an empty QSO operator is the one documented fallback and maps to the export metadata operator. Scoring is recomputed from the supplied contacts; a caller cannot inject a claimed score.

QSO ordering is UTC timestamp followed by the complete UUID string. Cabrillo output uses CRLF, retains duplicate QSO lines while the rule engine removes their score contribution, rounds Hz to the nearest whole kHz with ties to even (matching the pinned Python source), and fails instead of truncating fields wider than the Cabrillo columns. The golden CQ WW CW and CQ WPX CW documents exercise categories, score, exchanges, duplicates, ordering, frequency conversion, and leading-zero exchange text.

## Cabrillo source comparison

The parity reference is the read-only `contest-sw` checkout at `7c8b499225a73f7f8f792246881bd7aefc05452f`, specifically `not1mm/plugins/cq_ww_cw.py`, `not1mm/plugins/cq_wpx_cw.py`, and `not1mm/lib/plugin_common.py`. The pilot preserves their contest identifiers, QSO column layout, ascending chronology, integer-kHz output, headers, and CRLF convention.

Intentional differences are strict and deterministic: the formatter has no filesystem or clock access; it accepts no live database handle; it validates rather than silently dropping unencodable text; it breaks timestamp ties by full QSO UUID; it recomputes score from the supplied snapshot; and it binds the exact rule and reference identities. This is source parity evidence, not current sponsor approval or a submission-ready workflow.

## ADIF 3.1.7 mapping

The mapper reuses xLog's `ADIFRecord` writer and parser. It follows the released ADIF 3.1.7 field semantics: `QSO_DATE` and `TIME_ON` are UTC, `FREQ` is MHz, `CONTEST_ID` names the contest, and `STX`/`SRX` contain numeric WPX serials. `STX_STRING` and `SRX_STRING` retain the exact exchange text, including leading zeroes. Lengths are UTF-8 byte lengths as emitted by `ADIFRecord`.

`APP_OM0RXXLOG_*` fields preserve the session ID, workspace generation, session revision, QSO ID, exact rule coordinate, reference-data version, provenance, input schema, and formatter version. Their `ADIFFieldMetadata` declarations are validated before output, and a parser round trip proves the extension field values survive. `ContestQSO` has no arbitrary imported-field bag, so this mapper does not claim lossless preservation of unknown fields from an earlier import.

Authoritative field semantics were checked against the [released ADIF 3.1.7 specification](https://adif.org/adif/) and its definitions for ADI byte lengths, UTC date/time, MHz frequency, contest identifiers, serial fields, and application-defined fields.

## Deferred integration

File writes, save panels, durable receipts, API and UI exposure, import reconciliation, tombstones, and proof of a single atomic database snapshot remain outside this pilot. Sponsor conformance and actual submission acceptance also remain open.
