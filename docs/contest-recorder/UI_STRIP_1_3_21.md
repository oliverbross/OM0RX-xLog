# Recorder strip stability fix — 1.3.21

Subsequent operator-authorized [installation and contest restoration completed](INSTALLATION_1_3_21.md). Recording was then resumed on explicit operator request; the package-only boundary below describes the earlier candidate verification.

The Main Logging recorder strip previously wrapped its long, changing source and input descriptions onto extra rows, moving the callsign fields during operation. It now keeps status and all existing controls on one row. The status shows capture state, input activity and synced duration in minutes:seconds; detailed source labels, synced UTC and errors remain in the tooltip and Recorder window. Narrow windows truncate the status rather than moving controls or fields. Capture and replay code are unchanged.

Validation: 189 focused contest/recorder tests passed, plus TypeScript, production frontend build and window-bundle checks. An isolated browser fixture rendered the actual strip component with the real application styles in six states (input present, silent, starting, interrupted, unavailable and stopped) at 980, 700 and 540 pixels. All 18 cases had a 39-pixel strip, an unchanged 53-pixel offset to the callsign label, visible single-row controls and no horizontal overflow. This is isolated layout evidence, not an installed-app runtime claim.

Build only from clean canonical main with `CARGO_BUILD_JOBS=2 bash prototype/scripts/package-macos.sh`. The script embeds its exact Git HEAD in native and distribution provenance, refreshes the frontend, stages the existing worker/Python resources and signs the full bundle. Package identity and verification are recorded below after build.

The active application, production log, settings, recording originals and rollback are not replaced by this UI fix. Applying the candidate requires an operator-approved installation after the live recording can be finalized. No audio or station operation is part of verification.

## Verified candidate

- Version **1.3.21**, exact source **`d2d9c90f5932b7ed6ce845e87986b739909301c1`**. Native executable, Python runtime provenance and distribution source identity agree.
- Bundle: `/Users/oliver/Documents/Builds/OM0RX-xLog-1.3.21-recorder-strip/OM0RX-xLog.app`.
- Executable SHA-256: `ccf9fda06b2e245dbc6bf8ea842541765ef897f5dc3670007e71cb518ce359e5`.
- CDHash: `849ce80e27aecf8ba0926894ae976146cc8e8072`.
- Developer ID Oliver Bross (4WCMQ4U946), Hardened Runtime; deep/strict signature verification passed after copying. Notarization is not claimed.
- Installed 1.3.20 executable, worker and Info.plist hashes are unchanged. The candidate was not launched or installed; the live contest and recording were not interrupted.

The [candidate receipt](evidence/1.3.21/candidate-receipt.json) records package/source/signature and installed-bundle preservation. The [layout summary](evidence/1.3.21/layout-summary.json) records all 18 fixture cases. The self-contained `layout-fixture.html`, `strip-layout.png` and complete `package.log` are retained beside the candidate. The 189 focused tests, six packaging checks and production frontend checks passed; the packaging script also passed its nine Python relocation tests.

To apply later, have the operator finalize the live recording and approve installation, then preserve the current app/data/settings and install this exact signed candidate using the established backup/rollback procedure. Do not hot-replace the active contest application or automatically start capture.
