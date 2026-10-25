# Recorder strip stability fix — 1.3.21

The Main Logging recorder strip previously wrapped its long, changing source and input descriptions onto extra rows, moving the callsign fields during operation. It now keeps status and all existing controls on one row. The status shows capture state, input activity and synced duration in minutes:seconds; detailed source labels, synced UTC and errors remain in the tooltip and Recorder window. Narrow windows truncate the status rather than moving controls or fields. Capture and replay code are unchanged.

Validation: 189 focused contest/recorder tests passed, plus TypeScript, production frontend build and window-bundle checks. An isolated browser fixture rendered the actual strip component with the real application styles in six states (input present, silent, starting, interrupted, unavailable and stopped) at 980, 700 and 540 pixels. All 18 cases had a 39-pixel strip, an unchanged 53-pixel offset to the callsign label, visible single-row controls and no horizontal overflow. This is isolated layout evidence, not an installed-app runtime claim.

Build only from clean canonical main with `CARGO_BUILD_JOBS=2 bash prototype/scripts/package-macos.sh`. The script embeds its exact Git HEAD in native and distribution provenance, refreshes the frontend, stages the existing worker/Python resources and signs the full bundle. Package identity and verification are recorded below after build.

The active application, production log, settings, recording originals and rollback are not replaced by this UI fix. Applying the candidate requires an operator-approved installation after the live recording can be finalized. No audio or station operation is part of verification.
