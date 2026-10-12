# Operator feedback delivery tracker — 12 October 2026

This is the acceptance checklist for the operator's screenshot and live-test
feedback. Source implementation, automated tests, installation, and live
acceptance are separate gates. A passing test is not proof of a hardware or
packaged UI result. Keep unresolved items here across releases.

## Current delivery boundary

- Working tree: shared cross-platform xLog; Mac-first delivery.
- Currently installed: Integration alpha.5, source `973df9c727a95725eb585f1b4c88a0b09350ad67` (bundle metadata checked).
- Next package: alpha.6. The pending changes below are **not yet installed**.
- Restart of Integration was explicitly approved once the build passes.
- Preserve the latest operator draft, all logbooks/settings/credentials, and
  `/Applications/OM0RX-xLog.app` (the original native app).
- No PTT, RF Tune, CWX, OPERATE or RF transmission acceptance is authorized by
  this UI update. Do not tune a spot just to test layout while auto rotor is on.
- Commit and push reviewed source; sign/notarize the exact package; update the
  Integration app in place without extra archived app copies and publish an exact
  prerelease. Stable native release must remain available.

### Latest source checkpoint (equipment / CW foundation)

- Full shared frontend: 311/311 tests, TypeScript clean; `git diff --check` clean.
- Rust desktop backend: 68/68 tests passed before the version-only alpha.6 bump.
- Swift core: 67/67 tests. Mac portable-worker build/test: 136 XCTest tests
  (17 station, 86 worker, 33 cluster) plus 40 Swift Testing cases, all passed.
- UI-26 source/fixture review disposition: **ship**, followed by documentation;
  no claim of installed-app or hardware acceptance. Browser fixture server closed.
- CW-02 pure rules are tested, but CW-01 transport and CW-03 editor/button row are
  still implementation work. See `docs/CW_IMPLEMENTATION_STAGE.md` before continuing.
- Alpha.6 source is being frozen for packaging; installation remains pending.
- Reference follow-up: Wavelog catalog semantic schema validation and cancellation
  of an already-running catalog check when changing to standalone mode remain open.

## Checklist

