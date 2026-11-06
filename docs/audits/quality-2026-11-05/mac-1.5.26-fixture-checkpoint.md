# Mac 1.5.26 fixture checkpoint — stopped before GUI

**Candidate HELD; quality OPEN.** The [signed build](signed-mac-1.5.26.md)
passed, but the first disposable fixture setup failed its exact worker identity
check before any health/workspace RPC or GUI launch. The original owned setup
worker accepted normal EOF, exited zero, and had no scoped survivors. No signal
was sent. The retained generated input has 100,000 rows and its original all-12-column hash.

A separate read-only observation demonstrated that macOS `ps` truncates a
nonfinal `comm` field even with `-ww`; a separate final-field query returns the
full executable. The failed worker's exact observed row was not retained, so
it cannot be reconstructed retrospectively. Preserve that failure and correct
the adapter in a new exclusive directory: query full executable/arguments
separately, bracket native PID/birth/UID/path identity, retain mismatch evidence,
and keep all isolation checks. Review/re-pin the new tooling before creating a
new fixture. No unchanged retry or GUI fallback is authorized by this result.

The user requested a temporary stop to change reasoning effort. No desktop
interval began and no new memory/CPU result exists. On continuation, inspect the
exact-source full Mac run, finish adapter verification, and attempt the normal
Desk interval only after fresh fixture/process proof. [Numeric evidence](mac-1.5.26-fixture-checkpoint.json)
retains failure/cleanup hashes without private paths or process identifiers.
