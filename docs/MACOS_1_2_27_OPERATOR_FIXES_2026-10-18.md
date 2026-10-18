# OM0RX-xLog 1.2.27 operator fixes — 2026-10-18

- Release source: `ed795da5944ac63a9e21df42eef939e278f5c71a`
- Canonical commits: `441f805` (portable callsign map coordinates), `543114f` (stable operator header), `53c65af` (DXCC confirmation semantics), `774040f` (persistent automatic rotor), `ed795da` (version 1.2.27)
- Installed bundle: `/Applications/OM0RX-xLog.app`
- Previous bundle backup: `/Applications/OM0RX-xLog.app.backup-1.2.26-20261018-201733`
- Installed executable SHA-256: `8eed41bad1e2c2255320a66eabd8524048a7f2eccd82c71592aa342465cf8633`
- Installed Swift worker SHA-256: `8a57b0261631404559cf611b3da77bca2ddcf7953ba8d00e745360552ae86091`

The release corrects map coordinates for portable callsigns, prevents the operator header from changing height when a spot is selected, reports confirmed DXCC status independently of the current band and mode, and preserves the user's automatic-rotor selection when rotor preferences are saved.

Focused source acceptance passed: six portable-callsign tests; the production frontend build plus four focused header tests; ten cluster-status Swift tests plus 35 Band Maps tests; and the focused automatic-rotor Rust test. Canonical packaging then passed the 3/3 package preflight, universal Swift worker build and self-test, production frontend build, Tauri release build, and strict deep Developer ID signature verification. Candidate and installed executable and worker hashes match.

The normal application was quit gracefully, replaced recoverably, and relaunched as version 1.2.27. A live UI inspection confirmed the normal app window is responsive, connected to the station and cluster, and displaying the existing integrated logbook data. The separate Contesting Test application remained running throughout and was not replaced or modified.

Acceptance boundaries: packaging and installation did not transmit RF or exercise live radio, amplifier, or rotor movements. The application is Developer ID signed but not notarized, so macOS `spctl` reports `Unnotarized Developer ID`; strict code-signature verification passes. This is a local macOS installation, not a public distribution release.
