# Integration 0.4.0-alpha.6

Mac-first prerelease of the shared xLog application, not a replacement for the
stable native release. Packaging and installed acceptance are recorded separately
in the operator feedback tracker.

## Included

- Compact operator workspace tabs and controls, centered HF propagation, visible
  band-map edge labels, improved QRZ image viewer and aligned QSO history/matrices.
- Configurable display scaling, refined rotor instrument, and rotator setup in
  Settings. Browsing providers does not apply a connection change.
- Hide an unconfigured rotor and reclaim its space, or show an optional descriptive
  fixed-antenna card with name, type and bands. An owned rotor retains its controls.
- Explicit standalone local-logbook mode, with Wavelog network sync blocked until
  Wavelog mode is selected. Existing logbooks are not reset or migrated silently.
- Saved cluster-session resume, indexed contact projections and reduced startup
  work; reference checks with per-source freshness, validators and retry backoff.
- Activation/DX opportunity view with explicit refresh and source provenance.

## Verification and limits

- Frontend: 311 tests; TypeScript clean. Rust desktop backend: 68 tests.
  Swift core: 67 tests. Portable-worker Mac
  build: 136 XCTest tests plus 40 Swift Testing cases. These are automated checks,
  not physical-device, Windows/Linux-runtime, or authenticated-provider acceptance.
- Cold award calculations remain multi-second on the 67,846-contact fixture.
  Performance acceptance is still open; warm caches do not close that requirement.
- CW macro parsing/validation foundation is present but no CW editor or WinKeyer
  transport is exposed yet. No keying or RF test was performed.
- Alerts, contest-feed licensing/integration, remaining native parity and wider
  responsive/accessibility checks remain in the project ledgers.
- Reference catalog cache currently checks JSON syntax, not the complete Wavelog
  catalog schema. Live opportunity feeds and all reference services have not been
  accepted against the operator's accounts in this release stage.
