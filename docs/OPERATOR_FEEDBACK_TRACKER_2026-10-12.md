# Operator feedback delivery tracker — 12 October 2026

This is the acceptance checklist for the operator's screenshot and live-test
feedback. Source implementation, automated tests, installation, and live
acceptance are separate gates. A passing test is not proof of a hardware or
packaged UI result. Keep unresolved items here across releases.

## Current delivery boundary

- Working tree: shared cross-platform xLog; Mac-first delivery.
- Currently installed: Integration alpha.12, source `ced2d2cb65c5861de138663288d5ef02cdfc0d68` (signed/notarized, 21 native acceptance checks passed). Native width entry verified with 180, then defaults restored. Wider parity gates remain open.
- Individual runtime checks and remaining gates are recorded below and in the alpha.7 acceptance report.
- Restart of Integration was explicitly approved once the build passes.
- Preserve the latest operator draft, all logbooks/settings/credentials, and
  `/Applications/OM0RX-xLog.app` (the original native app).
- No PTT, RF Tune, CWX, OPERATE or RF transmission acceptance is authorized by
  this UI update. Do not tune a spot just to test layout while auto rotor is on.
- Commit and push reviewed source; sign/notarize the exact package; update the
  Integration app in place without extra archived app copies and publish an exact
  prerelease. Stable native release must remain available.

### Alpha.8 installed checkpoint

The signed/notarized alpha.8 bundle passed all 21 generated large-log checks
and is installed. Logbook display measured 72 ms and cold/repeat Awards
697/31 ms in the isolated native test. The real 67,846-contact workspace and
automatic cluster reconnection were retained. Exact package and installed
observations are in `ALPHA8_INSTALLED_ACCEPTANCE_2026-10-13.md`.

**CHASER-01 was found in alpha.8 and is fixed in alpha.9:** KFF WWFF references
appeared as duplicate POTA rows. Reproduced with K5G / KFF-3017 and KE2CIE /
KFF-2099, repeated after Refresh view and confirmed with Programme POTA.
No row was loaded or tuned.

Alpha.9 source correction: the shared parser now excludes WWFF references,
SOTA reference tails and explicitly labelled castle references from POTA
candidates. Directory resolution uses the same rule. Chaser rows identify their
programme beside the reference without adding a column. The regression first
failed against alpha.8 source, then passed after correction. Full frontend
350/350, native core 73/73, worker 139 XCTest plus 59 Swift Testing cases, and
TypeScript passed. Installed alpha.9 shows KE2CIE / KFF-2099 once as WWFF;
Programme POTA excludes it. Refresh view adds the genuine POTA US-9309 spot
separately. Alpha.8 was not published as a GitHub release.

### Alpha.9 installed checkpoint

The signed/notarized package passed all 21 isolated native large-log checks with
100,002 generated contacts: logbook 69 ms, cold/repeat Awards 689/18 ms. These
are single-run observations, not app-wide median/p95 acceptance. ShackCQ
reconnected automatically after installation; the empty draft and 67,846-contact
workspace were retained. See `ALPHA9_INSTALLED_ACCEPTANCE_2026-10-13.md`.

Exact alpha.9 CI `38298414791` passed Mac, Windows and Linux builds, Windows
fresh-runner runtime acceptance and Linux runtime-only container acceptance.

### Portable live cluster follow-up

Windows/POSIX socket transport and shared worker routing are implemented in the
next source stage. Six owned-loopback tests cover login, framing, IPv4/IPv6,
reconnect, cancellation and no command replay. Workspace tests cover Chaser,
configuration persistence, unavailable secure storage and terminal shutdown.
Capability messages retain the existing compact cluster settings layout; browser
fixtures at 1280×800 and 1920×1080 confirm readable messages and disabled controls.
This does not replace native WebView acceptance. Windows/Linux secure password
storage and FLEX forwarding remain open. DNS follow-up now bounds the full
connection deadline and outstanding resolver jobs, releases stopped connections
before OS resolution returns, and rejects late answers; six additional tests and
AddressSanitizer pass on Mac. Exact follow-up OS acceptance remains open. The
installed alpha.9 has not been replaced. See `PORTABLE_CLUSTER_STAGE_2026-10-13.md`.

