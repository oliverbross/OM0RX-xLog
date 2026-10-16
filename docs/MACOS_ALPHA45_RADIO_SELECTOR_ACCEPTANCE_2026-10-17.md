# macOS alpha.45 radio-selector acceptance — 2026-10-17

## Outcome

The Station Control provider row no longer presents a large `Selected radio:
Unavailable` explanation when the operational radio is already working. The row
uses the observed active provider supplied by the live station surface and shows
it as one compact status chip.

When another provider tab is viewed, the only added action is a short `Use …`
button. Duplicate requested-radio text, rotor-retention prose, successful
selection receipt text and the permanent full-width refresh button were removed
from this row. If the secondary shared-selection snapshot cannot load, the
working observed radio remains visible and a 30-pixel retry control appears.

Connection and selection safety did not change: switching providers still uses
the journaled native selection request, unknown receipts retain their recovery
controls, and no radio is selected or connected on mount.

## Source and package

- Source commit: `50595ea`
- Branch: `codex/macos-alpha33-release`
- Version: `0.4.0-alpha.45`
- Installed app: `/Applications/OM0RX-xLog.app`
- Developer ID: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- Team identifier: `4WCMQ4U946`
- Installed main binary SHA-256: `3977edb28461c3ca9db4b8752422c47c1f9b1891f7f5bef7279cfa890eef0703`
- Installed worker SHA-256: `5efe6cdffec9121718ce261c16239287eb14d260fb6eee66eb77fea06fb4d97a`

## Verification

- Focused radio-session UI suite: 2 files, 62 tests passed.
- TypeScript typecheck, production Vite build and window-bundle checks: passed.
- Signed packaged-app native acceptance: 33/33 checks, `status: passed`,
  `scope: integrated-local-ui`, `embeddedUi: true`, `worker: true`,
  `station_io: false`.
- Installed-app native acceptance: the same 33/33 checks and flags passed from
  `/Applications/OM0RX-xLog.app`.
- Packaged and installed binaries have matching SHA-256 hashes.
- Installed bundle passes strict deep signature verification under team
  `4WCMQ4U946`.

## Rollback

The previously installed, strictly signed `0.4.0-alpha.44` app was moved intact
to:

`/Users/oliver/Documents/OM0RX-xLog-PreAlpha45-Backup-20261017T034900ACST/OM0RX-xLog.app`
