# P3 shared-app parity work — 12 October 2026

This increment continues the shared Tauri/React application. It does not switch
to a native-only host, require the standalone xCat/xCluster applications, or
claim 100% parity. The historical gap audit is `P3_PARITY_LEDGER.md`; its initial
source observations predate the changes listed here.

## Implemented in this increment

- Embedded Remote Station Agent remains the normal remote connection; managed
  local radio and rotor connections use packaged Hamlib 4.7.2. Serial-device
  discovery, model search, framing/control-line settings, capability readback,
  health status and explicit reconnect are available. Reconnect does not replay
  hardware commands. An external loopback daemon is optional, not required.
- Hamlib and libusb are source-built from pinned, verified archives. The Mac
  helper binaries depend only on system libraries/frameworks; licences and
  source provenance ship inside the application.
- Worker requests are ID-correlated and bounded, with independent reply dispatch.
  A slow service operation cannot hold a faster station reply behind it. EOF and
  timeout retire a worker generation rather than replaying uncertain writes.
- Optional embedded TS-480 CAT and RigCtlD listeners use explicit port setup.
  Connection ownership covers in-flight transmit attempts and disconnect release;
  listener/session changes drain authorized work before final owned release.
- The station configuration editor exposes hardware, Maestro binding, tune and
  per-band routing/drive settings, with an explicit change review before saving.
  Unknown configuration fields survive the worker's JSON round trip.
- Native-style navigation and station sidebar, a full typed QSO editor, multiple
  band maps, native cluster palette and award-library facets replace the earlier
  basic surfaces. Manual radio-field edits suspend Follow so polling cannot
  silently replace the values being saved. Digital log modes are retained when
  the radio reports the corresponding data-carrier mode.
- The map uses satellite relief imagery with bundled offline DXCC geography,
  semantic labels, worked/confirmed status, sun/greyline and great-circle paths.
  This is not Apple MapKit: the current imagery does not supply city/street labels.
- Graphical propagation now has its own cached service and retains last-good
  values through refresh failures. It no longer depends on a standalone xCat UI.
- A second application launch focuses the existing main window instead of
  starting another integrated service owner.
- Detached maps and the station monitor consume the main application's selected
  spot and station projection. The monitor does not create a second hardware
  polling loop, and stale projections disable its controls.
- Callsign and country band/mode matrices use authoritative logbook queries.
  Callsign aggregation includes old confirmations beyond the recent-history
  page. Read Radio is shared by the editor button and keyboard shortcut.
- Online callsign lookup failures retain useful offline CTY results. Empty or
  mismatched online fields cannot replace the selected station's location;
  coordinate, grid-centre and approximate-country provenance are distinguished.
- Hamlib simplex tuning verifies VFO A and split-off readbacks before frequency
  or mode writes. PTT/tuner ownership survives an unverified OFF response;
  disconnect/profile handover reports unresolved release instead of concealing it.
- Worker exit closes admission and gives accepted requests a bounded graceful
  EOF drain. A terminal station cannot be reopened by a late queued connect.
- A third, direct-LAN FLEX provider now owns its transport independently of the
  Windows agent. Supported tuning and VFO controls require observed readback;
  unavailable RIT/XIT/RF-power/CAT/SmartLink functions are not advertised as
  implemented. Transmit ownership and interlock evidence are tested without RF.
- RUMlog Logbook/Contest UDP settings expose all eleven native style categories.
  Explicit loopback listeners bind exclusively, roll back partial startup,
  bound source flows and pre-actor queued work, and share acknowledged spot
  deduplication with xCluster. This forwarding path currently requires the
  Remote Station Agent. ACK counts are not Maestro visual-display proof.
- Workspace startup distinguishes pending, failed and confirmed-empty states;
  a slow startup no longer presents empty-workspace creation controls.
- Country-matrix responses are decoded from their actual nested worker contract.
  New rotor requests receive their own movement grace period rather than
  inheriting the previous target's last-motion timestamp.
- The small detached monitor map omits the full-size layer toolbar and legend;
  full controls remain available in the World Map workspace.

## Acceptance discipline

Native core, shared Swift, Rust, frontend, worker-process, packaged launch and
physical station observations are separate evidence classes. Dummy rig/rotor
tests prove protocol and process behavior, not acceptance of a physical model.
An acknowledged request is not an observed hardware result.

No test in this increment is authorized to transmit RF. The operator has allowed
frequency changes and rotor motion; those tests must record initial, requested
and observed states. Do not change Windows commissioning, credentials or policy.
Never include bearer tokens in reports, screenshots or source control.

The original native SQLite logbook and native source work remain preserved.
The integrated app continues to use its separate working copy and manual sync.
No synthetic QSO is to be inserted into that copy for acceptance. Only one xLog
application bundle is retained in Applications. Preserve outgoing builds in a
dedicated rollback directory **outside Trash**: a Trash-triggered application
cleanup was found to have also removed associated data. See the
[recovery record](P3_WORKSPACE_RECOVERY_2026-10-12.md). Do not use Trash-based
app replacement or remove application support/preferences during upgrades.

The Developer ID-signed alpha.2 built from `87f778a` has now passed authenticated
embedded-agent connection, OM0RX-13 cluster reception, receive-frequency change
and restoration, and observed DCU-1 rotor movement/return. The original native
database is preserved and the private working copy contains 67,843 contacts.
See [exact-build live evidence](P3_LIVE_ACCEPTANCE_2026-10-12.md), including the
transient rotor-status defect discovered in this check.

## Remaining acceptance gates

The P3 ledger remains open for complete direct-FLEX/SmartLink coverage, live
spot-forwarding/display acceptance, migration/profile ownership, clean-machine
Windows/Linux live services and portable secret storage, notarization, and
named physical local Hamlib radio/rotor acceptance. These cannot be closed by a
successful Mac compile or a dummy backend test. Additional UI and data-workflow
rows close only with their listed exact-build evidence.

Exact final test counts, artifact hash, source SHA and new live observations are
recorded with the release after packaging; earlier alpha observations must not
be attributed to this build.
