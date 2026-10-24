# macOS 1.3.14 — DXpedition Map and continuing radio spot delivery

Candidate preparation on canonical `main`, 25 October 2026. Installation and
physical Flex/Maestro acceptance are pending; this is not yet a release pass.

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
and `Not1MM/python-runtime.json`; final installed-source evidence will be recorded
here after packaging. Version files and lockfiles are aligned at 1.3.14.

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
