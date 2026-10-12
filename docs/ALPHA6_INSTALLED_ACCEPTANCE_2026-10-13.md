# Alpha.6 installed acceptance — 13 October 2026 (Darwin)

- Source: `248525a6e0570aaf8344870843fed8df0ccaf76d`, pushed to
  `codex/unified-xlog-integration-p2`; clean source at build.
- Signed package built successfully with Developer ID `4WCMQ4U946`.
- Apple notarization: `37682795-687a-4799-8cbc-8d1709b4f61e`, Accepted.
- Staple validation, deep strict signature verification and Gatekeeper assessment
  passed for both build output and `/Applications/OM0RX-xLog Integration.app`.
- Archive SHA-256: `9b623f2b721e146e2f0fd547b6945253f8f45fee751a3fc99e5c8742e17da740`.
- Installed metadata reports version `0.4.0-alpha.6` and the exact source above.
- One installed Integration process and its worker were observed after restart.
  Original native app binary SHA-256 remains
  `7a2b244545c9eb2639cde5f0a152c9cfaf40e2e06fde9ad97fd3184e37efdb97`.
- Existing Integration was quit normally, updated in place and reopened. No new
  archived app copy was made; obsolete files in the Integration bundle were
  replaced/removed to match the signed package. Logs/settings/credentials untouched
  except the temporary equipment preference test described below and its restore.

## Native UI observations

Inspection used the installed Tauri application at 1440×940, not a dev browser.

- Existing 67,846-contact workspace opened; blank QSO draft, original timestamp,
  band and mode survived. Radio, PA and rotor remained offline. No hardware action
  or QSO logging was performed.
- ShackCQ resumed automatically. Live count progressed 0 → 2 → 5 → 12 without
  Connect or Refresh; compact cluster status appeared green beside the tabs.
- Operator Desk redundant title/manual-sync row is gone. HF propagation occupies
  the central header area. Rotator configuration appears in Settings → Rotator.
- Settings → Station equipment showed automatic/fixed/hidden options. Temporarily
  saved Fixed antenna, Vertical, bands 20/17/15/12/10m. Desk displayed the schematic,
  matching band chips and “Configured · no telemetry”, with no rotor commands.
  Revisiting settings retained the selection. Restored original automatic display,
  empty name and empty bands, saved, and confirmed the configured ARCO rotor panel
  returned offline. Existing logbook mode remained local + manual Wavelog sync.
- Display settings defaulted to 100%; no user scaling preference was changed.
- Main Band Maps showed a single heading/control row with Undock beside Add,
  four equal-width full-height charts and complete upper/lower frequency labels at
  120% label size. No band-map page scrollbar was visible at this size.
- Left the application on Operator Desk, Cluster tab, restored equipment settings.

## Remaining acceptance / findings

- At this laptop-size window the global Monitor button wraps to a second header
  row. Operator Desk uses a stacked top layout and vertical scrolling. These
  remain responsive/space-efficiency work, not a closed no-scrollbars gate.
- No packaged cold/warm timing distribution was recorded. Cold awards still take
  several seconds in the isolated large-log benchmark; performance remains open.
- Equipment preference relaunch, unconfigured auto-hide in a fresh installed
  profile, 4K scaling, screen reader and alternate OS acceptance are not proven by
  this batch. Pure settings/visibility tests and synthetic fixtures cover those
  branches only where explicitly documented.
- CW/WinKeyer, alerts, contest integration and broader parity remain incomplete.
