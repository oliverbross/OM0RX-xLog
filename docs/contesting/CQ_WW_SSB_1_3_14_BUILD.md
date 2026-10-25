# macOS 1.3.14 — DXpedition Map and continuing radio spot delivery

Installed from canonical `main`, 25 October 2026. **READY WITH LIMITATIONS**.
Exact installed source: `0c2b564868cc7999f7674b65b1643b56c10a18c0`.
The operator confirmed spots visible on Flex/Maestro after installation.

DXpedition implementation: `06b37201ab045cf59436ce7f32d8c3aa39c895ea`.
Reviewed forwarding implementation: `59006e53` (independent review clear).
The release also corrects contest radio publication starvation while another
spot classification is pending, including after a saved QSO. Only verified rows
matching the current scoring revision, input and active band are published.
The existing atomic cluster/band-map display update remains separate.
Pending radio publications coalesce before dispatch. Once admitted, a chunked
publication can finish across harmless typing or new arrivals, but checks its
session, scoring basis, policy and existing rows before every chunk and retry.

Forwarding validation: the 197-test workspace/setup run passed 195 tests; two
unrelated voice simulations timed out and both passed isolated reruns. After the
queue review corrections, all 15 focused forwarding/lifecycle/chunk tests passed,
as did TypeScript and whitespace checks. These are simulated delivery checks,
not evidence of a physical Maestro display.

Build from this canonical checkout using `bash prototype/scripts/package-macos.sh`.
The exact clean build commit is embedded in `DistributionMetadata/components.json`
and `Not1MM/python-runtime.json`; final installed-source evidence is recorded
in the [durable release receipt](evidence/cq-ww-ssb-1.3.14/release-verification.json).
Both embedded receipts match the clean source above. Version files and lockfiles
are aligned at 1.3.14. Developer ID and deep/strict signature checks passed;
notarization is a separate, unclaimed gate.

The user reported no Flex spots on 1.3.13. Live inspection found a connected
ShackCQ cluster with classified 40m spots, live radio telemetry and enabled Flex
forwarding, but no accepted radio inventory. Runtime status remained its startup
message. Regression tests reproduced cross-band and same-band classification
starvation, including renewal after a QSO. This is a demonstrated source defect;
physical display recovery must still be confirmed separately.

DXpedition Map is available through Window → DXpedition Map. It combines NG3K
ADXO and 425DXN catalogues with configured-cluster observations. Browsing is
available while contesting; its explicit Tune & load / Load callsign actions use
Normal Logging. Catalogue positions and missing data remain identified honestly.
See [DXpedition acceptance](../dxpedition-map/ACCEPTANCE.md) for provider, concurrency,
frontend and native test results. Analytics and Log Review from 1.3.13 are retained.

The old settings-safety worktree is archived rather than merged. Its duplicate
settings store and incompatible receipt schema are superseded by integrated
revision checks, restore generations and isolated runtime settings. Existing
settings-safety checks passed (23 tests). Older contest experiments remain
recoverable in the previously verified consolidation bundle.

No production QSOs, station settings, radio tuning, PTT, RF, audio or rotor actions
are used for validation. Installation preserves a fresh data/settings backup and
the previous signed application. Recorded voice remains separately untested.

## Installed acceptance

- Candidate and installed packaged Python each passed 32 disposable tests.
- The exact candidate passed all 35 isolated native checks with station I/O off,
  covering normal logging, edit/delete/undo, ADIF roundtrip, settings and windows.
- Fresh backup: 323 contacts, 30 SQLite databases and 55 settings/service files.
  All QSO, identity and audit rows matched exactly before relaunch.
- Existing contest windows restored; ShackCQ connected with classified 40m spots
  and live VFO indication. Accepted radio inventory grew from 10 to 33 after
  startup. The operator then confirmed the spots on Flex/Maestro.
- DXpedition installed visual inspection was deferred because the operator resumed
  contesting. Its focused frontend/native/provider checks passed; open it later
  with Window → DXpedition Map. Analytics and Log Review acceptance from 1.3.13
  is reused for unchanged behavior, not claimed as a new complete UI run.

Backup: `/Users/oliver/Documents/Backups/OM0RX-xLog-1.3.14-before-install-20261025T093000`.
Rollback: `/Applications/OM0RX-xLog-previous-1.3.13-20261025.app`.
The older signed 1.3.12 rollback is also retained. No production contact was
created, edited, deleted or transmitted for acceptance. Physical radio marker
renewal beyond the 600-second lifetime was not observed in this release check;
focused tests cover renewal. Legacy branch/worktree cleanup remains incomplete,
with unique history and settings changes preserved in verified archives.