### Shared public services follow-up

Weather and propagation now route through one workspace-owned shared service,
using the native parsers and bounded credential-free HTTP downloads. Portable
callsign lookup resolves offline CTY and geometry instead of rejecting the whole
operation. QRZ authentication and portable secure stores remain open, not silently
substituted by CTY. Shutdown cancellation, changed-grid rejection, retained stale
propagation and concurrent request coalescing have fixture coverage. This source
stage has not replaced installed alpha.9. See `PUBLIC_SERVICES_STAGE_2026-10-13.md`.

### Windows cluster credential follow-up

The source now wires Windows Credential Manager into the cluster vault using an
exact namespaced service/account adapter, bounded UTF-8 blobs and no plaintext
fallback. Mac Keychain is unchanged. Local validation tests do not prove the
Windows API branch; a dedicated CI-only random-identity round trip is required.
Linux vault support and authenticated portable services remain open. See
`WINDOWS_VAULT_STAGE_2026-10-13.md`.

### Cluster settings save regression (CLUSTER-02)

Reported 13 October: saving colours disconnected every cluster and erased all
received spots. The cause was an unconditional disconnect and history reset in
`ClusterSessionService.configure`. The correction preserves sockets, spot IDs,
timestamps and console history for display edits; reprojects colours and special
rules; reconnects only added or changed enabled endpoints in a running session;
and leaves explicitly disconnected sessions offline. Retry/skimmer options update
in place. Credential lookup failure leaves the existing connection untouched;
late callbacks from replaced sockets are rejected independently per server.

Regression coverage includes multi-server replacement, retained history, palette
and rules, offline saves, credential failure, terminal shutdown, worker Save
dispatch, and owned-loopback live option changes on both Mac and portable socket
implementations. Local tests: 159 XCTest (one Windows-only skip), 68 Swift Testing,
353 frontend, TypeScript and five worker-process tests pass. Spot retention
here means across settings saves and reconnects, not a new disk-backed history.

Alpha.10 installed acceptance: source `5ecf265e1684939aebc2e6de5d90cc82da68afff`,
Developer ID team `4WCMQ4U946`, notarization
`008f827a-313f-4a21-8fd8-57afacb79095` Accepted. Strict signature, staple and
Gatekeeper passed. Archive SHA-256
`15b1a241416987195b4564216c53710fad309fa7642cb14b14e0743b6a8d4998`.
All 21 isolated packaged checks pass in
`evidence/native-ui-alpha10/mac-signed-large.json`, including 100,002 records and
70/70 map probes. Single-run logbook 82 ms; cold/repeat Awards 717/33 ms; history
219/213 ms, render 32 ms. These are not p95 measurements.

Installed live Save pressed twice: ShackCQ remained Connected; the second retained
11 received / 8 shown spots before and after Save. No colour or endpoint was changed
in the operator's configuration; those cases have automated regression coverage.
Latest H49A / 24.911000 MHz / 12m / SSB draft survived restart, as did 67,846 contacts.
Original native app hash remains
`7a2b244545c9eb2639cde5f0a152c9cfaf40e2e06fde9ad97fd3184e37efdb97`.
No radio/rotor command was sent. Exact-source OS matrix `38307750798` is pending.

### Chaser usability and parity follow-up (CHASER-02)

CHASER-03 (13 October follow-up, source/tests complete; packaged verification pending): move DXpeditions immediately after All;
make map follow programme/filter selection and show supplied coordinates or
clearly marked reference-area locations. Include recent IOTA-tagged cluster
spots and dated calendar operations carrying IOTA references in the IOTA tab.
Separate scheduled operations from live spots, show dates and location evidence,
and explain unlocated rows instead of inventing precise markers. Calendar rows
without frequencies must remain mappable when defensible location data exists.

