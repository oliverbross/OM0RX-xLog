# Window startup — Operate refinement

Artifact: `prototype/src/main.tsx`, `prototype/src/windowSurface.ts`,
`prototype/src/surfaceStyles.ts`, `prototype/scripts/check-window-bundles.mjs`.
Platform: shared Tauri desktop on macOS, Windows and Linux; not a mobile redesign.
Mode: Operate. Code-led performance refinement of the established dark station UI.

## Direction contract

Keep the same screens, controls, station authority and visual identity. Opening
detached Awards, Logbook or DX Cluster must load that component without evaluating
the main station controller or map engine. Main, Monitor and map routing remain
unchanged in this stage. Load the chosen surface before mounting, never as an
intermediate main-screen render. A failed chunk must show an accessible recovery
message and Reload window, never fall back to the station controller.

The existing styles remain eager and in their component-before-shared-override
order. JavaScript splitting must not change heading sizes or control geometry.
No new token, logo, illustration, animation or decorative treatment is intended.

## Quality bar and verification scope

Baseline production source: `03abfe5e262f8a462ae7ce62c981df92c9d457c8`.
Browser Awards loaded `index-BT-Rcogf.js`: 1,719,634 decoded JavaScript bytes.
Production manifest checks must verify each of the three detached static import
closures excludes LiveApp/Map and remains at or below 400,000 bytes, including the
entry and all shared chunks. Do not compare only the tiny route chunk.

Capture the real bundled renderer at 640×480 and 1280×800, including the explicit
browser/no-native-worker state. These captures prove loading, CSS and recovery,
not logbook data, native IPC, radio operation, or native-window lifecycle. Prior
packaged checks cover the old source; the new source needs its own exact run.
One localhost paint sample is not a native-device latency benchmark. Whole-app
performance, main/map bundle splitting and full windowed mode remain open.

## Final measurements

The production static import closures, including the entry and shared chunks,
pass the 400,000-byte gate. The gate also excludes the main station workspace and
map UI and rejects any CSS arriving after the eager shared overrides.

| Detached window | JavaScript bytes | Gzip bytes |
| --- | ---: | ---: |
| Awards | 274,142 | 85,247 |
| Logbook | 326,452 | 99,466 |
| DX Cluster | 288,497 | 88,803 |

These are bundle-size measurements against the 1,719,634-byte baseline, not
native startup latency measurements. Full validation for this stage passed:
515 tests in 73 files, TypeScript, Vite production build and the bundle graph
gate. The documentation pass reran the graph gate and confirmed the values above.

## Evidence / inspection

The fresh review identified two regressions: Awards headings grew from 14 to
20 px, and its desktop Dock back control and local-estimate disclaimer were
missing. The initial CSS aggregation still allowed duplicate rules to arrive
after shared overrides. The completed fix imports the actual component CSS
modules eagerly through `surfaceStyles.ts`, before the shared overrides, so Vite
deduplicates them. Awards also retains its docking callback and disclaimer.

After one fix round, all seven final browser captures were refreshed in place
under `.impeccable/review/`:

- `startup-awards-desktop.png` and `startup-awards-compact.png`
- `startup-logbook-desktop.png` and `startup-logbook-compact.png`
- `startup-cluster-desktop.png` and `startup-cluster-compact.png`
- `startup-load-error.png`

The desktop and compact captures are 1280×800 and 640×480 respectively.
`startup-awards-before.png` records the desktop visual baseline. The final
comparison preserves its compact heading hierarchy, navy surfaces, semantic
colours, control geometry, Dock back control and local-estimate disclaimer.
Logbook and DX Cluster retain their dense controls and explicit browser/no-native
service states at both sizes. Existing compact Awards scrolling and cluster
column compression are not redesigned here.

The chunk-failure check deliberately aborted the requested chunk, displayed an
alert with Reload window, then unblocked the request and restored the requested
surface through Reload. The failure path never mounts the main station
controller. This verifies browser recovery only; it does not prove native IPC,
window docking or radio operation.

Fresh reviewer disposition: **SHIP for the scored fixes only**. Both reported
regressions are **RESOLVED** in the final captures. No native design detector ran;
it does not evaluate the desktop conventions. No raster assets were created;
the screenshots are nonshipping verification evidence.

## Remaining acceptance and context limits

Exact-source follow-up: `a701a6e37587746972728b258dbfe04e478a366b` passes all
five jobs in matrix `38348642953`. Inspected Windows first/relaunch and Linux
X11 first/relaunch/relocation plus Wayland reports each pass 23 isolated native
checks, including repeated-open and Dock-back lifecycle for Logbook/Awards,
with station I/O disabled. This accepts the package behavior, not native startup
latency or physical Mac desktop appearance. No native latency benchmark exists.
The main/map bundle remains large, and the broader all-window, mixed and docked
workspace/performance goal remains open.

This is an ordinary refinement of the incumbent system. `DESIGN.md` retains its
preexisting noncanonical heading structure and lacks token frontmatter; the
`.impeccable/design.json` sidecar is absent. Those format findings are reported,
not repaired as a side effect of this surface update.
