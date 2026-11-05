# Separate Linux runtime-only 1.5.18 recheck — PASS

[Run 42000560531](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42000560531) used QA/workflow checkout `be96ec25c245ff51810ffbd6a5f7f6d3ddf274dc` and consumed unchanged Linux artifact 13398058668 from [original run 41987734820](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41987734820), without rebuilding. Package version1.5.18/source `0b7c669663841c2e55569b0c21c76ad03805cad7` remains exact. QA commit synchronized the strict catalogue expectation with 98 and retained actual replies before validation; application/package inputs did not change.

| Job | Conclusion |
|---|---|
| Linux runtime-only container acceptance127154399848 | SUCCESS |
| prototype127154400728 | SKIPPED |
| Windows runtime acceptance127154401947 | SKIPPED |

Receipts prove 4 embedded native WebKit UI launches: 3 X11/Xvfb and 1 Wayland via Weston nested X11/pixman; 3 installed-DEB launches and 1 relocated-archive launch. All 4 UI reports passed 36 checks. Installed and relocated workers passed 2 framing cases and bundled contest save/read/reopen/cleanup with exact catalogue_count 98. Package checksums/loader audits passed. Coverage uses a synthetic container desktop.

Actual runtime: Ubuntu 24.04.5 LTS; uid/gid 10001 (acceptance); WebKitGTK/JavaScriptCore 2.52.6-0ubuntu0.24.04.1; GTK 3.24.41-4ubuntu1.3; Weston 13.0.0 (package 13.0.0-4build3). Toolchain-absence guard passed; Docker network disabled/all capabilities dropped. X11 and nested Wayland screenshots were inspected and show the rendered app; the isolated fixture displays a Native automatic rotor status unavailable banner. All 4 onboarding receipts explicitly skip radio and rotator. Hardware, accounts, station I/O, Windows installer scopes, default paths, UAC and consumer-desktop acceptance remain untested.

Acceptance artifact 13402142981:824748bytes, ZIP SHA-256 `ebd88a7677821ad3035202d458060be0ad119aa50ac291640d838fb104b5d960`, verified against GitHub digest. All 33 emitted files plus full raw job log are preserved privately with hashes in [ci-1.5.18-linux-runtime.json](ci-1.5.18-linux-runtime.json). Original package artifact ZIP SHA-256 `e19dbc9b4c5f86387a135b5592bc7603be42d432c348ae11075f8b70b548af4f`; DEB `a49d9210951f55bc5f830888f69c3b0530a4f5b1b276230d44519ec6fdbe1b27`; tar.gz `b76b68eaec34999385da69a9bd23d7c96330bdda4d75c7b7dfd803fc11892deb`.

The original canonical run 41987734820 remains **FAILED**, with its native runtime jobs **SKIPPED**. First independent Linux check41999011743 remains **FAILED** at the stale 97assertion; this successful correction does not rewrite either result. QA ordinaryCI42000528091 passed. Redundant Mac push-validation42000528224 was explicitly cancelled and is not a pass.
