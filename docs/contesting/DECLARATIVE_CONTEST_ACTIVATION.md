# Declarative contest runtime activation

This slice exposes the four reviewed 10-10 archive definitions plus CWT, CW
Open and ICWC MST through the normal contest catalog, create, reopen, logging,
correction and export path. All seven use `DeclarativeContestRule`; there is no
contest-specific Swift rule or client branch.

The catalog publishes the exact definition identity and SHA-256 digest. Create
requires that pair. A newly created session persists the canonical definition
bytes atomically with the session. Reopen, scoring, correction and export decode
those persisted bytes and verify their identity and digest instead of selecting
the current catalog version. A committed create can therefore be replayed after
the catalog removes or advances that definition, while a genuinely new create
still requires a currently admitted definition. Duplicate catalog identities
are rejected during lane construction.

The browser builds the create and entry forms from the shared field descriptors,
supported bands, supported modes and serial policy. Full-QSO reads and correction
results are validated against the immutable session descriptor. The legacy wire
field named `allocatedSerial` remains the full normalized sent aggregate for
compatibility; a true declarative serial is validated in its structured exchange
field. Operator-archive exports carry that purpose through the worker and client,
and the UI labels them as archives rather than sponsor submissions.

## Compatibility and limits

- The existing 16 static rules retain registry resolution and their prior create,
  serial, correction and export contracts.
- Existing canonical bytes and digests for all seven definitions are unchanged.
- The seven definitions are usable for logging, restart, scoring, correction and
  operator-archive export. `submissionReady` remains false.
- Event windows, categories, sponsor-specific submission/adjudication, CW Open
  combined-session scoring and retained duplicate submission semantics remain
  outside this activation. ICWC MST power and running-frequency constraints and
  10-10 mobile/edition conflicts also remain explicit limits.
- No pasted-rules wizard, runtime AI, Python execution, expression evaluator or
  arbitrary definition loader is added. Future authored definitions can use the
  same admission contract once their review and creation UI exist.

## Verification

The activation lifecycle test parameterizes all seven definitions through
catalog, digest-bound creation, two contacts, duplicate handling, restart,
full-QSO read, correction and both archive formats. The actual worker response
is checked for descriptor-exact structured maps and the legacy aggregate alias.
The retained Ten-Ten case commits in AM under an SSB-primary definition and
round-trips a 74-byte received aggregate through worker QSO read and correction.
That correction reduces the values to the archive projection's narrower column
widths before Cabrillo and ADIF export; the evidence does not claim that the
74-byte value itself is exportable or truncated.
Separate tests cover catalog removal and committed replay, missing fields and
digest rejection, duplicate catalog identities, structured serial edits through
reserved/transmitted/uncertain states, and existing ARRL RTTY/JIDX/ARRL DX
structured behavior.

The focused contest frontend suite covers descriptor-driven creation and entry, supported mode
and band selection, archive labeling, and real-shaped 10-10/CWT/CW Open/MST
read-correct-delete records. The retained evidence manifest records exact
commands, raw log hashes and the frozen source hashes.