New operator screenshots, 13 October: automatically load and refresh public feeds;
remove per-feed Check requirements; replace Programme dropdown with programme
tabs below source health; use the full available table area; remove the duplicate
Chaser page/manual-sync header and bottom public-source prose. Explain that source
health is live-feed status, not the complete reference directory. Add an optional
map below the table for references with authoritative coordinates. Compare actual
ShackCQ source and record missing functionality; do not call the current surface
full parity. CLUSTER-02 installed acceptance is complete; this is the next stage.

Initial read-only comparison: ShackCQ/Nexus `PotaSotaView.tsx` at
`12efe3d2970729465add40d62cecd76bbaf5b63f` already has automatic 60-second refresh,
programme tabs, persistent per-surface band/mode/sort filters, hide-worked-today,
new-park status, and detached boards. The alpha.11 source now implements automatic
refresh, programme tabs, saved band/mode/sort filters and the optional map. It
still lacks worked-today filtering, hunted-reference CSV import, detached Chaser
boards, and complete activator/contest workflows; those parity gates remain open.
Its existing reference-history counts are lifetime reference totals, not proof of
the same activator/reference being worked today. That distinction must remain
honest. Public spot posting and station tuning are separate safety-gated actions,
not side effects of opening or refreshing Chaser.

Source checkpoint for alpha.11: full frontend suite 357 passing, TypeScript
passing; shared Swift suite 159 XCTest cases (one Windows-only skip) and 70 Swift
Testing cases passing; five worker-process checks passing. Final WWFF epoch-time
fix passes the nine focused Chaser tests. Browser fixtures checked at 1280x800,
1440x900 and 2560x1440: table pagination follows available height, optional map
fits beneath it, programme filters persist, full-cluster columns retain hidden
state and widths. Impeccable layout detector reports no findings. Evidence in
`docs/evidence/chaser-cluster-alpha11/`; these are source/browser results, not
installed alpha.11 or hardware acceptance.

### Cross-platform local logbook work after alpha.7

The non-macOS worker previously rejected all workspace/logbook requests with
`platform_pending`. The shared SQLite logbook, settings, CTY/awards and verified
backup paths now compile into its portable core and route through the same
handlers. Linux and Windows packaging must include the Swift resource directory.
`--local-logbook-self-test` exercises a disposable workspace, unknown ADIF fields,
editing, deletion/undo, CTY/awards resources, backup/restore and reopen. It never
opens the operator's workspace, credentials or hardware.

Mac regression: 73 core tests, 138 worker XCTest tests and 42 Swift Testing cases
passed. The two CTY identity assertions were also rewritten to avoid a Swift
Testing macro incompatibility in CI's older Mac toolchain. Native Windows/Linux
build and runtime results remain pending; network services and credential stores
remain explicitly unavailable on those worker platforms. This is not full
cross-platform parity, and the installed alpha.7 app is unchanged.

First native matrix run: `38280083999`, source `3a4147a`. Linux and Windows found the omitted
`ClusterSpotFeed.swift` dependency that owns Maidenhead decoding; Mac passed
Swift tests and all 344 frontend tests, then failed TypeScript because clean
installs lacked `@types/node`. Both source issues are corrected for the next
run. Backup import now accepts native Windows drive/UNC paths while rejecting
traversal and device namespaces; three portable path tests plus fifteen local
logbook tests pass on Mac. Local frontend build and 344 tests pass with the
explicit Node types dependency. That run still used the earlier synthetic UI
harness; the current LiveApp driver below replaces it for the next run.

Matrix run `38281076782` at `04ecbc4` found unresolved CoreFoundation type IDs
in the station bridge. Run `38281893795` at `f588213` confirmed the explicit
import fixes Linux compilation, but Windows does not expose that module. Numeric
validation now uses Foundation's JSON scalar representation to reject Booleans
without platform-specific type IDs. Tests cover JSON true/false, numeric ports,
small integer NSNumber values, NaN and infinities. Linux also exposed an xCat
import outside the existing macOS-only rotor test guard; the import now shares
that guard. Matrix run `38282914334` at `1e8a14d` passed the Mac source job.
Linux compiled and passed Swift tests, then stopped at the missing native Hamlib
sidecars. Windows compiled and ran its portable tests; one alias-path rejection
returned a bootstrap error instead of the common `unsafe_workspace` IPC error.
The rejection remains intact and its error is now normalized. These latest
corrections require another native matrix run.

