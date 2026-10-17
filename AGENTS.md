# Repository Workflow

- Treat this `main` checkout as the canonical OM0RX-xLog source. The recovered canonical baseline is `main` at `347beee`; the corresponding application code build is `ef9861e` (`347beee` adds release-acceptance documentation only).
- Before starting work, fetch/pull `main` with fast-forward-only semantics and verify the checkout is clean. If it is not clean, preserve and identify unrelated user changes; never reset, overwrite, or absorb them into the task.
- Keep each commit to one logical change. Run tests proportional to the affected behavior before committing.
- Push every completed commit to GitHub immediately. Do not leave finished commits only on a local branch.
- Never bump a version without recording the exact source commit and build provenance used for the release.
- Package or install OM0RX-xLog only from this canonical checkout, never from another worktree.
- Remove or archive temporary worktrees and artifacts only after confirming that they contain no unique work.
- See `docs/DEVELOPMENT_WORKFLOW.md` for the operational checklist.