| ID | Requested result / acceptance | Source and test state | Installed / live verification |
| --- | --- | --- | --- |
| UI-17 | Band-map upper/lower frequency tick numbers fully visible, including enlarged text | Edge tick labels inset from chart clipping bounds | Pending packaged visual check |
| UI-18 | HF propagation centered in available header space, separate from radio/status and weather | In progress | Pending wide/laptop check |
| UI-19 | Callsign/Country matrix same size and aligned; table + C/W/— legend only, no extra status chips | In progress | Pending packaged visual check |
| UI-20 | QRZ photo twice current size with full-size viewer; aligned previous-QSO columns, orange Worked and green Confirmed at mode text size | In progress | Pending packaged visual check |
| UI-21 | Operator workspace uses one toolbar: tabs + band controls or cluster status; no duplicate Band maps heading; green connected/red disconnected | In progress | Pending packaged visual check |
| UI-22 | Remove Operator Desk title and isolated-logbook/manual-sync header row entirely | Source implemented | Pending packaged visual check |
| UI-23 | Main Band Maps: remove duplicate page header and separate Undock row; Undock beside Add band map | Source implemented | Pending packaged visual check |
| UI-24 | Refine rotor instrument with readable scale, single observed needle, separate rim target and short-path arc; no fabricated motion | Source implemented; geometry and offline tests | Pending packaged visual check; hardware off |
| UI-25 | Move independent rotator configuration into Settings → Rotator; browsing settings leaves connections unchanged | Source implemented | Pending packaged navigation check |
| UI-26 | Hide unconfigured rotor; optional fixed-antenna type/name/bands or no equipment panel; reclaim its grid track | Implemented; 21 focused UI tests, settings migration/round-trip tests; full frontend 307/307 + TypeScript and Swift core 67/67. Fresh narrow UI review: ship | Synthetic 1920×1080 and 1000×720 fixtures verified. Not installed; packaged persistence/relaunch, high-DPI and assistive-technology checks remain. Descriptive antenna only; owned rotor always retains Stop |
| SYNC-02 | Explicit standalone local vs local+Wavelog logbook mode; local mode blocks sync network, keeps all data, switching back never auto-syncs | Backend and UI in progress | Test saved mode/restart/no-network guards; current user mode unchanged |
| CW-01 | Cross-platform WinKeyer configuration and transport, separate from supported-radio CW route | New requested stage; review official protocol and existing ShackCQ implementation | Radio intentionally off; no keying/transmission tests; physical WinKeyer acceptance required |
| CW-02 | Up to 20 editable macros, safe substitutions/preview, named colors and assigned keyboard shortcuts | Pure profile/preview/key-matching engine implemented, 4 tests pass; settings editor and output controller still pending | Not user-facing yet. Opt-in transmit arming; no shortcuts while typing/in dialogs, no reconnect/retry replay, immediate Stop |
| CW-03 | Optional customizable row of selected colored CW macro buttons under Active QSO | New requested stage | Responsive row/selection, saved profile, same shared frontend; no fabricated transmit confirmation |
| CLUSTER-01 | Restore live cluster after update; resume saved connected session on restart, respect explicit Disconnect; independent of offline radio | Confirmed startup only snapshots and never resumes session; fix in progress | Must verify live OM0RX-13 spots and packaged restart |
| PERF-01 | App-wide cold/warm performance audit: typing-to-intelligence (reported slow again for VK8NSB), tab opening, startup, awards, spot/classification, background requests and large-log behavior | Required final acceptance, not closed by caches or unit tests; cold award calculations still multi-second | Measure representative packaged runtime, record median/p95 and distinguish remote QRZ latency from local history/paint |
| UI-01 | Operator Desk Active QSO, intelligence, rotor match supplied information and colors | Implemented; component tests | Recheck updated package |
| UI-02 | Log QSO full fields match supplied editor; no large empty right column; matrices span below details | Implemented; component tests | Pending alpha.5 |
| UI-03 | Logbook layout, status colors, search/edit/import/export match reference | Previous implementation | Recheck final parity; do not infer from screenshot |
| UI-04 | Colored DX-cluster filters retain existing behavior | Implemented | Recheck updated package |
| UI-05 | Undock/dock cluster, map, band maps; preserve selection ownership | Implemented; detached projection tests | Recheck updated package |
| UI-06 | Cluster Console and Settings beside Refresh; Dock back last | Implemented; component tests | Pending alpha.5 |
| UI-07 | Remove detached cluster duplicate header and redundant connection row; show cluster name beside Connected | Implemented; component tests | Pending alpha.5; keep failures visible |
| UI-08 | Band maps occupy full available height AND width, with no empty right strip | Adaptive width/height and overflow pagination implemented; 15 BandMaps tests pass, including retained zoom | Pending resize checks |
| UI-09 | Avoid horizontal/vertical scrollbars through responsive layout, not inaccessible clipped content | Operator workspace and band maps in progress | App-wide audit still open; long records/forms must remain accessible |
| UI-10 | Multi-select CW/Data/Phone filter; persist and synchronize detached changes | Implemented; component/preference tests | Pending alpha.5 |
| UI-11 | Wheel/drag pan zoomed band maps; never tune from drag | Implemented; regression tests | Pending pointer check |
| UI-12 | Detached band maps: no duplicate top header/footer prose; Dock back beside Add band map | Implemented; component tests | Pending alpha.5 |
| UI-13 | App logo/larger brand; bold frequency/mode; propagation in header with Day/Night and colored SFI/A/K; no update row | Implemented; component tests | Pending wide/laptop layout check |
| UI-14 | Hide routine spot tune-success prose without hiding failures/unconfirmed state | Implemented | Pending alpha.5 |
| UI-15 | Resizable map/right pane; Band maps and Cluster tabs; compact cluster configurable columns and widths, independent of full cluster | Implemented; focused component/integration tests; full frontend 255/255 | Pending splitter, persistence, tab and column checks |
| UI-16 | Rotor cannot enlarge top row unnecessarily; QSO/intelligence/rotor bottom edges aligned | CSS fixed; 11 OperatorDesk tests | Pending width/height resize checks |
| MAP-01 | Fit complete path between home and target, including antimeridian and SP/LP | Implemented; geometry tests | Pending packaged map check |
| MAP-02 | Light-grey night hemisphere, correct date/time, toggle with Greyline | Implemented; seasonal/dateline tests | Pending packaged map check |
| MAP-03 | Show spot callsigns earlier while zooming; prioritize them over country labels | Implemented; zoom threshold test | Pending packaged map check |
| MAP-04 | Both endpoint callsigns; distance above route midpoint, observed frequency below; readable tangent orientation | Implemented; geometry/format tests | Pending packaged map check; retain location provenance |
| DATA-01 | QRZ details/photo populate current callsign and empty fields; preserve deliberate manual edits | Implemented; enrichment/profile tests | Pending authenticated lookup; no credentials in evidence |
| DATA-02 | Wrong inherited England/country/DXCC cleared and corrected; ignore stale lookup completions | Implemented; draft/selection regression tests | Pending live callsign change |
| DATA-03 | Fast callsign/DXCC intelligence independent of remote lookup/full log scan | Indexed history and cached resolver/session implemented | Measure real packaged latency; not yet instant-certified |
| DATA-04 | Cluster POTA/SOTA/IOTA/WWFF/castle references transfer and validate installed databases; unknown/missing directory explicit | Implemented; parser/selection tests | Pending real selected-reference verification without unintended tune |
| DATA-05 | Settings top tabs and grouped service URL/account/credentials | Implemented; component tests | Pending alpha.5 |
| DATA-06 | Per-dataset downloaded/checked/attempt dates, count/version, cache/error freshness; no fabricated legacy dates | Implemented; updater/component tests | Pending actual cache display |
| DATA-07 | Reject malformed CTY/LoTW downloads and cached 304 success; preserve known cache; correct Wavelog catalog index.php URL | Implemented; 5 focused updater tests | LoTW real-feed compatibility remains to verify |
| DATA-08 | Awards opens immediately with retained/cached results | Warm caches and retained view implemented | **Partial:** first cold calculation measured 6.7–27.3 seconds; further cold-path work required |
| RADIO-01 | Auto rotor turns resolved typed calls; selected spots wait for confirmed radio tune; Stop/reconnect disarm | Implemented; fence/regression tests | Pending packaged/hardware acceptance, not claimed by synthetic tests |
| RADIO-02 | Browsing Station Control provider tabs must never disconnect/change active radio; explicit Save/apply action | Active/view provider separation implemented; 19 focused tests and full 242-test frontend suite pass | Pending live tab-only check |
| RADIO-03 | Frequency/mode and callsign remain coherent after spot selection, including remote latency | Existing guarded tune/readback plus stale-selection fences | Real radio/Maestro acceptance remains distinct |
| SYNC-01 | M7KOD reaches Wavelog without duplicate/lost edits | Previously verified remote ID 178693, dirty=0, outbox=0 | Complete for that QSO; no blanket sync parity claim |
| SHIP-01 | Preserve native app/data/latest draft; one Integration running; exact signed/notarized release and GitHub source | Awaiting final freeze/build | Pending |

