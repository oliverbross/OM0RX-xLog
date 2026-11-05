# Canonical 1.5.19 gate — HELD / FAILED

[Run 42008808018](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42008808018) used exact source **72a5926c2878ceedf70789ff4bae619ae5e14511**. Mac and Linux build jobs passed. Windows failed frontend tests; Linux and Windows native runtime jobs were skipped. No retry or independent Linux 1.5.19 runtime check was dispatched.

| Job | Conclusion |
|---|---|
| [prototype (macos-15)](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42008808018/job/127182273807) | SUCCESS |
| [prototype (ubuntu-24.04)](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42008808018/job/127182274220) | SUCCESS |
| [prototype (windows-2022)](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42008808018/job/127182274353) | FAILURE |
| [Linux runtime-only container acceptance](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42008808018/job/127203439866) | SKIPPED |
| [Windows fresh-runner runtime acceptance (${{ matrix.installer_scope }})](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42008808018/job/127203441146) | SKIPPED |

Windows command npm test && npm run build exited 1: **5,222 Vitest tests passed / 1 failed**, 380 files passed / 1 failed (381 files), duration 1161.30 seconds, Vitest 5.0.3. Failure: src/contesting/DetachedContestSurface.test.tsx:314, “routes a QTC-only dupe marker to silent fenced review instead of spot selection”: button /^DL1ABC ·/ was absent. Serialized DOM lacked checked markup and the marker; actual .checked was not captured in the original Windows run. Full original output, failed render, command, annotations and environment stay private.

The QTC first-click loss was independently reproduced with real React hooks and a first-commit observer before changing application source. Its passive namespace reset clears accepted input; the original Windows schedule was not instrumented. Candidate 1.5.19 is held for a new application version. No assertion, deadline or skip policy was relaxed.

## Exact emitted Linux packages

| Package | Bytes | SHA-256 |
|---|---:|---|
| OM0RX-xLog-1.5.19-Beta-Linux-x64.deb | 62091078 | 4db642c10d2c74ef1b1c47ddb0087537a61ffc8d44ab4902d6bcc95e21669070 |
| OM0RX-xLog-1.5.19-Beta-Linux-x64.tar.gz | 82538140 | d68014867807d57272808d4daf1a42abf95137d5fa0f1a4075cda619d63c651b |

Checksums match uploaded sidecars. Runtime manifests identify version 1.5.19/source **72a5926c2878ceedf70789ff4bae619ae5e14511**. Native Linux runtime acceptance was **SKIPPED**.

## Verified GitHub artifacts

| Artifact | ID | Bytes | ZIP SHA-256 |
|---|---:|---:|---|
| portable-swift-pins-ubuntu-24.04-72a5926c2878ceedf70789ff4bae619ae5e14511 | 13409175857 | 5585 | f80218e23db73fca273f3be284617519b32371d35428f6bc2e827e4194871237 |
| xlog-prototype-ubuntu-24.04-72a5926c2878ceedf70789ff4bae619ae5e14511 | 13409175852 | 38527892 | 584ed0886c6e2e3abd6f419dd487c0392c92fb5382c925f107ee762761b15a91 |
| xlog-prototype-macos-15-72a5926c2878ceedf70789ff4bae619ae5e14511 | 13408053100 | 27941394 | 3f8bd252e74b26f4f3a6fcded20445a28f6460e53eda339a0353135db325a62b |
| xlog-runtime-linux-72a5926c2878ceedf70789ff4bae619ae5e14511 | 13407989527 | 315745985 | db116e9ac4ddf990f768091e608a7edb9efd659252b92d4feec699e47accf896 |
| xlog-prototype-windows-2022-72a5926c2878ceedf70789ff4bae619ae5e14511 | 13407902612 | 35584098 | 137913033f36ea61ad1c00026773d2a3d4446a7491ab1ff108c199f134b5d80e |
| portable-swift-pins-windows-2022-72a5926c2878ceedf70789ff4bae619ae5e14511 | 13407139476 | 875 | 3967e8e6bd7215f83cec5dd46209be87ec3e15dd88462638a02fd3226db60570 |

All six ZIPs were downloaded and verified against GitHub digests. Windows emitted development/cache inputs, not a distribution: its current-source executable build, portable packaging and NSIS never ran.

## Native Windows generator EOL regression

Passed on **win32**, Git **2.56.0.windows.3**, Node **22.23.4**, exact source **72a5926c2878ceedf70789ff4bae619ae5e14511**. Disposable targeted-LF checkout and actual generator output had identical bytes/hashes, zero CRLF/bare-CR, empty status and zero diff bytes:

| Generated file | Bytes | LF | CRLF | SHA-256 |
|---|---:|---:|---:|---|
| dashboard.css | 15815 | 169 | 0 | f58bc9b8882e32992b6332b55e90d4947ed358ad239b4c9dca72c320fa95483b |
| dashboard.js | 49449 | 822 | 0 | 2a25912cda76d562576194887bc9b56d5c1d008b5ebd80fca80a29e216b5d4d3 |
| index.html | 3498 | 64 | 0 | dba049b4370aea4d12d2d146f8c75dca9824a2ee986d3f3eb09f493b5d47fee6 |

Before-policy control had CRLF counts 169 / 822 / 64 and sizes 15,984 / 50,271 / 3,562 bytes. Actual generation converted to LF and produced modified status for exactly these three files; normalized diff stayed empty. Genuine-content-change control produced a visible diff. Mac/Linux generator regressions also passed. Complete numeric/hash receipts are retained in JSON. This disposable Git/generator regression proves no installer outcome or original 1.5.18 raw bytes.

## Native boundaries and supporting results

Linux/Windows runtime jobs were **SKIPPED**: runtime OS/account/WebKit/WebView2, installer paths, both NSIS scope payloads, elevation, uninstall preservation and ordinary desktop results are **NOT OBSERVED / NOT RUN**. Standard-user/UAC, upgrade, hardware and radio/rotor qualification remain open. Windows builder versions do not substitute for runtime receipts.

Root's signed Mac 1.5.19 native and worker-retention reports are separate evidence at docs-only commit a43352c4997333b4e24fa1673703ce736b36ca6e. [Ordinary CI 42008733692](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42008733692) and all seven [portability jobs 42008733924](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42008733924) passed.

Redundant push 42008733782 and superseded policy push 42006727520 were cancelled with preserved receipts; neither is a pass. Original [1.5.18 run 41987734820](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41987734820) remains failed; its separate Linux outcomes remain bounded historical evidence. Raw traces stay private. No production installation or public release was performed by this evidence task.
