# Development Workflow

`main` in this checkout is the canonical source of truth. Recovery established `347beee` as the canonical baseline; its executable code is the `ef9861e` build because `347beee` adds only the macOS 1.1 acceptance record.

## Start work

1. Confirm this canonical checkout and `main` are selected.
2. Fetch and update with a fast-forward-only pull.
3. Verify the working tree is clean. If unrelated user work exists, preserve it and resolve ownership before editing; do not discard, overwrite, or silently include it.

## Complete work

1. Make one logical change per commit.
2. Run tests proportional to the change and record any acceptance boundary that was not exercised.
3. Commit only the intended files, then push the completed commit to GitHub immediately.

## Releases and cleanup

- A version change must record the exact source commit and reproducible build provenance. A displayed version alone is not proof of source identity.
- Build, package, sign, or install only from this canonical checkout. Noncanonical worktrees are for isolated investigation or development, not distribution.
- Before deleting or archiving a worktree, build directory, or temporary artifact, compare it with canonical history and confirm it contains no unique source, evidence, or unpushed commit.
