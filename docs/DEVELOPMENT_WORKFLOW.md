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

## Native menu/dialog and draft checks

Use the existing marked disposable native route for keyboard acceptance, with the exact bundle path, canonical private temporary root, unique WebKit identity and disabled external I/O verified before input. Do not substitute a production app or widen a station/provider guard to make a test pass.

**Failed isolated launch = procedural stop, before any GUI binding.** Validate fixture enums against the owning source before launch (`normal_logging` / `contesting` for the operating module). Launch the exact executable explicitly with `--offline-contest-acceptance=<canonical-private-root>`. Then use process-only inspection to verify the exact live launch PID, executable and full private-root arguments for both application and worker. Do this before any GUI/AX/path-binding observation, even one intended only to check startup. If the launch exits, panics, has a missing/mismatched coordinate or cannot be positively identified, retain the failure and stop that UI sequence. Never use a path binding to check whether it is running: it can silently relaunch the candidate without isolation arguments. Correcting the fixture requires a separate deliberate isolated launch and fresh verification, never a production fallback. This closes the [1.3.59 pre-install incident](reviews/CODE_REVIEW_INTEGRATION_ACCEPTANCE_2026-10-28.md#pre-install-incident-accounting--closed-28-october-2026).

Before entering any disposable text, verify the initial main window actually uses the marked WebKit store (not just the worker root); its offline title must include the marker UUID. Retain a foreign-workspace journal without applying/discarding it. If supported recovery would replace that journal, preserve the guard and use a fresh positively isolated fixture. Never patch a retained signed bundle to fix isolation.

1. Read the current full accessibility state. Verify the exact window, menu/dialog and intended control; extract indices from that observation. A prior index is invalid after another observation, even if its number still exists.
2. For a native menu, use its exposed `Cancel` secondary action. For a dialog, use its observed Close/Cancel control. Verify the resulting window and preserved draft. Empty filtered output, a stale menu tree or an unavailable screenshot is uncertainty, not permission to send Escape or click an estimated location.
3. Never retry blind Escape for dismissal. Deliberate Escape from a verified operator entry remains an applicable shortcut/Stop test; keep it separate from dismissal. Preserve emergency output stopping, confirmed release and uncertain-release restrictions.
4. Compare complete draft identity/content and contact-mutation receipts before/after dismissal. Test deliberate Clear/Wipe separately in disposable storage; it must remain available without adding blanket confirmations. Use fake output for Stop tests.
5. After any Quit request, stop using that app binding. Source `prototype/scripts/macos-app-process.sh` and call `verify_macos_app_stopped '/exact/candidate.app/Contents/MacOS/xlog-prototype'`. This process-only check never launches or signals an app, fails closed if process inventory fails, and reports a still-running process as an unresolved Quit/guard. Never query AX state, screenshots, or an old binding to determine whether it exited. If process-only evidence positively confirms the same original PID is still alive, its surviving unsaved-work guard may be inspected and acknowledged; do not force-quit or bypass it. If absent or uncertain, do not query that binding. Reopening is a separate deliberate launch of the exact intended candidate path with its verified disposable launch coordinates. Preserve failed/partial evidence and any unsaved-work guard.

The [Wave 4 follow-up](planning/WAVE4_CONNECTED_OPERATION_ACCEPTANCE_2026-10-27.md#draft-protection-follow-up--27-october-2026) records the historical attribution gap and bounded native/source evidence. A matching timestamp does not establish an initiating key, a double-handled event or a command's physical cause.

## Releases and cleanup

- A version change must record the exact source commit and reproducible build provenance. A displayed version alone is not proof of source identity.
- Build, package, sign, or install only from this canonical checkout. Noncanonical worktrees are for isolated investigation or development, not distribution.
- Before deleting or archiving a worktree, build directory, or temporary artifact, compare it with canonical history and confirm it contains no unique source, evidence, or unpushed commit.
