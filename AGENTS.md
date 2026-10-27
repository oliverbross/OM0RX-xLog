# Repository Workflow

- Treat this `main` checkout as the canonical OM0RX-xLog source. The recovered canonical baseline is `main` at `347beee`; the corresponding application code build is `ef9861e` (`347beee` adds release-acceptance documentation only).
- Before starting work, fetch/pull `main` with fast-forward-only semantics and verify the checkout is clean. If it is not clean, preserve and identify unrelated user changes; never reset, overwrite, or absorb them into the task.
- Keep each commit to one logical change. Run tests proportional to the affected behavior before committing.
- Push every completed commit to GitHub immediately. Do not leave finished commits only on a local branch.
- Every packaged or installed application candidate must advance the user-visible software version; never reuse a prior version for a different source candidate. Documentation-only commits do not require a version bump.
- Never bump a version without recording the exact source commit and build provenance used for the release.
- Package or install OM0RX-xLog only from this canonical checkout, never from another worktree.
- Remove or archive temporary worktrees and artifacts only after confirming that they contain no unique work.
- See `docs/DEVELOPMENT_WORKFLOW.md` for the operational checklist.

## Native UI automation

- Bind the exact application path and verify the current window/control before input. Derive accessibility indices from the latest observation; never reuse an index from an earlier tree after another observation.
- Do not send Escape as a blind menu/dialog reset or retry it when dismissal is uncertain. Use the currently observed menu's supported `Cancel` secondary action or the dialog's explicit Close/Cancel control, then verify dismissal and draft preservation. Stop that UI sequence if the control/context cannot be verified.
- Deliberate Escape testing belongs to a verified entry/control in disposable storage. Preserve operator shortcuts and emergency Stop/release behavior; this automation rule does not disable Escape or change operating bindings.
- After ordinary Quit, inspect process state before querying an app binding again: an observation can relaunch the application. Do not force-quit or bypass an unsaved-work guard.