Linux now has a checksum-pinned Hamlib/libusb build recipe; Windows stages the
checksum-pinned upstream Hamlib archive and records its DLL provenance. Both
portable packages include radio/rotor helpers, upstream notices and their native
dependency audits. CI runs model-1 loopback dummy tests, never physical-device
tests. Linux shell syntax and two runtime-permission tests pass locally.
PowerShell execution is blocked by the local tool policy; Windows CI must verify
that staging and packaging path. No compatibility claim for every radio or rotor
model follows from a dummy-device pass.

Follow-up matrix: `38285494988`, exact source
`c4e0562c8e74a23ef23d15ba1e051b59826ffa45`. Mac and Linux source/package jobs
passed, including Linux Hamlib compilation and model-1 dummy tests. Windows
passed portable Swift tests, then failed one frontend test whose background poll
could update the rendered rotor owner before its simulated Stop click. The test
now captures the old button before changing the preflight response and clicks
without yielding; its no-redirect/no-command assertion remains intact.

Linux runtime acceptance stopped before the UI: its framing harness assumed
completion order for independent correlated worker requests. Both OS harnesses
now require exact response IDs/error coverage without assuming completion order.
Two new harness tests cover all response permutations and reject missing,
duplicate or incorrect replies; the real-worker framing harness also passes on
Mac. Windows native packaging and Linux/Windows native UI acceptance remain open.

### Shared local contact intelligence follow-up

The `cluster_history` IPC name is retained, but the database-only handler now
runs on the shared logbook lane on all operating systems. It reuses the same
indexed candidate query and exact projection for prior-QSO counts, confirmations,
country band/mode matrix and latest entity QSO. It no longer constructs the
Mac-only cluster/vault service to answer an offline history request. The three
history projection tests now compile for portable targets; a new isolated-worker
test verifies this route while live cluster requests remain denied. Integer
parameters reject Booleans, fractions and out-of-range values rather than
truncating NSNumber values.

Acceptance workspace creation now explicitly disables native-preference
inheritance. The earlier native passes used separate writable workspaces but
could read safe native station defaults during creation; they did not alter
native preferences. The stricter deterministic setup needs another native pass.
Current Mac source verification: 139 XCTest cases, 48 Swift Testing cases, 94
Rust tests and 19 focused rotor UI tests pass; TypeScript/Vite also passes.
The planned 100,000-QSO native UI benchmark is still open; harness failures were
addressed before extending performance acceptance.

### Native Windows runtime and large log follow-up

Matrix `38287723409`, source `bd90b6d7e6d0e0ccb3ca4fe2e5502a53cab551c2`,
passed all three source/package jobs. Windows fresh-runner runtime job
`114946041508` passed without a Swift installation: worker framing/recovery,
local database round trip, module-origin checks and two native GUI launches.
Both GUI reports contain all 16 checks, detached band maps at 110% and 71/71
matching map framebuffer probes. The 1024×768 screenshot shows the application
rendering with stacked, vertically scrollable desk panels; compact/4K polish is
still an open acceptance item. This is Windows Server CI, not a Windows 11
consumer-desktop or physical-device pass. Reports are in
`docs/evidence/native-ui-bd90b6d/`.

Linux runtime-only job `114939996239` passed local logging, shortcuts, settings
and awards, then failed detached projection. Its screenshot shows the detached
page saying “The URL can’t be shown”. In the pinned Tauri/Wry code, GTK
incognito creates a fresh context per view while Tauri deduplicates scheme
registration by the shared context key. The acceptance-only correction assigns
separate temporary keys to detached views, retaining incognito and cleaning up
owned directories on exit. Matrix `38290139344` at `c49d456` now passes all
three build jobs and both fresh runtime jobs. Linux completed four native GUI
launches (three X11 and one nested Wayland), each with 16/16 checks, detached
projection and 70/70 map probes. Debian installation, relaunch and relocated
archive launch passed in a non-root, network-disabled Ubuntu container without
development toolchains. This closes the observed isolated detached-window
failure, not physical Linux desktop or network/hardware parity. Reports are in
`docs/evidence/native-ui-c49d456/linux-*.json`.

