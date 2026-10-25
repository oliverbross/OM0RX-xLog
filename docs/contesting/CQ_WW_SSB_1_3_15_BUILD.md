# macOS 1.3.15 — entry multiplier status

Application change: `2a8b7d4fda7b8d39789febc7bfa27c1aacf2d28c`.
Build from clean canonical main using `bash prototype/scripts/package-macos.sh`.
The release commit containing this version change is embedded as sourceCommit in
DistributionMetadata/components.json and Not1MM/python-runtime.json. Installed
exact-source verification will be recorded after packaging.

CQ WW SSB/CW entry now distinguishes new zone, new country, both and no new
multiplier from the credited contest log and received exchange. DUPE retains
priority. Pending call, zone and frequency changes suppress stale status.
Other contest rules and Multi-Op clients retain their previous status behavior.

Pre-package validation: 96 Python, 13 focused frontend and one native protocol
regression passed, plus TypeScript and independent diff review. Existing 1.3.14
forwarding acceptance is reused for unchanged code. Macro completeness is
recorded separately in [the audit](MACRO_STATUS_2026-10-25.md); no hardware CW,
recorded audio, routing, PTT or transmitter acceptance is claimed.

Installation must preserve a fresh log/settings backup and signed 1.3.14 rollback.
No production test QSOs or RF/PTT/rotor commands are part of this release check.
