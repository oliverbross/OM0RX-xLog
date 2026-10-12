# P1 preserved operator console

Operate mode. This is a framework feasibility slice of the current OM0RX-xLog console, using docs/screenshots/operator-desk.png and band-maps.png as visual authority. Preserve navy surfaces, compact system-family labels, mono frequency/callsign measurements, sidebar, station rail, compact active QSO, contextual intelligence, station pulse, geographic map and frequency-positioned band maps. No visual redesign.

All station, cluster and QSO values are synthetic. Profiles offer only simulator and manual/disconnected modes; no hardware transport, credentials, live logbook or sync. Synthetic QSOs reside in window memory. The Swift worker reports its actual IPC response; browser preview explicitly has no worker. One shared frontend supports a detached station monitor.

The map uses actual existing offline DXCC geographic data rendered by MapLibre with pan/zoom, semantic spot markers and visible attribution. No Apple tiles or satellite imagery are copied. Offline vector cartography is an explicit P1 difference and requires later imagery/provider acceptance. Full native feature parity, full QSO editor, propagation, local providers and production durability are outside this slice.

## Verification handoff

Frontend unit and rendered-workflow suite: 11 tests covering invalid draft retention, keyboard save, cluster selection and coherent simulated readback, profile switch draft retention, manual tuning restriction, frequency positioning and browser worker unavailability. TypeScript and Vite production build pass. Registry audit after upgrading MapLibre to 6.14.0 and Vitest to 5.0.3 reports zero vulnerabilities. Main bundle approximately 1.29 MB uncompressed; existing geometry asset approximately 832 KB. The bundle-size warning remains a performance measurement item rather than a parity claim.

Desktop/browser visual capture, packaged worker checks, GPU memory/performance and detached-window state acceptance belong to the parent integration pass. Monitor uses BroadcastChannel solely for synthetic state. Close the detached monitor with native window chrome. No public hosting, production replacement or commits are authorized by this frontend implementation task.

MapLibre 6's standalone module worker is explicitly imported with Vite `?url` and configured before map construction, so dev optimization and packaged relative paths do not break its default adjacent-worker resolution. NC/NB/ATNO badges are explicitly synthetic fixtures on each band-map spot and cluster row; band-map labels show the badge rather than duplicating the frequency axis, with exact frequency retained in accessible labels and tooltips.
