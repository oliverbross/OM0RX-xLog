# Signed 1.5.26 desktop attempt — foreground gate blocked

**7 November 2026, Darwin. Candidate HELD; quality OPEN.** The isolated generated
100,000-QSO fixture, signed desktop launch, ownership checks and ordinary-quit
preservation completed. The desktop memory/idle interval **failed before
readiness**: the observer reported `Candidate is not the visible foreground application`.
There were **zero interval samples**, no 30-minute memory result and no final
ten-minute CPU result. The failed attempt was not retried or reclassified.

## Exact candidate

Frozen source: [`8acc236c32fb31d58c86c4d673e0ed57fe76fdad`](https://github.com/oliverbross/OM0RX-xLog/commit/8acc236c32fb31d58c86c4d673e0ed57fe76fdad).
The candidate is the retained signed macOS arm64 **1.5.26**, not the daily
installation. [The numeric record](desktop-attempt-1.5.26-2026-11-07.json)
contains artifact pins and 23 hashed evidence references.

| Artifact | SHA-256 |
|---|---|
| ZIP | `0fe181c1efcdc0371875a0d23456b0f050454642f34b24a63f9724e692ee444e` |
| Signed host | `434c24e2c1779fb214a4492978274f29fe74cb064ef1283c98660ba20ffee693` |
| Signed worker | `6a22d720a3874cfff96492f20cb44a3a5be2bcf07c3eed831d821e918044ab88` |
| Embedded build manifest | `6ef32a3ae0ad488557dee373db6c6e9efe4b8eee0b7d420c7b5951bb314e8f99` |

## Completed bounded evidence

- Both setup workers used the private offline root and exited normally on EOF,
  exit 0, with no scoped survivors. Supported setup retained local mode,
  completed onboarding, disabled automatic sync, and blank station/operator/grid.
- Before migration, after migration and after ordinary Quit, the fixture had
  exactly **100,000 physical/live/generated rows**. The ordered, type-tagged hash
  of all 12 stored QSO columns stayed
  `c890ab242dca96dd196217168a1f05dcc299b1ba6a2e877149abbddeaea59af2`.
- Four process-only proofs retained the same five attributed owners: host, Swift
  worker, WebKit GPU, WebContent and Networking. Exact executables/private argv,
  native birth/UID/parent/path, dedicated LaunchServices association and matching
  resource/jetsam coalitions established ownership disjoint from the daily app.
  The daily host/worker and UTM ambient identities stayed stable.
- Coordinator CUA observations in the chat verified the marked normal Operator
  Desk and generated Logbook showing **100,000 contacts**, range **1–100 of
  100,000**, then returned to Desk. No separate screenshot artifact is claimed.
- After a fresh pre-Quit proof, the coordinator requested ordinary Command-Q.
  Bounded process-only absence found no known/scoped owner, no candidate-coalition
  survivor and no unresolved coalition among **471 current-user processes**.
  No signals or force-quit were used.
- Closed WAL-aware backup/analysis preserved all QSO columns and the complete
  Settings payload, including revision **2** and sync-target revision **0**.
  Source main/WAL hashes were bracketed and unchanged; SHM remained lock
  bookkeeping. Closed preservation completed at **23:40:19 UTC on 6 November**.

## Retained failures

The first setup attempt failed at the exact worker argv/parent check before any
worker RPC or GUI launch. Its constructor closed stdin and reaped the worker
normally, exit 0, with no scoped survivor. The original observed row was not
saved. A separate root observation demonstrated macOS `ps` truncation of a
nonfinal `comm` column; this explains a parser defect, not the missing original
row. The new adapter reads complete argv and final COMM separately, preserves
paths containing spaces, brackets positive reads with native identities, and
records mismatches before failure. **Nine mocked checks passed.** A later harness
invocation hit an existing-output `FileExistsError` before running any tests;
it supplies no additional test result. All original evidence remains retained.

The subsequent desktop attempt passed setup and ownership, but raising the
marked window and clicking Logbook/Desk did not establish the observer's required
foreground state. The observer emitted no ready event, exited **2**, and was
observed stopped following bounded EOF cleanup. No performance claim follows
from its pre-readiness counters or from the successful data-preservation checks.

## Next correction and limits

Before a separate new attempt, establish actual OS foreground state
through a verified native application activation action and confirm it with a
read-only one-shot preflight using the **same predicate** as the interval watcher.
The proposed static adapter adds that preflight without changing the watcher,
notifications, heartbeat, ownership rules or deadline. It must be reviewed,
compiled and repinned in a new adapter; it has not run. A passing instantaneous
preflight would not replace the interval's own readiness and continuous checks.

This 100k generated workload is separate from the provisional approximately-70k
budget. Full desktop memory/CPU acceptance, original approximately 7 GB incident
attribution, physical equipment, broader platform acceptance and notarization
remain open. The daily installation and public release were not replaced; UTM
was not controlled for this attempt.