## Longer-term parity gates (not silently closed by this release)

- Full native logging/awards/sync/import-export behavior versus the original
  app and the awards master brief.
- Standalone local Hamlib radio AND rotor, embedded remote xCat, integrated
  xCluster; no standalone macOS xCat dependency for cross-platform operation.
- Real local Hamlib device acceptance; direct FLEX and remote station/300 ms+
  transport behavior, safely verified separately.
- Clean-machine Windows and Linux packaging/runtime acceptance. The user will
  test Windows later; Mac delivery remains the current priority.
- Existing original applications and original native macOS release preserved.

## Overnight instruction — station intentionally powered off

At approximately 22:39 Darwin / 13:09 UTC on 12 October, the operator authorized
eight hours of independent work and reported the radio switched off. Treat
missing radio/amplifier telemetry as expected, not an incident. Do not request
routine decisions or run hardware acceptance while the operator sleeps. An
hourly continuation is scheduled in this thread, bounded to 21:10 UTC.

| ID | Additional requested result | State / acceptance boundary |
| --- | --- | --- |
| NIGHT-01 | Full parity review with exceptionally fast navigation, lookup and awards | Cold award performance investigation; measure representative isolated log, cold/warm and concurrent workload separately |
| NIGHT-02 | Polished responsive experience on laptop and large/4K displays; selectable readable UI scale | Audit planned; use effective window size/DPI, not resolution detection alone; test saved scale and keyboard access |
| NIGHT-03 | Clear Hamlib manufacturer/model choices, independent radio and rotor settings | Audit planned; bundled supported catalogue, capability-driven controls, dummy protocol tests; physical compatibility remains unverified |
| NIGHT-04 | Automatic freshness checks for every configured reference feed, with visible state and reliable cached fallback | Scheduler audit planned; bounded retries, valid payloads, no credential exposure, respect source availability/licensing |
| NIGHT-05 | Custom alerts with condition rules, dashboard, optional popup/bell/spoken delivery | Architecture/reuse research; opt-in sound, deduplicate/rate-limit, test action, no RF commands from alerts |
| NIGHT-06 | POTA/SOTA/IOTA/WWFF/etc chaser view based on user's ShackCQ project | Read-only source research; integrate existing classifications/reference validation, preserve notices |
| NIGHT-07 | DXpedition and contest information from user's ShackCQ project | Read-only source/feed research; dated source attribution, freshness and offline errors; no fabricated events |
| NIGHT-08 | Same shared UX on macOS/Windows/Linux, Mac-first package verification | Avoid platform-specific frontend forks; cross-platform runtime acceptance remains distinct |

### Pre-package automated checkpoint

255 frontend tests and TypeScript checking passed after workspace integration,
provider Apply separation, multi-pointer drag protection and manual reference
clear protection. Shared Swift suite passed, including 30 Swift Testing cases
and the URL-free QRZ transport error fixture. Exact total and package evidence
are recorded with the release checkpoint, not inferred from these source tests.

## Closing a row

Record the source SHA, exact test evidence, installed version, and observed
result. Leave partial or failed gates visible. Add newly reported issues here
before implementation; do not replace this list with a generic “done”.
