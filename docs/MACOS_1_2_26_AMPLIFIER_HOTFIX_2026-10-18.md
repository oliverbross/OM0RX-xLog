# OM0RX-xLog 1.2.26 amplifier hotfix — 2026-10-18

- Release source: `966a57ad5097816377c2e5d92a89a5a5a94b7408`
- Development commits: `cf30a77` (amplifier behavior), `b1db912` (version)
- Canonical commits: `13e5383` (amplifier behavior), `966a57a` (version)
- Installed bundle: `/Applications/OM0RX-xLog.app`
- Previous bundle backup: `/Applications/OM0RX-xLog.app.backup-1.2.25-20261018`
- Installed executable SHA-256: `e1a447d577a6a3c3aa5a908e1fd8c35da51b0c75bab4b2e45467bb47d215253d`

The macOS worker no longer rejects an explicit amplifier Operate request using transient local radio telemetry. The Remote Station Agent remains the authority that accepts or rejects the KPA transition. Confirmed Agent errors are retained and shown directly instead of being relabeled as an unverifiable result.

Focused acceptance: `LiveStationMethodsTests` passed; the new Rust confirmed-rejection test passed; packaging preflight passed 3/3; worker self-test passed; production frontend and native bundle builds passed; strict Developer ID signature verification passed; candidate and installed executable hashes match. No RF transmission or live amplifier transition was performed by the release process.

The normal 1.2.26 app was relaunched successfully. The separate Contesting Test application remained running and was not replaced.
