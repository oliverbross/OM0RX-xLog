# Full application review coverage — 28 October 2026

**Status: INCOMPLETE manual review.** This stage maps the tracked repository,
executes broad checks and records ten substantiated defects. It does not claim a
semantic audit of every file or line. No fixes were implemented.

Reviewed source: clean canonical `main` at `4bd554a25951ddc995b4bef1715d3df12918a07b`.
`origin/main` was fetched and fast-forward checked. No initial uncommitted changes
existed. New review reports and isolated evidence are the only intended changes;
older records are preserved. The inventory is frozen to the source baseline and
does not count this review's newly created reports/evidence as application scope.

Findings, architecture, workflow traces, commands/results and remediation are in
[CODE_REVIEW.md](/Users/oliver/Documents/Projects/OM0RX-xLog/CODE_REVIEW.md).

## Per-file ledger

[REVIEW_INVENTORY.tsv](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/full-code-review-2026-10-28/REVIEW_INVENTORY.tsv)
has one row for **every one of the 2,347 tracked baseline files**, with line/byte
counts, scope, depth, inspected ranges/contracts and separate check annotations.
Paths are relative to `/Users/oliver/Documents/Projects/OM0RX-xLog`. This is the
authoritative exact remaining-file list. Passing tests never upgrade manual depth.

| Depth | Meaning | All files | First-party source/test/config/tooling |
| --- | --- | ---: | ---: |
| Fully reviewed | Complete file inspected in context for scoped contracts/failure paths; not certification of all possible behavior | 87 | 81 |
| Partially reviewed | Selected functions/ranges/workflows; remaining semantics open | 79 | 72 |
| Scanned only | Structural/pattern inspection or targeted search; no full semantic walkthrough | 1,435 | 1,434 |
| Not reviewed | Inventory only | 617 | 25 |
| Excluded | Specific reason recorded per file | 129 | 2 |
| **Total** | | **2,347** | **1,614** |

Scope taxonomy: 1,614 source/test/config/tooling files, 79 resource/data files,
542 supporting documentation/data/media files, 112 vendor files. The exclusion
count differs because vendor manifests were partially reviewed and selected media
were excluded. These categories do not make tests/configuration/resources optional.

Applicable first-party code received whole-file scans for execution boundaries,
swallowed/fatal errors, SQL writes/schema, sensitive storage/logging and renderer
DOM/navigation/journals. The 2,570 location matches are retained without matched
values in [SCAN_HITS.tsv](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/full-code-review-2026-10-28/SCAN_HITS.tsv).
These are unvalidated triage leads, **not 2,570 findings**. Most matches were not
individually validated. Scans do not satisfy the semantic-review backlog.

## Subsystem coverage

| Area | Examined / executed | Remaining |
| --- | --- | --- |
| Architecture/workflow/manifests | Entry points, target/platform declarations, clean source state, role/identity/trust boundaries | Historical release descriptions are inconsistent; installed state not inferred |
| React frontend | 814-file bounded inventory, draft/contact journals, input/close barriers, transport, selected import/sync/contest/time paths; actual React probes, full tests, build/audit and limited reruns | Most controllers/windows/settings/maps/awards/propagation/codecs/tests remain scan-only |
| Rust/Tauri | IPC/generation/deadlines, main exit, station/release and recorder consumers, isolation/CSP/capabilities; 913 + 26 tests pass | Most command/provider/lifecycle combinations need full semantic tracing; no native GUI |
| Swift station/CW/cluster/C | Registry routing, agent lifecycle/releases/capture, fldigi/WSJT-X boundaries, selected CW queues/loopback; fake-RPC probe | Complete FLEX/TCI/Remote Agent reconnect/parsing, keyer/CAT/rotor, sockets/vault and decoder audit |
| Normal persistence | Selected database transaction/schema/import/sync/draft paths; complete OperatorDraft contract; real SQLite Save/reopen/receipt and legacy import probes | Many contact/power/delivery/cache mutations and test oracles remain partial/scanned; contention/crash/scale acceptance open |
| Sync/services | Wavelog request/readback, JSON/ADIF consistency, ambiguity holding, merge/deletion/ack, selected LoTW/reference/cache/cloud/FTP | Full joins/fingerprints/service contracts and failure matrix; no live accounts |
| Backups | Seal/path capture/materialization, staged SQLite verification, recovery/rollback/incomplete marker, local adapters, FTP/TLS/OneDrive boundary | Full authorization/retention/retry/restore owner and all transports; no personal backup/cloud operation |
| Python contests | Loader/provenance and selected dispatch/mutation/receipt/import/export/score/recorder/serial/replica; 537 tests and real Host probes | Host validators, overlays, multipliers/analytics/message/strategy tails and test assertions |
| All catalog entries | All **97** definitions exercised: **1,353 PASS / 5 NOT APPLICABLE**, zero failures in finite lifecycle checker | Not every sponsor rule/category/physical output/export submission; WAE bug survives checker |
| Swift contest core/store | All three store source files and persistence contracts fully read; selected rollback/revision/serial/concurrency/snapshot tests; Swift suites pass | Most rule packs, exporters/projections/loaders and platform branches; inactive VHF compatibility question |
| Retained SwiftUI | Default product/build route, selected forms/UTC/import/restore, actual core import-loop probe | Most AppModel/view/provider/restore failure paths; no native launch |
| Build/release/CI | Manifest/lock integration, job/platform selection, pins, Mac package/install/rollback/Hamlib recipes; shell syntax | All platform/staging/notarization/installer/supply-chain branches; no release script executed |

