# OM0RX-xLog 1.2.28 previous-QSO history fix — 2026-10-18

- Release source: `0d53d7554248818f637186598a6d8fef7e23dcc9`
- Development fix: `ee8f78444b6365c9c9a7cb92cc449d9b85eaa9cc`
- Canonical fix: `00a4106fcaa66acacd7279049300f6c41d55365a`
- Installed bundle: `/Applications/OM0RX-xLog.app`
- Previous bundle backup: `/Applications/OM0RX-xLog.app.backup-1.2.27-20261018-2125`
- Installed executable SHA-256: `5402a43c320834bf7c108a618c915258fcb866ef5dde4271e5cb980552e2767f`
- Installed Swift worker SHA-256: `7d2b60673f79c5dfb064e7d5ff5c3bd9d335eb01dc539b0bff9c1ebd62b4cd5f`

The normal-log duplicate banner and previous-QSO presentation now use the same existing base-callsign identity. Operating suffixes such as `/P`, `/M`, `/MM`, `/AM`, `/QRP`, `/QRPP`, `/A`, `/B`, and `/QTH` are included under the base callsign in the Operator Desk, full QSO editor, callsign intelligence card, and detached intelligence window. Location prefixes remain distinct, so a call such as `9A/EA1FOX/P` is not merged into `EA1FOX`.

The native query, database schema, API response shape, result limit, and contest duplicate/scoring identity were not changed. Focused frontend acceptance passed 57/57 tests. TypeScript checking, the production Vite build, window-bundle validation, package preflight, universal Swift worker build and self-test, Tauri release build, and strict deep Developer ID signature verification passed. Candidate and installed executable hashes match.

The normal 1.2.27 application was quit gracefully, preserved as the rollback bundle above, replaced with 1.2.28, and relaunched. Live UI inspection confirmed the normal app is responsive, connected to the station and cluster, retains the integrated logbook (68,236 contacts visible), and displays its Worked before table. The separate Contesting Test application remained running and was not replaced or modified.

Acceptance boundaries: no QSO was logged or edited and no RF, amplifier, or manual rotor action was initiated during acceptance. The application is Developer ID signed but not notarized, so macOS `spctl` reports `Unnotarized Developer ID`; strict code-signature verification passes. This is a local macOS installation, not a public distribution release.
