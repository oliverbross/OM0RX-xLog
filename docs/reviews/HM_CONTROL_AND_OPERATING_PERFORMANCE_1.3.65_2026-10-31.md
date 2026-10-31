# HM Control and operating performance — 1.3.65

## Requested behaviour

Integrate Billy NZ3C's Ham Mission Control under **Window → HM Control**, using
the current xLog station, radio, cluster and local log. Correct slow durable QSO
saves/log refresh, rapid-selection rotor cancellation, and interrupted
FLEX/Maestro spot forwarding. Preserve the operator's contacts and settings.

## Changes

- Draft reads, replacement autosaves and receipt replays no longer eagerly build
  an unused blank draft. Required new drafts are still validated transactionally;
  a failing seed rolls back the save. Settings authorization reuses the current
  settings target revision without weakening receipt or workspace fences.
- Same-generation contact refresh no longer reloads station settings, rotor
  configuration, preferences and the canonical draft. Initial/explicit reloads
  and workspace changes retain full initialization. Late preference migrations
  cannot publish over a newer reload.
- Cluster snapshots cache their visible projection and infer a retained spot's
  mode only when its inputs change. Fixed mode expressions are compiled once.
  Filter, country, contact, palette and transport changes invalidate projections.
- Normal FLEX forwarding uses a bounded queue and retries failed delivery after
  five seconds. It rechecks current visibility, connection generation, settings,
  expiry and termination. Enabling forwarding replays currently visible reports.
- Rapid manual QSY keeps the newest absolute destination. Spot selection retires
  the previous automatic rotor permit and orders an acknowledged Stop before the
  next QSY, including a previous completed tune whose rotor may still be moving.
  Supersession preserves Auto policy and cannot resurrect the previous target.
  Missing Stop acknowledgement blocks further native admission until an explicit
  correlated retry succeeds. A transport acknowledgement does not prove physical
  cessation; existing uncertain-release protections remain authoritative.

## Ham Mission Control integration

Upstream: <https://github.com/Billy-NZ3C/ham-mission-control>, exact commit
`7203724e7a3374d955430cf3e16dff8458be0212`; `index.html` Git blob
`b9ea44b3e38fa4bb4752b572fd897c51b70c91fa`.

The original HTML, README and MIT license remain under
`prototype/vendor/ham-mission-control`. The reproducible generator adapts the
original dashboard to a separately loaded native window. Three.js, D3,
TopoJSON, satellite.js and MQTT are version pinned; globe textures and radar
geography ship locally with recorded SHA-256 digests and license notices.

The window displays the configured xLog callsign/grid, fresh selected-radio
frequency/mode/PTT, the shared filtered cluster, and the entire live log's totals.
Map points are grouped into at most 2,592 geographic cells. Grid centres and
stored-DXCC approximations are distinguished; absent locations are counted rather
than invented. Committed additions and confirmations, including older contacts,
drive the original animations. New confirmed DXCC entities use the country
celebration. It has no contact-editing, credential, radio-control or relay access.

The globe/radar, clocks, PSKReporter reception reports, amateur satellite passes,
weather and space-weather surfaces retain the upstream composition. Live public
HTTP feeds use bounded native endpoints with fixed destinations, deadlines and
caching. Scripts and textures do not require a CDN. Sample contacts, standalone
ADIF storage, private setup/relay configuration and simulated-transmit shortcuts
are removed in favour of xLog's existing owners. External feeds are disabled in
isolated acceptance. Closing the window retires its renderer.

## Verification status

- HM Control core projection: 2 tests passed, including same-count confirmation
  updates, another SQLite connection, deleted rows, grid/DXCC location authority
  and unchanged contact records.
- Exact-source rotor/coordinator harness: 82 tests passed, with transports that
  fail if unexpectedly invoked. Covers cancellation, Stop uncertainty, editor
  leases and the confirmation/revocation race.
- Manual QSY: 17 frontend tests passed. Spot activation client: 14 tests passed.
- Broader rotor UI: 29 tests passed. The rerun used a CLI-only 20-second ceiling
  after host-pressure timeouts; every test finished in less than 3.1 seconds.
- Dashboard visual checks: local isolated fixtures at desktop and 1000×640;
  rendered globe/radar, live-style shared radio/cluster/log data, attribution and
  working globe stop control. These are fixture checks, not provider acceptance.
- Full native application: 967 tests passed, zero failures, single test thread.
- Portable Swift service run: 55 tests passed (19 automatic-sync, 19 cluster
  session and 17 draft/forwarding tests). Includes all six forwarding recovery
  cases and lazy-seed, legacy migration, simultaneous save and replay checks.
- Main frontend regression: 110 cases passed across logging, restore, spot
  barriers and HM Control. The held-save check proves immediate Saving feedback,
  durable-only success and no repeated setup reads for the same workspace.
- Shared map/HM observation gates: 10 cases passed; standalone window loader:
  20 cases passed. Duplicate reruns are not additional coverage.
- Production frontend build/type check and detached-window budget checks passed.
  Packaging repeats these against the final versioned source. Packaged payload,
  signing/notarization and installed acceptance remain pending below.

## Isolated timing baseline

The installed 1.3.64 worker was exercised against a private SQLite backup of
69,556 contacts, with external services disabled and process launch coordinates
verified. Five warm durable-save → workspace-count → first-logbook-page timings
were 455, 374, 122, 307 and 302 ms (median 307 ms). Cold workspace opening took
81 seconds during severe host memory/scheduling pressure. This isolates local
storage/receipts; it does not reproduce live providers, WAN round trips or
renderer load, and is not a claim about operator-visible 10-second delays.

## Release provenance and installed acceptance

Version preparation: **1.3.65**, advancing the installed 1.3.64 candidate.
Implementation source: `4108f1a2f7abcd7afed2940fc26aeb576932a18e` (HM Control),
with save fix `35c0dedd7469e0fd0246bf7c7d4ac0fb0010bdb1`, QSY/rotor fix
`798687f578b7c6f240826abdbff0c5f5778ca21d`, and cluster/forwarding fix
`86fc95ae094dc7acec802763beb34bc6111c3d24`.

Build only from this canonical clean main checkout. Warm the Swift release
worker using `bash prototype/scripts/build-worker.sh --jobs 1`; then run
`CARGO_BUILD_JOBS=1 bash prototype/scripts/package-macos.sh` at reduced scheduling
priority. The packaging script captures the exact versioned source commit in
DistributionMetadata and verifies the packaged worker/resources/CW payload.
Notarization and installation are separate acceptance steps; their exact source
commit, signatures, hashes, backup and rollback evidence are recorded below after
verification. No installed or physical-hardware acceptance is claimed yet.
