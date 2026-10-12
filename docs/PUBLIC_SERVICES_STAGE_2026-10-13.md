# Shared public services — 13 October 2026

The Windows/Linux worker previously rejected weather, propagation and callsign
lookup at the service router. Weather and propagation now share the same
workspace-owned actor on all platforms. Portable callsign lookup uses the same
CTY base profile and distance/bearing calculation as the Mac authenticated path.
No public request starts during actor construction.

## Behavior and boundaries

- Reuse the native weather decoder and xCat propagation parser. The portable
  xCat source slice includes only propagation and the existing error type; it
  does not claim portable station control or instantiate a radio owner.
- Public HTTP uses HTTPS GET, no cookies, credential store or cache, no redirects,
  a 256,000-byte declared/streamed response limit and bounded request/resource
  timeouts. JSON/XML content types are checked separately. Existing Chaser JSON
  limits and rejection behavior remain unchanged.
- Propagation returns the current snapshot immediately, coalesces polling and
  attempts refresh no more than once per ten minutes. Failed refresh preserves
  values and their original observation/receipt timestamps with a stale flag.
- Concurrent weather requests for one station location share a transfer. A grid
  change cancels an older transfer when a new one starts; a late result for an
  obsolete location is rejected even if the downloader ignores cancellation.
- Worker shutdown cancels pending public transfers and rejects late requests.
  The isolated packaged UI acceptance allowlist still denies these services and
  its health response explicitly reports both capabilities disabled.
- Portable CTY lookup is offline, marked `CTY approximate`, and reports
  `qrz_available: false`. Authenticated QRZ, Wavelog, reference updates, portable
  vaults and direct station services remain separate incomplete parity gates.
  No missing provider is presented as a successful authenticated lookup.

## Verification scope

Five shared-service tests cover offline lookup and callsign validation,
propagation coalescing/stale retention, native weather decoding/concurrent calls,
changed-location rejection, worker routing/shutdown, isolated acceptance denial,
and malformed requests/missing grid without HTTP. Five bounded-transport tests
cover JSON/XML separation, declared and streamed byte limits, hostile responses,
redirect rejection and cancellation. Fixtures do not access external providers,
operator credentials, live logbooks, radio, rotor or serial devices.

The final full Mac run passed 151 XCTest and 68 Swift Testing cases. All five
worker-process framing/isolation tests passed against the rebuilt debug worker;
`git diff --check` passed. Exact final-source platform build and runtime results
must be recorded separately before this stage is accepted.
Installed alpha.9 and the original native application remain unchanged.
