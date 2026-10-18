# SST geographic multiplier contract

Status: source-backed inactive declarative definition and independent fixtures for review. This change does not activate SST, change the catalog, or establish worker, UI, export, RF, packaged-app, or sponsor-submission acceptance.

## Official rule

The primary authority is the [K1USN SST rules page](https://www.k1usn.com/sst_rules.html) and its embedded [published rules document](https://docs.google.com/document/d/e/2PACX-1vTFtjDXVkS_wGX2XmBV4P8VyT40iSx_NJcx-m2C9Gb9ANJiCMwNeZdpqk_P8DMNJ2OvIGHydv5e36lQ/pub), retrieved 18 October 2026. Byte counts and SHA-256 digests for the wrapper, published document, and embedded sample image are frozen in `Tests/XContestCoreTests/SourceFixtures/sst-geography-authority.json`.

The sponsor's [SST page](https://www.k1usn.com/sst) links its [FAQ](https://www.k1usn.com/sst_faq.html) and the sponsor-developed [K1USNSST UDC page](https://n1mmwp.hamdocs.com/mmfiles/k1usnsst-udc/). The UDC changelog says v1.1.4 added DC as a multiplier. The FAQ's embedded Canadian logger table contains 14 multiplier tokens: `AB BC LB MB NB NF NS NT NU ON PE QC SK YT`. This is a sponsor logger-token list, not a count of Canada's political provinces and territories or a general Canadian identity model. It labels `LB` as Labrador (VO2) and `NF` as Newfoundland and Labrador (VO1/VO2), so `LB` remains distinct only under this versioned table policy. The adjacent FAQ text says Newfoundland operators and call history use `NL`, but N1MM requires changing it to `NF` because `NL` is absent from that table. xLog retains the heard `NL` exchange and canonicalizes only its scoring key to `NF`; exports and history remain unchanged. Exact URLs, cached paths, byte counts, hashes, and the adjacent source text are frozen in `Tests/XContestCoreTests/SourceFixtures/sst-definition-authority.json`.

Each accepted nonduplicate contact is one point. A callsign may be worked once per band. The exchange is name plus a state abbreviation for a lower-48 U.S. station, a province abbreviation for a Canadian station, or the literal `DX` for every other station. Multipliers are also per band. Lower-48 U.S. and Canadian contacts contribute only their state or province; every other entity contributes its DXCC entity. The rules explicitly classify Alaska/KL7 and Hawaii/KH6 as DX.

The official sample establishes the scope without inference. MA counts independently on 80, 40, and 20 metres. A second MA contact on 40 or 20 metres adds a point but no new multiplier. Germany/DL counts independently on 80 and 20 metres. Its 12 contacts yield seven state/province multipliers and three DXCC multipliers, so the claimed score is `12 * (7 + 3) = 120`.

## Pinned Python comparison and explicit divergence

The read-only comparator is Oliver Bross's `contest-sw` checkout pinned at `7c8b499225a73f7f8f792246881bd7aefc05452f`. `not1mm/plugins/k1usn_sst.py` has SHA-256 `73cf9b72f53c6bd65d1f804f28b4ea80f6bf82d2b8b08406b2153691fd1d8120`; `not1mm/lib/database.py` has SHA-256 `855840a01e80e82fc5d7e83c1e7e9f0f367e6db9be504944e0db0173e28e52e8`.

`show_mults` calls `fetch_section_band_count_nodx`. The pinned SQL counts distinct `Sect:Band` values only where `Sect != 'DX'`. The plugin stores the SST location token in `Sect`, while the official exchange requires every DX station to send `DX`. The source therefore omits every DXCC multiplier. Applied to the official sample, its visible arithmetic is seven multipliers and `12 * 7 = 84`, rather than the official ten multipliers and 120.

This is a recorded source defect, not a rule interpretation. A future corrected SST implementation must follow the official result and must report that it intentionally diverges from the pinned Python scoring behavior. It must not claim exact Python parity.

The bounded comparison command parses only exact-hash sources, admits only reviewed AST calls, and never imports either upstream module. It creates an in-memory SQLite database, inserts the 12 official sample rows plus two guard rows, derives the 12 points from the fixture row count, and executes the exact inspected no-DX SQL. The official duplicate MA rows exercise `DISTINCT`; a same-contest `DX` guard and a foreign-contest non-DX guard prove that weakening either predicate changes the result. The exact query derives seven multipliers and 84, while removing the DX or contest filter produces ten or eight respectively. Those changed-query control counts deliberately include guard rows and are not sponsor multiplier totals:

```sh
export CONTEST_SW_ROOT=/path/to/contest-sw
/opt/homebrew/bin/python3.14 tools/contest_plugin_generator/compare_sst_geography.py \
  --source-root "$CONTEST_SW_ROOT"
```

The focused source-backed unit suite has five tests. Its exact-source case requires `CONTEST_SW_ROOT` and fails with an explicit configuration message when the pinned checkout is not supplied; it is never silently counted as a passing skip.

## Reusable typed vocabulary

The shared implementation is a `geographicMultiplier` with two variants:

- `administrativeSubdivision(authority, canonicalValue)` for a sponsor-defined subdivision scheme.
- `dxccEntity(authority, adifEntityCode)` for a versioned DXCC entity reference.

Its scope is band. The logical canonical identity includes `kind`, `authority`, the pinned `referenceDataVersion`, the resolved `entityADIF`, the canonical subdivision value when applicable, and `band`. In the runtime `ContestMultiplierKey`, `kind` and `band` remain typed fields while `value` serializes the remaining components with consecutive UTF-8 byte-length prefixes. This prevents collisions between entities that share an authority and token and remains unambiguous when a pinned reference version contains punctuation or non-ASCII metadata. The `expectedNewMultipliers` strings in the fixture are readable semantic labels for review, not serialized runtime key values. SST would use `sst-us-lower48-state`, `sst-canadian-province`, and `dxcc-entity` authorities. Exactly one variant may apply to an accepted contact.

Classification consumes the immutable resolved entity snapshot, the canonical typed location field, and a versioned sponsor policy. A callsign prefix or the literal `DX` is not entity authority. Name is required exchange evidence but never part of a multiplier key. Correction and deletion replay derives keys again from the retained accepted contacts so no stale multiplier survives.

Subdivision policies may define a bounded one-step alias map. Alias keys cannot replace canonical values, targets must be canonical values in the same policy, and chains and cycles are rejected. Empty alias maps are omitted from canonical encoding so existing definition digests remain unchanged.

Blocking unresolved or contradictory geography is an xLog validation design choice, not an official SST scoring rule. The sponsor says each QSO earns one point. Under the proposed xLog policy, an invalid draft cannot commit, never becomes a QSO, and therefore earns no point or multiplier and occupies no duplicate key. Once accepted, a contact retains its immutable entity snapshot and reference-data version; later reference drift cannot silently remove or reclassify it. Replay scores that pinned snapshot. Corrupt retained data must surface a session validation failure and require correction rather than being silently converted into a zero-point QSO.

This vocabulary is intentionally broader than SST while keeping contest membership policy separate. NAQP semantics cannot be copied: NAQP admits a distinct set of North American territories, while SST classifies every entity outside the lower 48 U.S. states and Canada as DXCC, including Alaska and Hawaii.

## Independent fixture coverage

`Tests/XContestCoreTests/SourceFixtures/sst-geography-authority.json` freezes the official sample plus independent cases for:

- Alaska and Hawaii as DXCC entities, including repeat-entity and new-band behavior;
- an unresolved-geography draft being blocked before commit under the proposed xLog validation policy;
- two calls in one DXCC entity on one band versus the same entity on another band;
- deterministic correction and deletion replay;
- typed name/aggregate disagreement, lower-48 `DX`, and Alaska `AK` drafts being blocked before commit.

`Tests/XContestCoreTests/SourceFixtures/sst-definition-authority.json` additionally freezes the complete 49-token lower-48-plus-DC policy, the sponsor table's 14 Canadian tokens, and the `NL` to `NF` scoring alias. `SSTDeclarativeDefinition` uses those policies without a contest-specific rule class and remains absent from the built-in catalog.

Before any later activation, review must pin the DXCC entity reference version and validate the station-side sent location against the station entity and the same versioned SST geography policy. The inactive draft currently freezes sent fields but sets `stationEntityRequired` to false, so it does not claim station-side geography validation. Mobile and portable endpoint resolution, operator composition and persistence, category, schedule, and reporting behavior remain separate gates. Although the sponsor accepts only a 3830 score summary and requires no formal log submission, an unsupported operator archive export must still be added for source-product parity; that archive must not be presented as a sponsor submission format.
