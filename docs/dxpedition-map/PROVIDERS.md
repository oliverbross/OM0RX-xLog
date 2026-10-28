# DXpedition Map providers

## Catalogue

- `adxo`: `https://www.ng3k.com/Misc/adxoplain.html`. The parser accepts bounded HTML/text, removes presentation markup, and reads only labelled date, DXCC, callsign, QSL, source, and info fields. Calls are retained as exact announced aliases. Refresh cadence is six hours after success, with a 25-hour freshness window.
- `425dxn`: the existing shared 425DXN calendar route and parser. DX Map keeps only records classified as `dxpedition`; other Chaser & DX kinds remain unchanged.

Both use the existing bounded, redirect-refusing public-feed transport, single-flight refresh owner, last-good cache, source-specific health, and safe error code. A failed provider remains visibly degraded; cached catalogue data does not become a live cluster observation.

The repaired parser version forces one automatic refresh of older catalogue caches, so updated portable aliases are available immediately after upgrade. A successful refresh retains removed records only when they recently ended; it does not retain withdrawn active announcements. Matching exact aliases and overlapping dates reconcile records across providers; conflicting explicit IOTA groups and separate visits remain separate.

## Club Log

`https://clublog.org/expeditions.php?api=1` is the primary public tuple feed: `[callsign, last QSO UTC, total]`. It currently serves JSON with a `text/html` content type, so the existing bounded HTML transport collects it and a separate strict JSON parser validates the tuples. No credentials, cookies or third-party proxy are used. DXMap refreshes at 90 seconds, with the shared owner enforcing a minimum 60-second attempt interval. Source freshness is five minutes; a validated last-good response is retained for up to 25 hours with stale presentation on failure.

Enrichment joins an exact announced alias only when the last QSO lies within that occurrence's dates. An old activation's totals are not assigned to a future return visit. Last-QSO time can establish recent activity, but never supplies or authorizes a tuning frequency. QSO/h and watcher counts are not supplied by this API.

## Cluster observations

DX Map reads `contest_spots`, the bounded pre-presentation-filter projection from the existing cluster session. It does not open a connection, alter the operator's Cluster filters, or use renderer-supplied action fields. The native owner attaches one activation token to the same report in both `snapshot.spots` and `contest_spots`, and rejects conflicting duplicate identities.

Separate exact-call queries read the existing durable Spot History for the preceding 48 hours, bounded to 256 aliases and 15 retained observations per alias. Band/mode diversity is preferred within each newest-100 query. These display-only rows have no activation token. The existing archive's recording gaps/retention still bound the available evidence; DXMap cannot reconstruct reports that were never received or recorded. Reads are cached for 30 seconds and never open a cluster/radio connection.

## Coordinates

An installed IOTA/reference position or published coordinates take priority. Otherwise the catalogue's declared entity is matched against the existing CTY endpoints, with callsign resolution as fallback. This is explicitly labelled an approximate DXCC entity centre. It is presentation evidence and does not modify callsign/DXCC classification elsewhere in xLog.

## Local state and external links

Local QSO-history fields come from the shared opportunity/logbook projection and are displayed separately from the expedition's Club Log total. Club Log, QRZ, DXWatch, and provider links are HTTPS-only external links with encoded callsigns; no remote content runs inside a privileged frame.
