# Band Maps

Mode: Operate. Preserve the incumbent navy station console, semantic spot colours, compact system controls and monospaced callsigns/frequencies. This is a refinement of existing chips; no replacement visual world or new assets.

Contract: use a common compact width for the visible callsigns and opportunity codes in each chart, keep opportunity codes aligned at the right edge, retain the full callsign/frequency/status in accessible labels and tooltips, and preserve collision placement, chart bounds, paging, zoom, pan and selection authority.

## Fresh compact-chip review — 2026-10-13

Isolated Vite and a dedicated browser session rendered synthetic memory-only spots, with no worker, station, credentials or publisher endpoints. Common calls were UB3A, IU1PZC, OK2JIQ/P, R5GG with NB+NM, UR2680YL and SQ9GOL. A narrow case adds VK8/OK2JIQ/PORTABLE and sixty crowded spots.

Captures are in `.impeccable/review/compact-review-2026-10-13/`: `bandmaps-desktop.png` (1280×800), `bandmaps-compact.png` (640×480), `bandmaps-4k-large-text.png` (3840×2160, Band Maps text 200%), and `bandmaps-narrow-large-text-crowded.png` (800×600 viewport, 330px host, 200% text).

Normal chips share 78px edges and aligned codes, including the composite NB+NM. At narrow 200% sizing the full portable callsign remains available in its accessible label and chips stay in the chart bounds. The chips are 221px wide with a common right-hand code edge at x292.5 in a 288px chart.

Verdict: normal and 4K compact chips pass the scoped presentation review; hold the narrow enlarged-text case for correction. The enlarged axis labels end at x94.03 while chips begin at x77.5, creating roughly 17px of intrusion. PHONE/DATA labels can overlap the opportunity codes. The overflow notice begins at y466 while the R5GG chip ends at y473, covering its bottom edge. The narrow capture is the reproduction evidence. No application edits were made by this reviewer.

Browser evidence establishes shared presentation only. Exact native package, hardware, external-account and cross-platform acceptance remain separate. Existing PRODUCT.md, DESIGN.md and sidecar drift are preserved.

## Frequency-ruler revision — 2026-10-16

This user-approved revision supersedes the compact-chip visual treatment while preserving its operating and accessibility guarantees. The primary reading path is now frequency ruler → callsign/status → compact bottom controls. Markers use unboxed monospaced callsign text and an aligned NC/NB/NM/NB+NM code in the existing semantic status colour; colour is never the only classification. A true-frequency leader keeps collision-shifted labels tied to the scale.

Repeated reports are collapsed by normalized callsign and band. The newest report owns the single marker, so a later QSY moves that callsign instead of leaving stale duplicates. The map projection defaults to a 30-minute age window, refreshes that window without requiring new cluster traffic, and leaves raw Spot History unchanged.

The bottom control strip exposes spot age and px/kHz resolution on every surface, plus band selection in the focused Band Maps window. The frequency scale reads from low at the top to high at the bottom, matching the supplied operator reference. Preserve paging, pan, zoom, allocation choice, focus visibility, full accessible detail and the last usable geometry during transient resize measurements.

## Final confirmation after the narrow correction — 2026-10-13

Verdict: pass for the scoped compact-chip refinement. The final frozen source was confirmed at 640×480, 1280×800, 3840×2160 with 200% Band Maps text, and the crowded 330px host with 200% text. The narrow frequency-axis labels now end at x94.03 and chips begin at x107.5, leaving 13.47px clearance. The last chip ends at y473.08 while the concise overflow notice begins at y487.05, leaving 13.97px clearance. Opportunity codes remain aligned and visible; long calls retain their full accessible labels. Allocation captions remain when the right gutter accommodates them and disappear in the narrow case, while shading, legend and allocation selector preserve the meaning. No remaining material issue was found in this delta.

Final frozen-source captures, preserving first-batch and interim evidence, are `bandmaps-desktop-final.png`, `bandmaps-compact-final.png`, `bandmaps-4k-large-text-final.png`, and `bandmaps-narrow-large-text-crowded-final.png` in `.impeccable/review/compact-review-2026-10-13/`. The page's uncaught-error list was empty. Development HMR emitted duplicate-createRoot warnings while source edits were arriving; the fixtures now retain their React root across HMR evaluation. The final captures used fresh navigation after the product source was frozen. This confirmation does not widen the native-package or hardware evidence boundary above.