The 100,000-record acceptance extension uses generated ADIF through the shipping
bounded import API, then measures rendered logbook, first/repeat awards and
local history. During setup, SQLite confirmed `SCAN qsos` for every semantic
duplicate lookup because the existing case-insensitive index excluded deleted
rows but that lookup intentionally includes them. A new all-record composite
index retains duplicate/deletion semantics. The regression verifies indexed
query planning, case-insensitive matching, deleted-record suppression and the
existing one-second boundary. Native timings are now recorded in
[`NATIVE_LARGE_LOG_PERFORMANCE_2026-10-13.md`](NATIVE_LARGE_LOG_PERFORMANCE_2026-10-13.md).
Both indexed runs passed all 21 native checks. The history follow-up reduced
entity-history requests to 260/252 ms in the comparison run; repeat Awards and
rendered callsign history were 18 ms. First logbook display (1,800 ms) and first
Awards open (845 ms) remain above the near-instant target. Source tests alone
do not close that requirement. Matrix `38291686192` tests the follow-up source
`51307464d229afbbdd43c6268e0243d477a542f9` on all three platforms.

The aggregate-index follow-up also passes all 21 native checks: first logbook
display is now 80 ms, first Awards 698 ms, repeat Awards 25 ms and rendered
local callsign history 17 ms in the generated 100,000-contact run. Index-backed
stats/progress/map totals remove the preceding seconds of serialized database
work. Cold Awards, live-service contention and target-machine measurements are
still open. The installed signed alpha.7 remains unchanged until packaging.

### Shared Chaser and DX public feeds

The public-opportunities worker path now compiles outside the macOS-only service
router. POTA, SOTA, WWFF, WWBOTA and the 425DXN calendar use the shared parser,
installed activation references and local worked/confirmed history. Snapshots
read cached evidence; only explicit refresh contacts a publisher. On Windows
and Linux, this does not yet include the separately pending live cluster
transport or authenticated reference-download/vault services.

The same delegate-based downloader runs on every platform: HTTPS GET, no
redirects or credential/cookie storage, validated JSON response, bounded
2 MiB streamed body and cancellation. Failed refreshes retain the previous
validated feed with a stale status. The isolated native acceptance mode still
denies both opportunity methods before dispatch.

Local Mac verification passes 139 XCTest cases, 57 Swift Testing cases and
73 native core cases. Nine feed/projection tests cover all public programmes,
calendar parsing, no-network snapshots, worker routing, known and unknown
response lengths, invalid origins/content, redirects, cancellation and stale
cache fallback. The release worker build and its synthetic self-test pass.
Windows/Linux native compilation and runtime results for this source are
pending; no publisher, credential, radio or rotor endpoint was contacted.

### Isolated current UI acceptance foundation

The native acceptance launch now selects a dedicated worker session with a
random disposable support directory. Rust rejects hardware and external-service
requests before direct device dispatch; Swift independently allows only local
logbook workflows and pure diagnostics. Native-logbook copying, external backup
import, network services and credentials are excluded. Local mutations do not
refresh the operator's cluster history. EOF drains admitted local requests,
closes the database and removes the session's preferences and directory; later
requests cannot reopen it.

The foundation checkpoint passed 139 XCTest cases, 47 Swift Testing cases and
five real NDJSON process tests on Mac. The current driver now exercises LiveApp:
empty-workspace creation, keyboard QSO save/readback, editor focus, draft clearing,
settings persistence, bundled awards, detached band-map projection and final map
GPU evidence. Acceptance windows use private browser storage, avoid saved window
geometry and restrict external content through their CSP. Ordinary launches do
not wait for an acceptance IPC check.

