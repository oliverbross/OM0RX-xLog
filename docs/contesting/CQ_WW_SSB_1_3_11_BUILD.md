# macOS 1.3.11 release plan

Exact application source commit: `8ea98cd24f3aaf6fecdeff836fea05f6862a2f6c`.
The version/build commit is the clean commit containing this release record; its full SHA is embedded in both package receipts and recorded in the reconciliation document after installation.
Version metadata advances from 1.3.10 to 1.3.11 with this record. Packaged and installed results are recorded separately in the reconciliation document.
Package only the clean canonical `/Users/oliver/Documents/Projects/OM0RX-xLog`
checkout with `bash prototype/scripts/package-macos.sh`; the embedded distribution
and Python runtime receipts must identify the exact build commit.

## Implemented scope

- N1MM navigation profile is opt-in: previous/next spot, previous/next needed
  multiplier, quick edit of the last QSO, return to CQ, clear, Run/S&P and log
  shortcuts. Existing custom bindings remain intact. Enter continues to log
  from any entry field; callsign-field frequency/mode commands retain explicit
  command intent and the native radio admission path.
- Configurable SSB tuning tolerance protects small VFO adjustments. Operator
  retuning, observed spot capture, local Heard spots and retained logged spots
  share contest-owned state. Band Map labels keep stable positions while spots
  and classification change; Cluster supports persistent column order, widths
  and sorting. Log column order/widths/sorting and its resizable pane split persist.
- DXCC and zone matrices offer configured/current/all bands and Worked, Needed,
  Spotted-needed and All views. The CTY primary-entity universe includes unworked
  countries, preserves distinct CQ entities, excludes aliases and supplies
  continent metadata. Available spots use the shared selection action.
- Rates add UTC/local clocks, time since the last QSO, an hourly graph and a
  saved hourly goal. The host computes bounded hourly history from the full log,
  including quiet hours; projections normalize timestamps to canonical UTC ISO.
- CQ WW received-zone/reference mismatches and same-call history conflicts appear
  as advisory entry/log warnings. Valid operator-entered received values remain
  unchanged and are used for the logged exchange.
- Draft content revisions prevent passive focus, lookup and presentation updates
  from rejecting an otherwise unchanged action. Callsign, exchange, frequency,
  mode, operator, Run/S&P, serial and rule/reference changes still invalidate it.
  Native action envelopes and at-most-once receipts retain their original identity.
- Classification rebuilds retain display continuity with context and candidate
  signature checks. Authoritative scoring remains host-owned; radio publication
  requires current classifications. The map follows the current entry target.

## Click/tune shadow correction

Spot selection records its pending radio tune **before** applying the new draft.
Old and intermediate telemetry cannot pull the newly selected callsign back to
the previous frequency or manufacture a Heard spot there. Target arrival updates
the observed-frequency anchor without treating the commanded tune as an operator
departure. Failure clears only that operation's pending intent.
The focused SX5P regression covers selection at 7.150 MHz while telemetry still
reports 7.129 and then 7.135 MHz: one draft mutation, retained callsign/zone, and
no spurious Heard spot at either intermediate frequency.
Previously created incorrect Heard overlays are not retroactively removed;
they remain until normal expiry or operator deletion.

## Verified before source freeze

| Scope | Result | Boundary |
| --- | --- | --- |
| Python CQ WW SSB, hourly rates and existing rate boundaries | 31 passed | Current source, installed bundled Python runtime, disposable stores |
| Existing CQ WW SSB workflow suite, repeated after tune review | 27 passed in 7.259 s | Current source; Run/S&P, DUPE, invalid zones, corrections, export and reopen |
| Swift `PythonContestLaneTests` | 12 passed | Source bridge/reference projection tests |
| `useContestSurfaceOwner.test.tsx` | 17 passed | Semantic revision and owner action tests |
| Rust `contest_surface::tests` | 32 passed | Native schema, admission, receipt and optional metadata tests |
| Whitespace validation | `git diff --check` passed | Source only |

The 27-test repeat overlaps the 31-test Python run; these counts are not additive.
Final frontend validation: Workspace 177, detached/secondary panels 176, owner 17, Cluster/Band Map/Map 115, protocol 88, setup 44 and key bindings 8 tests passed (625 distinct tests across focused runs). TypeScript and diff checks passed. Narrow and wide synthetic UI screenshots verified clock wrapping, matrix sizing and log column/divider controls. Focus, typed-call provenance, rapid Next and delayed/skipped radio telemetry have regression coverage.
No broad test matrix was started for this release-plan review.

## Remaining release evidence

Before installation, preserve production contest/normal SQLite databases through
read-only SQLite backup connections, plus settings, services and window state.
The prepared `/private/tmp/xlog-1311-verify.py` retains the previous
`preservation.json` and top-level `contest.sqlite` backup layout.

After the final build, run the existing 27 CQ WW tests with imports forced to that
bundle's host/tests/vendor and its embedded interpreter; verify version, exact
source receipts, component hashes and code signatures. Record packaged and
installed hashes separately, then run the installed native isolated acceptance
CLI (`--acceptance-report` with a new absolute JSON path).

Packaged verification: **PENDING**. Installed verification: **PENDING**.
Physical radio, PTT, audio and rotor behavior are outside these source/disposable
checks. No production contact or station operation is needed for this verification.
