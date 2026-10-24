# DXpedition Map providers

## Catalogue

- `adxo`: `https://www.ng3k.com/Misc/adxoplain.html`. The parser accepts bounded HTML/text, removes presentation markup, and reads only labelled date, DXCC, callsign, QSL, source, and info fields. Calls are retained as exact announced aliases. Refresh cadence is six hours after success, with a 25-hour freshness window.
- `425dxn`: the existing shared 425DXN calendar route and parser. DX Map keeps only records classified as `dxpedition`; other Chaser & DX kinds remain unchanged.

Both use the existing bounded, redirect-refusing public-feed transport, single-flight refresh owner, last-good cache, source-specific health, and safe error code. A failed provider remains visibly degraded; cached catalogue data does not become a live cluster observation.

## Cluster observations

DX Map reads `contest_spots`, the bounded pre-presentation-filter projection from the existing cluster session. It does not open a connection, alter the operator's Cluster filters, or use renderer-supplied action fields. The native owner attaches one activation token to the same report in both `snapshot.spots` and `contest_spots`, and rejects conflicting duplicate identities.

## Local state and external links

Local QSO-history fields come from the shared opportunity/logbook projection. Club Log totals, QSO rate, and watcher counts remain unavailable because no production provider contract is configured. Club Log, QRZ, DXWatch, and provider links are HTTPS-only external links with encoded callsigns; no remote content runs inside a privileged frame.
