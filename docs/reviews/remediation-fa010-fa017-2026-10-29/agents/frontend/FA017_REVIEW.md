# FA-017 frontend implementation evidence

Production edits are ready for root review; no FA-014 changes were made. Root owns the backend safety fix, Git commit/push, preserved-dist build and final integrated acceptance.

The workspace retains fldigi release-required/uncertain and nullable configuration_error independently of WSJT-X reads. Explicit Stop consumes the actual returned snapshot. Stop and Escape continue to target retained fldigi ownership across disabled transmit, SSB without configured voice and dual operating lanes. Pending/uncertain release blocks new macro claims, lane TX requests and output; ordinary owned duty with transmit still enabled remains usable. A confirmed RX release with a settings error remains confirmed, with the separate settings failure visible.

The detached setup owner publishes fresh digital evidence before completing its receipt, including rejected settings saves. Both dialogs retain uncertainty and their release-only retry. Optional TS/Rust operator.fldigi schemas preserve legacy operators and enforce exact fields, booleans, bounded status/error strings and nullable errors. Uncertain detached Escape is enabled only for retained fldigi release duty.

## Executed checks

All commands used cwd `/Users/oliver/Documents/Projects/OM0RX-xLog/prototype`. Common-runner commands and exact argv, UTC, exits, source diff SHA and log SHA are copied into `checks/`.

- Before source fix: `npm run test:vitest -- src/contesting/Not1MMContestWorkspace.test.tsx -t 'retains fldigi Stop recovery'` exited 1: two failed requirements, 195 selector-skipped old tests. Original tool output is preserved verbatim with SHA in `fa017-evidence.json`. This run preceded the common runner; it has no fabricated UTC/diff receipt, and the maintained test was subsequently extended.
- `fa017-frontend-complete-r2`: `npm run test:vitest -- src/contesting/Not1MMContestWorkspace.test.tsx src/contesting/DetachedContestDigitalDialog.test.tsx src/contesting/DetachedContestSurface.test.tsx src/contesting/contestSurfaceProtocol.test.ts src/contesting/DetachedContestSetupDialog.test.tsx` exited 0, **519 passed / 5 files**. This predates the final retained-owner/WSJT-X-independent updates within Not1MM.
- `fa017-retained-owner-r1`: `npm run test:vitest -- src/contesting/Not1MMContestWorkspace.test.tsx -t 'retains fldigi Stop recovery'` exited 0, **5 passed / 195 selector skips**. Covers both release/storage failures, confirmed-Off control, pending RPC, fulfilled pending-final duty, release-only retry, context changes and fresh fldigi readback after WSJT-X failure.
- `fa017-typecheck-r4`: `npm exec tsc -- --noEmit` exited 0 after retained-owner edits. The subsequent final production change only rejects malformed optional fldigi fields; root's build runs full TypeScript again.
- `fa017-not1mm-complete-r3`: `npm run test:vitest -- src/contesting/Not1MMContestWorkspace.test.tsx` exited 0, **200 passed**, on final frontend production edits. Existing unawaited-act fixture warning remains; assertions/timeouts were not weakened.
- Root's subsequent review added the retained-fldigi condition to detached SSB status visibility; its release-only test now covers both RTTY and SSB without voice output. `fa017-detached-complete-r1` runs that whole file and exits 0; `fa017-typecheck-r5` exits 0. Both receipts bind final diff SHA `55345f9014eeb6a68c3a51c10dd9df1ef07e9e5a3c8170337b6ccd66a8239957`. This narrow change is later than the root's earlier preserved-dist build; final integrated build acceptance remains root-owned.
- `git diff --check` exited 0. Root separately ran the added Rust validator regression among its focused schema tests; its receipt remains root-owned.

Counts overlap and must not be summed as unique tests. Initial setup/typecheck failures and intermediate revisions remain in the copied receipts.

## Boundaries

These are real React owner/dialog/schema tests with bounded native/backend fakes, not real native GUI, engine/provider, physical fldigi or RF validation. No production data, GUI/provider/hardware, packaging, installation, version bump, Git mutation, npm install or direct dist mutation was performed by this worker.

On a cold WSJT-X snapshot failure there is no known WSJT-X configuration to publish into Digital Setup. That dialog remains unavailable rather than inventing a configuration. Independently retained fldigi state keeps main/operator Stop and Escape available; the dialog's cold-WSJT-X acceptance is a narrow remaining UX boundary. Ordinary known-WSJT-X snapshot failure preserves fresh fldigi evidence in its existing setup snapshot and is covered.

No new passive cleanup or unconditional lifecycle RX was added. Existing practice, context/draft/generation and pending-final-release semantics remain in the owner/backend paths.