Current local verification: 346 frontend tests, TypeScript/Vite build, 94 Rust
tests and 13 isolated local-logbook tests pass. Two native Mac release-executable
launches now pass all 16 current-UI checks with independent workspaces/private
browser state; see `NATIVE_LOCAL_UI_ACCEPTANCE_2026-10-13.md` and its raw reports.
Signed-package and Windows/Linux runtime acceptance remain open. The main JS
bundle remains 1.66 MB minified and produces a size warning, so startup/performance
acceptance is still open. The installed alpha.7 app has not been replaced; it was
reopened after testing with 67,846 contacts and ShackCQ reconnected.

### Latest alpha.7 checkpoint (CW integration, 13 October)

- CW settings, native persistence, optional desk row and guarded radio/WinKeyer
  controller are integrated and installed in signed/notarized alpha.7. Full frontend **344/344**,
  TypeScript/Vite, Rust **91/91**, Swift core **72/72**, and Mac portable-worker
  **138 XCTest + 40 Swift Testing** pass. No physical device traffic was used.
- Independent CW finish review found mismatched preview length limits; the shared
  backend-aware limit and nine boundary tests address this. The reviewer scored
  that single fix resolved, disposition **ship** at verdict-pass scope.
  Documentation handoff is complete without changing the incumbent design.
  Details: `docs/CW_IMPLEMENTATION_STAGE.md` and
  `docs/CW_UI_DOCUMENTATION_2026-10-13.md`.
- Alpha.7 native settings Save/restart and disarmed desk-row persistence passed.
  Restored the default hidden row, CQ label, radio output and unassigned keys.
  No serial probing, arming or sending occurred. Native shortcut/error-state,
  hardware/driver and alternate OS acceptance remain open. Exact package and
  qualified Awards observations: `docs/ALPHA7_INSTALLED_ACCEPTANCE_2026-10-13.md`.

### Earlier alpha.6 equipment / CW foundation checkpoint

- Full shared frontend: 311/311 tests, TypeScript clean; `git diff --check` clean.
- Rust desktop backend: 68/68 tests passed before the version-only alpha.6 bump.
- Swift core: 67/67 tests. Mac portable-worker build/test: 136 XCTest tests
  (17 station, 86 worker, 33 cluster) plus 40 Swift Testing cases, all passed.
- UI-26 source/fixture review disposition: **ship**, followed by documentation;
  no claim of installed-app or hardware acceptance. Browser fixture server closed.
- CW-02 pure rules are tested. CW-01 now has a guarded Rust serial actor and 19
  fake-transport/protocol tests (full Rust suite 87/87). Settings, main-window
  controller, CW-03 desk row, installed and physical acceptance remain open.
  See `docs/CW_IMPLEMENTATION_STAGE.md` before continuing.
- Alpha.6 source is frozen, pushed, signed, notarized and installed. Broader parity
  and performance gates remain open.
- Reference follow-up: Wavelog catalog semantic schema validation and cancellation
  of an already-running catalog check when changing to standalone mode remain open.

## Checklist

Performance follow-up after alpha.6: persisted revision-fenced award/stat/map
caches and indexed history UNION are implemented, tested and installed in alpha.7.
Optimized isolated 67,846-contact catalogue reopen measured 22–52 ms, versus
1.88 seconds for its initial calculation; first post-change calculation remains
open. See [performance evidence](PERFORMANCE_STAGE_2026-10-13.md). This does not
close PERF-01's packaged UI, cold-start or median/p95 acceptance requirements.

Later source-only cluster projection cache: full data equality, 73 core tests and
138 XCTest + 40 Swift Testing worker tests pass. Seven isolated fresh-connection
reloads measured 145 ms median / 155 ms p95, versus 1.63 seconds for first scan and
cache write. This is backend evidence with warm OS caches, not packaged UI timing;
first post-mutation work remains open. No installed app or live-log changes.

