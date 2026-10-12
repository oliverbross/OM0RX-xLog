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

The signed alpha.8 native workflow passed 21 checks with 100,002 generated
contacts: first logbook display 72 ms, cold Awards 697 ms, repeat Awards 31 ms.
Those measurements belong to alpha.8, not to this replacement package.

Signing, notarization, installed Chaser verification and exact alpha.9 package
acceptance remain separate gates. No hardware keying, tuning, serial probing or
rotor motion was performed. Portable live cluster transport, authenticated
services, secure credential stores and remaining parity-ledger gates are open.