Bounded reviewer records are preserved in `subreviews/`; root CR IDs supersede
their local IDs. Root checked findings against source, callers, guards and probes.
The ledger merges explicit inspection; it does not claim each full file was read
twice independently.

## Exclusions and access boundaries

- Generated/build output (`.build`, `target`, `dist`), dependencies (`node_modules`),
  caches, staged runtimes and bundles are excluded from routine source inspection.
  Built core objects executed probes; one retained official WAE page under `.build`
  was hash-checked for a specific finding.
- Vendored Not1MM/DeepCW/model implementations are excluded from routine body
  review. Pins, manifests, loaders and application contracts were examined
  selectively; this is not a complete dependency/model audit. Bitmap/icon geometry
  exclusions are per file. Historical docs/reference data mostly remain inventoried
  only; their loaders and sponsor/category currency are separate gaps.
- The pinned `oliverbross/contest-sw` corpus at
  `7c8b499225a73f7f8f792246881bd7aefc05452f` was not freshly cloned/compared.
  External xCat/Remote Agent, real radio/rotor/keyer/digital engines and account
  configurations were not operated/audited as separate repositories.
- No production logbook, personal backup, credential value, installed app,
  microphone/device or physical station was accessed by probes. No app launch,
  package/sign/notarize/install or native AX input was attempted. Provider/native/
  RF qualification remains **UNVERIFIED**.
- Live official WAE retrieval returned 403; a hash-matched retained edition and
  official historical corroboration support CR-006. `cargo-audit` is absent;
  current Rust advisories remain unchecked.

## Validation and continuation

Full outputs, including failures, are in `checks/`; commands are in the evidence
README and CODE_REVIEW.md. Swift native/portable runs pass but overlap; their
counts are not unique coverage. Python 537 and Rust 913 + 26 pass. Frontend
build/typecheck and registry audit pass. Initial `npm test` has 4,705 passes and
two 5-second timeouts; targeted 2/2 and full affected-file 195/195 reruns pass.
There was no later all-green full-suite run. Final isolated UI regressions fail
their intended-behavior assertions and reproduce CR-008/010. SQLite/Host probes
assert counterexamples; their exit 0 is not a product-correctness result.

Exact remaining work, in order:

1. Repair/qualify CR-001/008 together through editor navigation → real Save →
   export/receipt/reopen. Finish native lifecycle tracing through both registry
   slots, `LiveWorker`, `LiveStationMethods`, `LiveStationSession`, FLEX/TCI and
   Rust worker/selection/PTT/Tune/release/CW/module retirement; fake transports first.
2. Complete all partial `LogbookDatabase`, `SyncEngine`, `LiveLogbookMethods`,
   `BackupManager`, `ReferenceDataUpdater` ranges. Inspect every remaining delivery,
   LoTW/cloud/FTP/SFTP authorization/retention/restore state machine and failure-test
   oracle. Add disposable contention/crash/restore/million-contact evidence;
   do not extrapolate this run to power-loss durability.
3. Reconcile historical import with authority/replica audit/identity/serial/cursors,
   digest changes/rejoin/replay. Finish Host validators, `upstream.py` overlays,
   `multipliers.py`, analytics/messages/strategy and remaining Swift rule/export/
   resource/platform paths. Supplement 97 lifecycle seeds with independent current
   sponsor/category edge-case oracles.
4. Review remaining `LiveApp.tsx`, `Not1MMContestWorkspace.tsx`, detached contest
   protocols/controllers, settings journals, ADIF/ADX/export metadata, detached
   window transitions, maps/classification/awards/propagation/accessibility and
   malformed/recovery states. Complete retained SwiftUI orchestration separately.
5. Complete native/C provider parsing/cancellation/reconnect/cleanup, recorder and
   group-network paths; verify upstream corpus and Rust/native runtime/model
   advisories/provenance. Finish build/CI/platform branches still partial/scanned.
6. Resolve frontend timeout flakiness under representative resources. Any native
   UI acceptance must follow AGENTS.md's explicit disposable-root and process
   verification requirements. Package/provider/account/hardware qualification
   needs its own exact provenance and scope and has not happened here.

Use the per-file ledger and saved probes for continuation; do not restart the
architecture inventory or treat this stage as a completed whole-codebase audit.
