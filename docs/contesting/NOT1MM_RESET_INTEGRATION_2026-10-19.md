# Not1MM contest-module reset integration — 19 October 2026

This checkpoint records the first connected production Not1MM-host integration without replacing
accepted normal-station work or rewriting another set of contest rules in Swift.

## Consolidated source

- Accepted normal application line: `c1b2aa09843b85d8f3f7efbd3abf2179fa513d26`.
- Exact 1.2.28 application source on that line: `0d53d7554248818f637186598a6d8fef7e23dcc9`;
  `c1b2aa0` adds its release-acceptance record.
- Accepted contest operator foundation: `0df483246caef637a0ccfd5a5b9ab6e62fdc5301`.
- Shared ancestor and fetched `main` at consolidation: `b9accc7f81453f1f2cab1758a48192322213f590`.
- Integration merge: `c800242` on `codex/not1mm-contesting`, with parents
  `c1b2aa0` and `0df4832`.

The merge retains the release line's amplifier, rotor, cluster-filter, portable
callsign, DXCC-confirmation and previous-QSO-history repairs. It also retains the
contest foundation's durable receipts, corrections/deletions, snapshots,
exports, SCP/history, statistics and docked/detached window plumbing. Historical
contest worktrees and the divergent isolation/VHF branches were not merged.

## Engine decision and source pin

New Python contest sessions execute the pinned Not1MM source instead of adding
more Python-to-JSON-to-Swift semantic mappings. The initial source pin is
`oliverbross/contest-sw@7c8b499225a73f7f8f792246881bd7aefc05452f`.
Original vendored bytes, hashes, GPL-3.0-or-later license and the finite host
overlays are recorded under `python/vendor/not1mm/`.

The first production slice is CQ WW CW. A bounded JSONL child owned by the
existing Swift worker executes the real plugin against an upstream-compatible
SQLite store. xLog keeps ownership of windows, reference data, radio, CW,
cluster, spots, rotor and native file destinations. Python emits typed intents;
it opens no station or network connection.

The application package carries its own Python 3.12 framework and host source.
Production launch is application-relative and never searches `PATH`, user site
packages or a developer Python installation.

## Connected CQ WW desktop

The implementation is split into logical, pushed commits on
`codex/not1mm-contesting`:

- `9076e72` shares xLog presentation and compact native-window plumbing.
- `8b47097` adds the replay-safe host around the actual pinned CQ WW plugin.
- `fabc011` routes the production Contesting module to that host.
- `c17460f` bundles the isolated Python 3.12 runtime.
- `ed12d0e` connects CTY, CW context, selected-radio tune and native export to
  xLog-owned services.
- `e9388e8` connects the CQ WW manager/desk, entry, log, Check Partial, score,
  multiplier matrices, Bandmap, Cluster and CW controls to the Python contract.
- `a46e2e5` makes the bundled Python runtime relocatable, recursively internalizes
  its dylib closure and rejects runtimes newer than the app deployment target.
- `63fd847` moves one-key ESM/CW into native admission with durable, at-most-once
  output consumption and Stop/replay fencing.
- `2cafc59` pins new country resolutions to the session CTY version and uses the
  endpoint resolver's token-level zone and continent overrides.
- `0141cfb` executes the pinned Not1MM Run/S&P CW macro set through xLog's
  native validation, arming, output and Stop owner.

The desktop follows the Not1MM projection for visible fields, tab order,
Run/S&P, Enter/ESM and F1–F12 actions. Duplicate QSOs remain loggable so the
plugin can retain and score them according to upstream behavior. Function-key
actions are intents only: xLog resolves the matching saved macro and its
explicitly armed CW output lease. A selected spot is written to the active
Python draft before exactly one selected-radio tune request. Cabrillo uses the
existing native Save panel and bounded prepared-artifact transport.

## Data boundary

Existing `contests.sqlite`, snapshots and Swift sessions are preserved. Their
reader/export path remains available during transition. New Python sessions use
private per-session databases below `Contesting/Python/<session-id>/`. One
engine owns a session; the Python and Swift stores are never co-writers.

Python operations use stable session, draft, QSO and operation identities.
Mutation receipts, payload conflicts, audit/tombstone records and plugin SQL are
committed together. A repeated exact request returns its saved result without
re-emitting physical-output actions. Migration and normal-log transfer remain
separate acceptance work; ADIF alone will not be treated as a lossless migration.

## Supplied proof and evidence boundary

The reset package's ten Git blobs were verified, and its Python 3.12 feasibility
run reproduced CQ WW CW score 16, CQ WPX CW score 8, ARRL Sweepstakes CW score
8 and Trans-Tasman score 4. Trans-Tasman's inherited Cabrillo frequency defect
(`7025000` instead of `7025`) remains an explicit compatibility patch item.

That feasibility run did not establish real RF/audio, installed application
relocation, migration, all 94 plugins or organizer certification. Repository
acceptance now adds 19 Python host tests, 2 Swift bridge tests, focused Rust
service tests and more than 320 Contesting frontend tests. The production frontend bundle
also builds successfully. These establish source-level CQ WW integration,
framing, replay, rollback, correction/deletion, restart and export behavior;
they do not establish installed-app or physical-station operation.

## Remaining ordered work

1. Complete installed CQ WW correction/export/restart acceptance, including a
   deliberate RF-safe CW test and radio/cluster evidence from the real station.
2. Preserve the complete CTY resolver snapshot for explicit session migration;
   mixed-version additions are now rejected.
3. Add explicit normal-log transfer and a lossless legacy-session migration
   path; keep both opt-in and auditable.
4. Exercise WPX serial reservation and Sweepstakes packed exchange, then carry
   their actual plugins through the same bounded host contract.
5. Expand the finite callback surface across the pinned 94-plugin catalog and
   complete the remaining real windows before retiring superseded production
   translators or claiming the full port.
