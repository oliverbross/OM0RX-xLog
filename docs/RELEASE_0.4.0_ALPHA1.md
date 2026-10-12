# OM0RX-xLog Integration 0.4.0-alpha.1

Mac-first shared Tauri/React integration preview. **The stable native macOS
v0.3.0 apps remain unchanged and are still the production recommendation.**

## Included

- A real persistent Swift service worker inside the shared desktop application.
- Verified, independent copying of an existing native xLog SQLite logbook;
  real search/edit/import/export, backups and native award calculations.
- Embedded xCluster TCP/Telnet services, filters, classifications, maps, console,
  reconnect and separate credentials. No fixture spots or contacts at runtime.
- Embedded xCat Remote Agent and DCU-1 transport, station configuration/control
  surfaces and a separate compact monitor. Connections require explicit setup.
- Native reference, QRZ, weather and manual Wavelog service paths.

## Mac installation

Apple Silicon, macOS 14 or newer. Copy **OM0RX-xLog Integration.app** into
Applications alongside the stable apps. Do not replace or delete the stable apps.
The preview uses separate application data and Keychain identities.

This alpha is **ad-hoc signed, not Developer ID signed or notarized**. macOS may
prevent opening a downloaded copy. Do not disable Gatekeeper or other security
protections; use a trusted local source build or wait for a notarized release.

Choose “Copy my existing xLog logbook” to create the isolated working copy.
Automatic sync is disabled; do not run multiple Wavelog writers on the same log.
Enter secrets only in the application's credential fields, never in issue reports.
Use a distinct cluster login when retaining a standalone cluster session.

## Evidence and boundaries

Built from `b9744fd91b8eddcbf8481eb3674423d2a776836c`.
Local final tests: **174 passed, 0 failed** (49 native Swift, 77 shared Mac Swift,
35 frontend, 10 Rust, 3 process). Both clean Mac GitHub workflows passed.
The installed app reopened a real isolated 67,843-contact logbook, searched actual
contacts, rendered awards, and received real ShackCQ spots using the separately
authorized OM0RX-13 login. No real QSO was fabricated, edited, deleted or synced
for acceptance. No RF, tuning or rotor motion was used.

This is **not 100% native parity**. Direct-agent credentialed acceptance, observed
tune/rotor/Maestro forwarding, full native presentation parity, local Hamlib,
Windows/Linux live services and notarized clean-machine qualification remain
open. Standalone xCat recovered after Windows restart, but its loopback status
socket currently resets the new app's reads; do not mistake its recovered radio
display for embedded-client acceptance.

See `P2_MAC_LIVE_INTEGRATION.md` for setup, preservation and the complete open
gate list. The archive includes dependency notices; corresponding source is on
GitHub at the build commit. Do not use this alpha as the only copy of a logbook.