| ID | Requested result / acceptance | Source and test state | Installed / live verification |
| --- | --- | --- | --- |
| UI-17 | Band-map upper/lower frequency tick numbers fully visible, including enlarged text | Edge tick labels inset from chart clipping bounds | Alpha.6 at 1440×940 with 120% band labels: all four visible charts show complete upper/lower tick labels |
| UI-18 | HF propagation centered in available header space, separate from radio/status and weather | In progress | Pending wide/laptop check |
| UI-19 | Callsign/Country matrix same size and aligned; table + C/W/— legend only, no extra status chips | In progress | Pending packaged visual check |
| UI-20 | QRZ photo twice current size with full-size viewer; aligned previous-QSO columns, orange Worked and green Confirmed at mode text size | In progress | Pending packaged visual check |
| UI-21 | Operator workspace uses one toolbar: tabs + band controls or cluster status; no duplicate Band maps heading; green connected/red disconnected | In progress | Pending packaged visual check |
| UI-22 | Remove Operator Desk title and isolated-logbook/manual-sync header row entirely | Source implemented | Pending packaged visual check |
| UI-23 | Main Band Maps: remove duplicate page header and separate Undock row; Undock beside Add band map | Source implemented | Pending packaged visual check |
| UI-24 | Refine rotor instrument with readable scale, single observed needle, separate rim target and short-path arc; no fabricated motion | Source implemented; geometry and offline tests | Pending packaged visual check; hardware off |
| UI-25 | Move independent rotator configuration into Settings → Rotator; browsing settings leaves connections unchanged | Source implemented | Pending packaged navigation check |
| UI-26 | Hide unconfigured rotor; optional fixed-antenna type/name/bands or no equipment panel; reclaim its grid track | Implemented; 21 focused UI tests, settings migration/round-trip tests; full frontend 311/311 + TypeScript and Swift core 67/67. Fresh narrow UI review: ship | Alpha.6: saved temporary vertical/20–10m card, verified on Desk and persisted across navigation; restored automatic/empty-band preferences. Existing ARCO configuration correctly retains offline rotor. Synthetic no-equipment/wide/laptop fixtures passed. Relaunch of changed equipment, high-DPI and assistive-technology checks remain |
| SYNC-02 | Explicit standalone local vs local+Wavelog logbook mode; local mode blocks sync network, keeps all data, switching back never auto-syncs | Backend and UI in progress | Test saved mode/restart/no-network guards; current user mode unchanged |
| CW-01 | Cross-platform WinKeyer configuration and transport, separate from supported-radio CW route | Integrated in alpha.7: explicit saved-port connection/consent, serial actor, radio routing, 60-second arm, generation/intent gates, priority Stop and uncertain-output retention; 19 protocol + 19 controller tests; full Rust91/91 | Installed disconnected settings show consent/connection gates. No serial probing or RF tests; physical WinKeyer, driver, radio and Windows/Linux acceptance required |
| CW-02 | Up to20 editable macros, safe substitutions/preview, named colors and assigned keyboard shortcuts | Settings/native persistence/preview/keys implemented; shared80/128-character output limits; nine preview boundary cases; full frontend344/344, core72/72 | Review fix resolved; alpha.7 native label/display Save and full restart passed. Native shortcut and armed/error acceptance open |
| CW-03 | Optional customizable row of selected colored CW macro buttons under Active QSO | Implemented: one row, chosen colors/keys, More menu, explicit Arm/Stop and uncertain-output recovery; six laptop/wide/2x synthetic captures | Alpha.7 native five-button row appeared and persisted disarmed across restart; all sends disabled. Default hidden row restored. No physical4K or transmit claim |
| CLUSTER-01 | Restore live cluster after update; resume saved connected session on restart, respect explicit Disconnect; independent of offline radio | Startup resume implemented; intent/race regression tests passed | Alpha.6 automatically reconnected ShackCQ after installation/restart without pressing Connect; 12 live spots observed, radio/PA/rotor offline. Explicit-disconnect persistence covered by tests, not repeated against live feed |
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
| NIGHT-08 | Same shared UX on macOS/Windows/Linux, Mac-first package verification | Real local logbook/CTY/awards/settings/backup handlers enabled in portable core; package resource staging and disposable runtime round trip added. Native CI pending; network/vault/hardware and complete UI acceptance still open |

