# ARRL VHF source-preview contract

**Contract date:** 2026-10-18
**Status:** inactive source preview; not catalog, schedule, category, rover, or sponsor-submission complete

This checkpoint materializes three immutable declarative definitions from the pinned `contest-sw` comparator at `7c8b499225a73f7f8f792246881bd7aefc05452f`:

| Preview identity | Pinned source | SHA-256 |
|---|---|---|
| `arrl-vhf-january` | `not1mm/plugins/arrl_vhf_jan.py` | `692e8456947e307c15ae04c8ffe56a38f5f9475c22973a30d80b3879aeecb990` |
| `arrl-vhf-june` | `not1mm/plugins/arrl_vhf_jun.py` | `dd7d4183aa106125b3223aca6e2479341a8264995ea5b0261357301325573aff` |
| `arrl-vhf-september` | `not1mm/plugins/arrl_vhf_sep.py` | `571558e52d5de8fa886f9b4ce7e49a9a86d045b495d732da43ada9c6f36f3656` |

The admitted fixed-station subset preserves the source's per-band duplicate policy, four-character Maidenhead grid exchange, grid multiplier per band, and season-specific point table. January assigns 1/1/2/2/4/4 points across 6 m through 23 cm and 8 points on every represented band at 2.3 GHz and above. June and September assign 1/1/2/2/3/3 and then 4 points on every represented high band. The portable contest band plan mirrors the pinned comparator through 1 mm plus its submillimeter bucket. The independent all-band fixtures therefore expect 102 points × 17 multipliers = 1,734 for January and 56 × 17 = 952 for June and September.

There is one explicit correction relative to the pinned executable comparator. Each plugin tests for the literal database band `2300+`, while the shared pinned `get_logged_band` returns individual canonical numeric values such as `2300.0`, `3300.0`, and `10000.0`. The resulting Python path awards zero points at 2.3 GHz and above despite the plugin comments and published rules. The fixture records both executable and corrected tables; the preview deliberately implements the published 8-point January and 4-point June/September branches rather than reproducing that defect.

The source-shaped operator archive preserves the Python field order and its minimum-width frequency behavior: frequency, mode, UTC date/time, station call, sent grid, contacted call, received grid. The reusable export-column extension is optional and encoded only when requested, so existing canonical declarative bytes and digests remain unchanged.

This is deliberately not a full ARRL VHF port. Digital modes and their `DG` Cabrillo mapping, schedules, categories, power constraints, and rover changing-grid operation remain separate gates. The official rule adds one rover multiplier for every grid from which a contact was completed and allows the same rover call once per band from each rover grid. The current immutable session does not contain an entry category or an activated-grid collection, so the preview remains fixed-station-only and never infers rover status from `/R`. The archive output is practice evidence and is not certified for sponsor submission. The normal-log `XLogCore.BandPlan` also remains narrower than this portable contest plan; worker/UI activation must reconcile that band authority before radio-derived microwave drafts can be admitted.

The fixture at `Tests/XContestCoreTests/SourceFixtures/arrl-vhf-source-oracles.json` is source-derived independently of the Swift scorer. It pins all three source files, their point tables, expected scalar scores, shared duplicate/multiplier semantics, and the explicit preview differences. Tests cover every currently represented VHF/UHF band, same-call cross-band credit, same-band duplicates, invalid grids, correction, deletion, canonical definition reopen, and exact CW/phone archive lines.
