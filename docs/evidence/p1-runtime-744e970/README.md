# Native prototype evidence — 744e970

Exact package source: `744e97033800df55e62fcaa7a9f467ac45ea3aab`.

- `macos/ui.json`: local ad-hoc development bundle; 14 observed UI checks, final-map 72/72 and detached-monitor 58/58 framebuffer land probes. This is not a notarized new-shell release.
- `linux/`: [native runtime-only run 38208026918](https://github.com/oliverbross/OM0RX-xLog/actions/runs/38208026918), four GUI launches with 14 checks each, final-map 66/66 and monitor 80/80 probes each. Xvfb/Mesa and nested Weston are not physical GPU or native desktop acceptance.
- `windows/`: [fresh native run 38208313414](https://github.com/oliverbross/OM0RX-xLog/actions/runs/38208313414), 11 harness checks and two GUI launches with 14 checks and exit 0 each. Final-map 59/59 and monitor 67/67 probes each. No Swift installation was detected by documented probes. Hosted Windows Server is not consumer Windows desktop acceptance; the 1024×768 capture has a taskbar over its lower edge.

These are copied native reports and selected screenshots, not manually reconstructed results. All data is synthetic. Full module inventories, diagnostics and additional captures are in the Actions artifacts (30-day retention). Paths in reports refer to those isolated test environments.

The full [matrix run 38207678307](https://github.com/oliverbross/OM0RX-xLog/actions/runs/38207678307) also passed all five jobs: three native builds/tests and both fresh-runtime jobs. Package hashes, downloads, preservation and limitations are in the [acceptance ledger](../../P1_RUNTIME_ACCEPTANCE.md).
