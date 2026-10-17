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

Testing scales at three levels:

1. Test the common engine once with unit, property and transaction/restart scenarios for each policy primitive.
2. Run parameterized definition fixtures for all 94 plugins, with independently expected score, duplicate, multiplier and export examples per definition. Correct contest data still requires proof; parameterization removes copied harness code, not evidence.
3. Keep representative Run/S&P operator flows per policy family and explicit flows for exceptional adapters, digital/VHF/EDI behavior and unusual exports.

## Create Contest extension point

A future Create Contest wizard can accept pasted official rules or a URL, produce a draft structured definition, and walk the operator through exchange, eligibility, scoring, multipliers, duplicates, serials, categories, time limits and exports. A sample-log simulator runs the optional goldens before save. The runtime has no LLM or network dependency: assisted parsing produces a reviewable draft, and only stored, validated definition bytes run. Common policies require no Swift editing. An unusual rule remains explicitly unsupported until a reusable policy or reviewed adapter exists; the wizard never silently approximates it.
