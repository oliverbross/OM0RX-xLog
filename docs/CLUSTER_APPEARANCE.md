# Cluster appearance

In **Settings → Display → Cluster appearance → Spot table style**, choose:

- **Classic · compact** for compact monospace rows, coloured text, and plain scores and tags.
- **Modern · coloured** for the existing row colours, age strips, and badges (the default).

The choice saves automatically and is shared by the normal DX Cluster view,
its detached window, and the cluster table on the Operator Desk. Existing
filters, column choices, spot selection, history, and radio actions remain
available. The Contest Cluster retains its dedicated contest layout.

The preference contains only `modern` or `classic` in local storage under
`xlog.display.cluster-appearance.v1`. Same-window updates, storage events from
other windows, and window focus reload the shared value. Unavailable or invalid
storage defaults to Modern; a failed save retains the current style and offers
a retry message.

## Validation (2026-10-26)

- 79 focused tests passed across cluster appearance, Display settings, Operator
  Workspace, ClusterPanel, detached cluster, and cluster filters; TypeScript passed.
- Browser fixture using the actual components: changing the Settings selector
  updated two other open tabs without reloading. Classic rows measured 22px in
  the full cluster and desk. Modern restored row fills and badges. Both layouts
  fit the viewport without horizontal overflow.
- The broader detached contest suite passed 187 of 188 tests. The log-review
  contact-highlight assertion at `DetachedContestSurface.test.tsx:1081` also
  failed when run alone and was handed to the release coordinator for independent
  baseline verification. This feature does not change that test or its log-review
  implementation.
- Native packaged-window acceptance belongs to the coordinated next release;
  this development worktree was not used to package or install an application.
