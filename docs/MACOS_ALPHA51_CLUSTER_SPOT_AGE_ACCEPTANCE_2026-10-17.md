# macOS alpha.51 cluster spot-age acceptance — 2026-10-17

## Scope

- Replaced clock times in both cluster tables with a live `For` age.
- Preserved the internal `time` column key so existing visibility, ordering and width preferences remain valid.
- Refreshes displayed ages every 10 seconds even when no new cluster spot arrives.

## Source

- Release: `0.4.0-alpha.51`
- Implementation commit: `e3b7db6` (`Show live spot age in cluster tables`)

## Focused verification

- `spotAge.test.ts`, `OperatorWorkspace.test.tsx`, and `ClusterPanel.test.tsx`: 31/31 passed.
- The component test advances time and confirms the rendered value changes from `Now` to `1 min` without a new spot.
- Signed macOS package build completed successfully, including TypeScript, Vite, detached-window bundle, Rust, worker, and signature checks.
- Packaged acceptance: 33/33 passed (`integrated-local-ui`, embedded UI and worker present, station I/O intentionally excluded).
- `codesign --verify --deep --strict` passed for the packaged and installed app.

## Installed runtime proof

- Installed `/Applications/OM0RX-xLog.app` reports `0.4.0-alpha.51`.
- The live detached DX Cluster window displayed the `For` header with `Now`, `1 min`, and `2 min` rows.
- The live Operator Desk cluster displayed the same `For` header and matching relative ages.
- Main executable SHA-256: `e648ab850f95dc551cad640642d0254b4d81c046b98dd66ac6233d22c76b8a91`
- Worker SHA-256: `da356f6542af34a1814d4529e5ee449a159f5c54dc2aea447f6b989008076c1b`

## Rollback

- Previous installed alpha.50 bundle: `/Users/oliver/Documents/OM0RX-xLog-PreAlpha51-Backup-20261017-0506/OM0RX-xLog.app`