### Pre-package automated checkpoint

255 frontend tests and TypeScript checking passed after workspace integration,
provider Apply separation, multi-pointer drag protection and manual reference
clear protection. Shared Swift suite passed, including 30 Swift Testing cases
and the URL-free QRZ transport error fixture. Exact total and package evidence
are recorded with the release checkpoint, not inferred from these source tests.

## Closing a row

### Follow-up: all-screen title strip and full cluster columns (13 October)

- UI-HEADER-ALL: remove the redundant first title/logbook-status strip on every
  main screen, including Log QSO, Logbook, World Map, Station Control, Sync,
  Settings, Awards, DX Cluster and Chaser. Central wrapper removed; accessible
  main-region label remains. Operational warnings and section controls remain.
- CLUSTER-03: match Newest selector height to the filter buttons; add full-table
  show/hide columns, numeric widths, pointer and keyboard resize, reset and saved
  preferences independent of the compact Operator Desk table. Source and tests
  implemented; installed-app verification pending next package.

Installed alpha.11 verification: Log QSO opens directly at Active contact;
Logbook, World Map, Station Control, Sync, Settings and Chaser no longer show
the redundant logbook-status strip. DX Cluster has one title and reconnects
automatically; show/hide controls work without disconnecting. H49A draft and
67,846 contacts retained. Native numeric width entry exposed premature per-key
clamping; alpha.12 keeps an editable draft and applies bounds on blur/Enter.
Regression covers partial typing, empty input, out-of-range input and persistence.
All 21 signed-app checks passed on 100,002 generated contacts; report in
`docs/evidence/native-ui-alpha11/mac-signed-large.json`. Notarization
`8d246f6b-c1a4-4b1b-8c68-ec31efb97e52` accepted. No RF commands used.

Installed Chaser automatic refresh verified without pressing Refresh: POTA 82,
SOTA 6, WWFF 10, WWBOTA healthy zero, DX calendar 56; 154 total observations.
Programme tabs are present and the table reaches the bottom pagination rail.
All 358 frontend tests and TypeScript pass after the numeric-entry correction.

Alpha.12 installed checkpoint: notarization `5f077292-3e2d-4de1-bfd9-86254a05a882`
accepted, staple/signature verified; archive SHA-256
`d130a881cf1ce1a5ae7b01d7c29c3c144963a45a78665dd715e26bbeef518d5b`.
All 21 signed native checks passed on 100,002 generated records. Live native
typing now reads Callsign width 180 after Tab, cluster stays Connected. Defaults
restored after test; no radio, rotor or transmit command. Exact-source all-platform
CI `38312294786` remains separate and pending at this checkpoint.

HEADER-04 (requested, source implemented; package verification pending): move Monitor
from the top station rail to the bottom-left sidebar footer; enlarge the configured
station callsign and grid without changing their values or Monitor behaviour.

Alpha.13 candidate: DXpeditions second; IOTA includes explicitly referenced calendar
operations and recent tagged cluster spots. Reference-area pins remain visibly
approximate; no coordinates are invented for unlocated expeditions. Calendar dates,
exact-call fresh cluster frequencies, frequency-free map entries, date-line-safe
centres/bounds and filter-driven camera fitting have regression coverage. Selecting
an island expedition carries the IOTA reference into a draft, without station I/O.
Browser fixture checked at 1440×900. Impeccable layout detector returned no findings.
Shared Swift suite passed (71 Swift Testing cases, XCTest suite also successful).
Frontend full run: 363 passed with one worker; the initial concurrent build/test run
had timeouts and was not accepted. Expanded LiveApp follow-up: 9 passed. TypeScript
and Vite build passed; existing large-bundle warning remains a performance follow-up.

Record the source SHA, exact test evidence, installed version, and observed
result. Leave partial or failed gates visible. Add newly reported issues here
before implementation; do not replace this list with a generic “done”.
