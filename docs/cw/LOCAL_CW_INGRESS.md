# Local CW classification and history

The trusted native `ClusterSessionService.ingestLocalCW` seam accepts a validated
`CWConfirmedSpot` directly. It shares classification, contact/reference indexes,
scoring, bounded live storage and history publication with network ingress. No
TCP connection, external server configuration, credential or localhost roundtrip
is invented for a local observation.

Local source records have the decoder origin instance as their cluster/source
identity, an empty network host and port zero. Their history segments follow the
decoder session, remain open across an unrelated network-cluster disconnect,
and close on worker termination. Event IDs survive retries. The bounded native
admission cache suppresses duplicate event IDs.

`ClassifiedClusterSpot.localCW` retains session, source/radio/receiver, capture
token/epoch, track, occurrence ranges, model digest and policy version. The
existing archive captures this typed metadata inside its bounded classification
JSON. The database accepts the explicit `local_cw` record kind and stores the
original observed UTC separately from arrival. No schema migration or QSO write
is needed. Eight distinct occurrence ranges are the retained evidence ceiling;
the policy still evaluates all bounded evidence before deciding.

Local CW is a distinct source filter. New defaults show it; an existing saved
explicit source set is preserved. Aggregation retains separate source kinds and
local source identities. Reclassification does not infer a different mode for a
typed CW observation. Receiving a spot does not mark a callsign worked.

`CWSpotWire` uses a validated configured station callsign, ASCII/CRLF, three
decimal places in kHz and the observation's UTC HHMMZ. Unknown WPM and signal
strength are omitted. Parser fixtures cover Hz precision, slash calls and UTC
rollover. These are internal/parser tests; external logger compatibility remains
a separate acceptance gate.

The production policy remains quality-unqualified and the TCI RF mapping remains
hardware-unqualified. This seam does not enable automatic live spot production.
