# 10-10 declarative rule pilot

This pilot executes four 10-10 seasonal definitions through one `DeclarativeContestRule`. It does not add those definitions to `ContestLane.activeRules`, change the existing 16 previews, or enable export. The purpose is to prove that a reviewed definition can drive the existing entry descriptor, `ContestEngine`, and `SQLiteContestStore` paths without a contest-specific Swift rule.

## Authority and scope

The frozen authority fixture is `Tests/XContestCoreTests/SourceFixtures/ten-ten-declarative-authority.json`. It records exact hashes and byte counts for the official current rules, handbook, schedule, and October 2025 newsletter, plus exact hashes for the four Python comparator files at upstream revision `7c8b499225a73f7f8f792246881bd7aefc05452f`.

The common semantics proved here are open logging by licensed amateurs, 10 metres, name/member number/QTH exchange, member number `0` for a nonmember, two points for a positive worked member number, one point for zero, one contact with a station for the contest, no multipliers, and points-only scoring. Active membership affects award/submission eligibility and cannot be proven from a positive number, so that gate is deferred to the export/submission phase; a nonmember session remains able to log and score. Phone definitions declare SSB, AM, and FM. The current 2026 schedule lists the phone events but omits the CW events. The Spring and Fall CW definitions are therefore labeled source-compatible and unscheduled; the omission is not treated as proof that the events were discontinued and no event dates are invented.

The handbook describes a mobile different-county repeat exception while the current rules say one contact regardless of mode. This pilot implements the current once-per-contest rule for ordinary stations and explicitly excludes mobile-category activation until that edition conflict, category selection, and QTH scope have a reviewed policy. Date windows and mode sub-band restrictions also remain outside this inactive pilot.

The Python files are compatibility evidence for selected pure `validate`, `points`, dupe, and score behavior. They are never imported or executed. Official sources remain the correctness authority, and an AST shape never establishes semantic equivalence by itself.

## Bounded policy contract

`ContestDefinitionDraft` is the authoring input. It uses existing `ContestEntryDescriptor` fields and admits only named policies: a finite duplicate scope, multiplier `none`, and ordered nonnegative-integer threshold point clauses with an explicit fallback. Unknown enum values fail decoding. Any adapter identifier, incoherent entry descriptor, unsupported scoring policy, or point clause over an unsuitable field fails materialization. There is no general expression evaluator and no fallback to zero points.

Materialization encodes the draft with sorted keys and sorted band/mode sets, hashes those canonical bytes, and binds the digest into `ContestRuleIdentity.sourceRevision`. `ContestDeclarativeDefinition` decoding recomputes and verifies that digest. Any authoring wizard can produce the same draft without Python; it must still present exchange, eligibility, scoring, multipliers, duplicates, serial, category/time, export, provenance, and golden scenarios for review before activation.

## Persistence and activation gate

The store tests prove that the current database retains the exact definition identity across edits and restart. Identity persistence alone is insufficient for user-created rules: a future activation migration must persist the canonical definition bytes alongside the digest and reload that immutable version when a session opens. Editing a definition must create a new version/digest; existing sessions must continue to use their stored bytes. A definition must not enter an active registry until this byte-persistence gate, shared export projection, UI selection, and migration behavior are implemented and reviewed.

Tests parameterize all four definitions through fixed member, nonmember, duplicate, correction, and restart scenarios. New common policies should extend this single engine with unit/property/scenario coverage. Contest families then supply independently expected definition fixtures, while exceptional behavior must declare an unsupported policy or a separately reviewed reusable adapter rather than silently approximate the rules.
