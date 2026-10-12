# P1 design parity evidence

P1 extends the preserved OM0RX-xLog operator console for framework feasibility. The user's same-look/same-functionality migration constraint remains binding. This is a synthetic prototype acceptance record, not a replacement design system or a claim of native feature parity. `../PRODUCT.md`, `../DESIGN.md` and the incumbent captures remain authoritative.

## Preserved design

Compared `src/style.css` and `SURFACE_BRIEF.md` with the root design and `../docs/screenshots/operator-desk.png` / `band-maps.png`. P1 retains the dark navy canvas, panels and controls; cyan frequency information; teal save/confirmed state; amber attention; orange worked state; pink reference classification; and coral errors. System-family labels and monospaced callsign/frequency values retain the dense operating character.

The sidebar and station rail frame a desk with active QSO, callsign intelligence and station pulse above a geographic map and frequency-positioned band map. Allocation shading, semantic spot colour, compact tables and restrained borders follow the incumbent console. Teal logging remains the primary action, with visible cyan keyboard focus.

## Intentional P1 adaptations

- All station, contact, cluster and classification values are synthetic. Simulator/manual profiles, session-memory logging and explicit simulation labels expose the prototype boundary.
- Existing offline DXCC geometry replaces hybrid imagery. MapLibre supplies geographic pan/zoom, markers and attribution; no Apple imagery or account data is copied. Provider/imagery parity remains open.
- The station monitor uses the shared frontend and a synthetic session snapshot. It is a feasibility surface, not acceptance of the incumbent's complete undocking workflow.
- Band-map chips show callsign and synthetic NC/NB/ATNO classification; exact frequency remains in accessible labels/tooltips and the frequency axis.
- Compact desk sizing preserves the three context panels in one row and lets the spectrum use remaining height. Monitor sizing budgets map height from the remaining viewport. Initial map bounds cover every fixture coordinate until a user camera action establishes intent.

## Checked visual evidence and disposition

Reviewed the final supplied captures directly:

| Capture | Size | Evidence |
| --- | --- | --- |
| `../.impeccable/review/p1-desktop.png` | 1440 × 940 | Desk hierarchy, complete map/band surfaces, readable controls and visible bottom status. |
| `../.impeccable/review/p1-minimum.png` | 1000 × 720 | Three context panels remain visible; map attribution, full band spectrum and footer fit; SSB mode label is readable. |
| `../.impeccable/review/p1-monitor.png` | 780 × 600 | Frequency/readback, both context panels, map attribution and footer fit within the window. |

**Reviewer disposition: ship for the scored P1 fixes.** Compact desk/monitor overflow, the initial map camera and mode-label truncation are resolved at these reviewed sizes. The monitor's world wrapping is visible in the supplied capture and is not a native parity claim. Context and detector were already run once; this documentation pass did not rerun them. The supplied detector result was `[]`.

The surface brief records 12 frontend tests, TypeScript/build success and zero registry audit vulnerabilities, plus browser measurements and map interaction evidence. These are existing handoff results, not tests repeated by this documenter.

## Existing drift and remaining gates

Observed implementation differences are recorded without changing the approved system: secondary text is brighter (`#A6B6CA` versus root `#92A7BF`), the web station rail is 48 px versus the native 44-point specification, and control/panel radii are 5/10 px versus the root's 6–10/12-point guidance. These are prototype measurements, not approval to alter root tokens. The root design uses its existing headings and has no machine-readable frontmatter; `.impeccable/design.json` was absent at inspection. No schema or sidecar repair was performed.

Before production replacement, prove the full QSO editor and keyboard/accessibility behaviour, persistent local storage and ADIF preservation, real provider/enrichment data, Wavelog reconciliation, native window/state behaviour, imagery/provider acceptance, packaged worker/WKWebView rendering, cross-platform GPU/memory/performance and signing/distribution. The brief's approximately 1.29 MB frontend bundle and 832 KB geometry asset remain performance measurement items. Station/RF and external-account acceptance require direct evidence in their own authorized stages.

This pass writes only this parity record. It does not authorize station access, commits, deployment or design-system replacement.
