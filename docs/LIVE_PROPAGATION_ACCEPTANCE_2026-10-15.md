# Live HF propagation acceptance — 15 October 2026

The production `LivePublicServiceMethods` propagation owner was exercised against
the real N0NBH/HamQSL HTTPS feed from an isolated temporary workspace. This path
uses the same bounded credential-free transport and parser shipped in installed
alpha.29; those implementation files are byte-identical to packaged source
`db7ed4734826ea90cfd69b345c4d6174778894e5`.

Two consecutive explicit refreshes completed in one 4.440-second test run. The
second current snapshot reported:

- solar flux 136;
- A-index 13;
- K-index 2;
- five parsed day/night band groups;
- source `N0NBH / HamQSL` and `stale: false`.

The probe is committed as a default-disabled test gated by
`XLOG_PROPAGATION_LIVE_PROBE=1`; normal test runs never contact the public feed.
The complete fixture-backed public-service suite passes seven tests with the live
probe skipped by default. This closes real-network transport/parser/refresh
acceptance. Visual freshness in the installed header and provider behavior during
a future outage remain operator-observation items.

No production logbook, credential, radio, station, rotor or RF state was read or
changed by this test.
