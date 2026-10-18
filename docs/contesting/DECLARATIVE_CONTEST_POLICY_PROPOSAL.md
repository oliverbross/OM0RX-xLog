# Declarative contest policy proposal

The scalable route is one shared `ContestRule` implementation backed by versioned definitions. It should reuse `ContestRuleMetadata`, `ContestEntryDescriptor`, existing exchange normalizers, transaction/serial handling, duplicate storage, Cabrillo/ADIF services and the worker lane. The Python inventory supplies migration evidence; it is not the runtime engine and should not become a Python-to-Swift transpiler.

## Minimal definition

A definition needs immutable identity (`id`, version, edition and canonical SHA-256 digest), display/Cabrillo metadata, modes and bands, the existing entry descriptor, separate provenance records, bounded policies, explicit unresolved constraints and optional golden scenarios. Sessions bind the full definition identity and digest. Editing a definition creates a new version; existing logs continue with their original bytes and policy identity.

Provenance must distinguish official rules, the pinned Python comparator, operator-authored input and test fixtures. Source agreement does not substitute for official authority. Draft validation reports missing or ambiguous exchange, eligibility, points, multipliers, duplicate scope, serial scope, categories, time limits and export details. It cannot activate a definition.

The first bounded policy vocabulary should cover:

- Exchange: existing `ContestExchangeDescriptor` field kinds and normalizers, token sequence, sent defaults and station fields.
- Eligibility: a finite set of named predicates over station/entity/mode/band/category facts.
- Duplicates: once per contest, per band, per band/mode, or disabled.
- Points: fixed values or ordered clauses composed from registered predicates such as duplicate, validated exchange, entity relationship, member status and band group.
- Multipliers: none or unique registered keys by field, entity prefix, country or zone with contest/band/mode scope.
- Serial: existing none, sequential and station-resolved policies and scopes.
- Score: existing points-only or points-times-multipliers policy.
- Export: existing Cabrillo/ADIF projections and formatter versions.

This vocabulary should be Swift enums and typed parameters, not a general expression interpreter. When a rule cannot be represented, the definition names a versioned, registered adapter. Missing adapters fail closed as unsupported. Recurrent adapters should be promoted to reusable bounded policies only after review and differential evidence.

## Pilot and migration

Start with one source-derived 10-10 family definition and four mode/season variants after official rules are pinned. Run it through the existing common store/session/export stack. Compare a stubbed, in-memory Python host with the Swift policy for exchange validation, member `0`, positive member number, duplicates, edits, recalculation and exports. The stub must have no RF, filesystem or network effects. Add independent official-rule fixtures before activation.

Keep the 16 accepted family implementations as regression references. Migrate each family only when the shared definition produces identical accepted behavior plus any recorded official correction. No large CQ WPX shadow migration is required before the small pilot, but existing family tests remain mandatory regressions whenever shared engine code changes.

### Implementation sequence after the first pilot

The executable core/store pilot is accepted at `25a2504` and integrated at `90648fd`: four inactive 10-10 definitions share one implementation, including an independently authored definition test. This proves source-inspected scoring expectations and local core/store behavior; the Python differential harness, exports and operator activation remain open. The next storage slice persists canonical definition bytes atomically with session creation and reloads them without requiring a caller-supplied Swift rule. A new definition version must not alter an existing session.

**Current execution order, 18 October:** canonical definition persistence, shared unique-call multipliers and generalized archive exports are accepted and composed with main 1.2.21 at `cbf8cc1`. Seven definitions exist internally (four 10-10 and CWT/CWO/MST). A common worker/catalog/create/open and structured UI path is under implementation to make them usable before growing another inactive cohort. Client admission must validate a versioned finite descriptor/policy contract and exact immutable definition identity rather than require new per-contest control-flow branches. Existing sessions and committed create replays must continue resolving their stored bytes after a definition update. Then run independent fixtures for each definition and representative browser-to-worker creation/logging/restart/export rehearsals. Archive output remains explicitly distinct from sponsor submission readiness, and unresolved sponsor constraints must be visible in each definition's disposition. This sequence advances the usable port and the future Create Contest workflow together.

The next reusable scoring extension is a mixed geographic multiplier key with explicit band scope and eligibility. Unique-call multipliers and structured archive projections already exist. Initial candidate cohorts below were inspected against the clean pinned Python source `7c8b499225a73f7f8f792246881bd7aefc05452f`; they are prioritization evidence, not implemented parity.

