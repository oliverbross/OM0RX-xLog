# Integration 0.4.0-alpha.7

Development prerelease of the shared xLog application; the original native app
and logbook remain separate. This is not full radio/rotator or OS parity sign-off.

## Changes

- Persistent revision-fenced awards/statistics caches and indexed callsign history
  reduce repeated large-log work. App-wide installed timing acceptance remains open.
- Settings → CW supports up to 20 named, coloured macros, safe substitution
  previews, optional F-key shortcuts, and selected compact Operator Desk buttons.
- CW uses an explicitly armed supported radio or independent WinKeyer session.
  Save/preview/navigation never send. Focus/context changes disarm; uncertain
  delivery retains Stop and never retries message text or switches transmitters.
- WinKeyer requires an explicit saved-port connection and serial-control consent.
  Support is scoped to documented WK2 revision 23 and WK3 revisions 30/31, not
  all legacy firmware, OEM devices or compatible clones.

## Source verification

Frontend 344 tests, Rust 91 tests, Swift core 72 tests, and Mac portable-worker
138 XCTest plus 40 Swift Testing cases passed before the version-only bump.
TypeScript/Vite and source UI review passed; the existing large-bundle warning
remains. Component captures use synthetic data, not physical hardware.

## Important acceptance limits

No radio transmission, serial-device probing, physical keyer/driver hotplug or
rotator motion was tested. Successful text acceptance is not proof of RF output.
Actual Windows/Linux packages and connected-radio/keyer acceptance remain open.
This release note alone does not prove signing, notarization, installation or
runtime success; those are recorded in the exact package acceptance report.

CW defaults to no desk row and no assigned shortcuts. Existing station policy,
credentials and automatic transmit permissions are not changed by this feature.
