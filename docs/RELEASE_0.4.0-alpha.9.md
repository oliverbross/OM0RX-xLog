# Integration 0.4.0-alpha.9

Mac development preview carrying the alpha.8 large-log improvements and a
correction found during installed Chaser testing. The original native app and
logbook remain separate. Full feature and cross-platform parity remain open.

## Chaser correction

WWFF references such as KFF-3017 no longer produce a second, incorrect POTA
row when a cluster spot includes a POTA tag. Mixed spots retain their separate
valid references. SOTA reference tails and explicitly labelled castle references
are also excluded from POTA candidates. QSO draft extraction and directory
resolution share this classification rule.

Each Chaser reference now includes its programme name in the existing cell.
Filtering and loading a draft do not tune or transmit.

## Verification and limits

Before the version bump, 350 frontend tests, 73 native core tests, 139 worker
XCTest cases and 59 Swift Testing cases passed; TypeScript was clean. Regression
tests first reproduced the alpha.8 defect and then passed with the correction.

The exact signed alpha.9 native workflow passed 21 checks with 100,002 generated
contacts: first logbook display 69 ms, cold Awards 689 ms, repeat Awards 18 ms.
These are individual Mac measurements, not app-wide median/p95 guarantees.

Developer ID signing, Apple notarization and Gatekeeper checks passed. Installed
Chaser testing confirmed a live KFF reference appears only as WWFF, while a
genuine POTA reference appears separately. The saved ShackCQ session reconnected
automatically and the 67,846-contact workspace remained available.

No hardware keying, tuning, serial probing or rotor motion was performed.
Portable live cluster transport, authenticated services, secure credential
stores and remaining parity-ledger gates are open. See
`ALPHA9_INSTALLED_ACCEPTANCE_2026-10-13.md` for the exact package identity and
acceptance boundary. This is a Mac prerelease, not a full parity release.