| Candidate cohort | Shared source behavior | Particulars to preserve before activation |
| --- | --- | --- |
| CWT, CW Open, ICWC MST | One point per nonduplicate contact, unique callsign multiplier, points times multipliers | Exchange layouts differ; CW Open and MST allocate serials. Pin each event's rules, sessions, bands and exchange expectations independently. |
| K1USN SST, Phone Weekly Test | Name/location exchange and section-by-band multiplier queries | Phone Weekly Test adds a North America contact condition. The source's DX exclusions must be checked against each sponsor's rules; these definitions must not be assumed equivalent. |

These cohorts extend the shared policy vocabulary rather than adding new per-contest Swift classes. Source defects need explicit dispositions: for example, the pinned CW Open one-token exchange branch calls `isalpha()` on a list, so a parser must not blindly translate that branch into accepted application behavior. A malformed exchange should produce a tested validation result. All cohort activation still requires independently expected scoring, edits/duplicates, exports, and representative operator workflows.

### SST / Phone Weekly Test pre-implementation review, 18 October 2026

The clean pinned source was reverified at `7c8b499225a73f7f8f792246881bd7aefc05452f`. Both plugins call `fetch_section_band_count_nodx`; its SQL in `not1mm/lib/database.py:724` counts distinct section/band pairs while excluding every `DX` exchange. That is a substantive SST source defect, not a reusable multiplier specification. The [current sponsor rules linked from K1USN](https://www.k1usn.com/sst_rules.html) require state/province and DXCC multipliers, exclude lower-48 USA and Canada from country credit, and treat Alaska and Hawaii as DX. DX stations exchange `DX`, not a country prefix. A straight transfer of the source SQL would therefore omit valid DXCC multipliers. Keep source-comparison fixtures and sponsor-correction fixtures separate, with explicit expected differences.

**Band scope resolved in follow-up visual review, 18 October:** root inspected the rendered sample image in the sponsor-linked [published rules](https://docs.google.com/document/d/e/2PACX-1vTFtjDXVkS_wGX2XmBV4P8VyT40iSx_NJcx-m2C9Gb9ANJiCMwNeZdpqk_P8DMNJ2OvIGHydv5e36lQ/pub?embedded=true). Massachusetts and Germany earn multiplier credit again on a new band; repeated Massachusetts on the same band does not. The example awards 12 QSO points, seven state/province and three DX multipliers, yielding 120. An independent fixture should use different synthetic calls with the following geography pattern:

| Band | Four received locations/entities | New multipliers |
| --- | --- | --- |
| 80m | MA, MD, ON, Germany/DX | 4 |
| 40m | GA, MA, MA from another call, IL | 3 |
| 20m | MA, Germany/DX, France/DX, MA from another call | 3 |

Use distinct calls for same-band repeated locations and repeat selected calls on different bands to prove the independent duplicate scope. The corrected expectation is 12 × 10 = 120; the source section-only query would yield seven multipliers and 84. This is reviewed fixture input, not executed implementation evidence. Add separate Alaska/Hawaii, lower-48/Canada exclusion, missing-geography, correction and deletion cases before activation.

Phone Weekly Test's pinned point function awards one point when either station is in North America; it uses the same section-only multiplier query. Its linked sponsor PDF at `https://www.perluma.com/Phone_Fray_Contest_Rules.pdf` returned gateway/timeout errors during this review. Do not infer its geography or multiplier exceptions from SST. This is a concrete next-family review input; neither definition is implemented or activated by this checkpoint.

Testing scales at three levels:

1. Test the common engine once with unit, property and transaction/restart scenarios for each policy primitive.
2. Run parameterized definition fixtures for all 94 plugins, with independently expected score, duplicate, multiplier and export examples per definition. Correct contest data still requires proof; parameterization removes copied harness code, not evidence.
3. Keep representative Run/S&P operator flows per policy family and explicit flows for exceptional adapters, digital/VHF/EDI behavior and unusual exports.

## Create Contest extension point

A future Create Contest wizard can accept pasted official rules or a URL, produce a draft structured definition, and walk the operator through exchange, eligibility, scoring, multipliers, duplicates, serials, categories, time limits and exports. A sample-log simulator runs the optional goldens before save. The runtime has no LLM or network dependency: assisted parsing produces a reviewable draft, and only stored, validated definition bytes run. Common policies require no Swift editing. An unusual rule remains explicitly unsupported until a reusable policy or reviewed adapter exists; the wizard never silently approximates it.
