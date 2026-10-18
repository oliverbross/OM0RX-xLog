# Simulated operator capability contract

The Run and Search-and-Pounce panel is admitted only by a versioned worker capability. The current `simulated-run-sp-v1` policy is a visible-output simulation: it may reserve a contest serial and commit through the existing contest mutation owner, but it never invokes CW, audio, PTT, radio, cluster, or other station output.

## Reviewed set

Version 1 admits the CW and SSB identities for CQ WW, CQ WPX, Oceania DX, SAC, NAQP, JIDX, and ARRL DX. NAQP RTTY and ARRL RTTY Roundup remain Plain Log profiles. A new rule, a changed rule identity, or a changed entry descriptor is inert until its generated digest is reviewed and shipped in the client.

Each capability digest binds the complete rule identity, complete entry descriptor, capability version, and phase policy. Swift generates the finite identity-to-digest table used by the TypeScript client. A syntactically valid but unknown digest is rejected. The client also rejects a capability whose identity, policy, version, output kind, styles, or macro roles do not match the reviewed contract.

## Authoritative readiness

The worker projects `operatorReadiness` from the same immutable mutation projection returned or replayed by the store. It does not reconstruct readiness from display text or reread a newer draft. Readiness carries the capability digest and separate states for callsign and exchange, plus explicit admission booleans for CQ, call, duplicate, reservation, and commit phases.

Only reviewed structured validation issue codes can be treated as missing input, and only while the corresponding value is actually empty. Unknown issue codes, nonempty invalid values, unresolved duplicate state, mismatched digests, and unrelated validation errors fail closed. Serial allocation remains store-owned and is required wherever the rule descriptor says `requiredForCommit`.

The UI consumes these booleans without matching validation messages. A stale or malformed successful mutation response retains the existing uncertain-outcome handling; it is not treated as operator readiness. Context changes, edits, rule changes, and owner changes still revoke the active simulated sequence through the existing reducer and mutation owner.

## Evidence boundary

Generated worker fixtures exercise the catalog, session, draft, mutation replay, and strict TypeScript parsing paths. Focused worker tests cover serial and nonserial structured exchanges. UI tests cover the finite reviewed set and rejection of changed identities, descriptors, digests, and readiness. This is source and synthetic worker evidence only; it does not certify RF output, native keying, audio, a packaged application, or sponsor submission behavior.

The core capability matrix also drives all 14 reviewed identities through each concrete rule's session validation, descriptor validation, draft validation, duplicate-key evaluation, and readiness projection. It covers blank CQ, call-first incomplete exchange, complete exchange with the rule's reservation policy, and duplicate response. Independent negative cases prove that an unknown received-exchange, callsign, or entity issue code cannot be admitted merely because its field is blank.
