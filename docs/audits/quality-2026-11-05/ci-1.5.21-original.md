# Original 1.5.21 all-platform gate — dependency provisioning FAILED

[Run 42055932488](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42055932488), exact source **b0d6a93c314bfa2f24036121acd7b4a42ecdd173**, version **1.5.21**, executed build_platforms=all, validation_only=false, package_macos=false. This original run remains **FAILED**. Its completed Linux/macOS build evidence and emitted Linux packages are retained; downstream runtime jobs were **SKIPPED**.

| Job | Conclusion |
|---|---|
| prototype (ubuntu-24.04) | SUCCESS |
| prototype (windows-2022) | FAILURE |
| prototype (macos-15) | SUCCESS |
| Linux runtime-only container acceptance | SKIPPED |
| Windows fresh-runner runtime acceptance (${{ matrix.installer_scope }}) | SKIPPED |

Windows failed at **Windows SQLite**, before frontend/core/application compilation or packaging. vcpkg compiler detection needed **Ninja 1.13.2**; [ninja-win.zip](https://github.com/ninja-build/ninja/releases/download/v1.13.2/ninja-win.zip) returned **HTTP 504 twice**, exhausted three download attempts and made vcpkg exit 1. Swift 6.3.3 setup/version had passed. This is an observed dependency acquisition failure, not an application test failure. The final 118842-byte Windows log SHA-256 is **08674f9dd3a0772436ce00af199cb4e067fdb95d7e6e65bbfc687606051704a2**. Only a development artifact was emitted; potentially restored cached bytes are **not a Windows 1.5.21 distribution or qualification**.

Mac and Linux actual frontend results each passed **381 files / 5225 tests**. Mac full XCTest passed 1392 tests with 9 existing skips and 0 failures, followed by 628 Swift Testing tests. Linux passed 956 tests with 7 existing skips and 0 failures, followed by 581 Swift Testing tests in 81 suites. Each platform passed all four unchanged restore-boundary cases and its eight rename tests. Linux retained 68 complete sanitized stage JSON receipts. Mac retained 67 plus one malformed interleaved marker; four completed test results remain directly observed, and no complete 68-marker claim is made for that log. Actual-generator EOL numeric receipts for both hosts are retained in the companion JSON; original Windows EOL regression was not run.

| Emitted Linux package | Bytes | SHA-256 |
|---|---:|---|
| OM0RX-xLog-1.5.21-Beta-Linux-x64.deb | 62055658 | dfdd6fd91fffae60f6d1ac75e84c311b01ab33a55a735d26bb72a0cffdd16762 |
| OM0RX-xLog-1.5.21-Beta-Linux-x64.tar.gz | 82531865 | b9fc101b56684e97907d72bcdc6140a1b20e3f78f30e450abba310d7ac46dafc |

Both published package sidecars verified, and both staged runtime manifests match exact source/version. All five GitHub artifact ZIPs were downloaded and matched their declared digests:

| Artifact ID | Name | Bytes | ZIP SHA-256 |
|---|---|---:|---|
| 13431714900 | xlog-prototype-ubuntu-24.04-b0d6a93c314bfa2f24036121acd7b4a42ecdd173 | 38531295 | c878153b07f312f8737e4c6c5bc316dad4c2f03afc392b739cc9140e801af99a |
| 13431129202 | portable-swift-pins-ubuntu-24.04-b0d6a93c314bfa2f24036121acd7b4a42ecdd173 | 5584 | a30080a55a148902d5625089ed683dd111cd20446b62d85304c6f9991f1ab9ff |
| 13430818120 | xlog-prototype-macos-15-b0d6a93c314bfa2f24036121acd7b4a42ecdd173 | 27941784 | 3a3e29d3a1029d30a20b66bb9318ccadce3363690fa1dbff64bd77a4cece9d77 |
| 13430639504 | xlog-runtime-linux-b0d6a93c314bfa2f24036121acd7b4a42ecdd173 | 315703277 | 407eb61c2b0bf7d606bf3f010eebc9629eb537f16b39033b9eff68fad0289841 |
| 13430371078 | xlog-prototype-windows-2022-b0d6a93c314bfa2f24036121acd7b4a42ecdd173 | 35582392 | 45cdf3b5fb4629de9fa5f797e2823275f465d13c0b658f25f5f30acc568185b4 |

Ordinary CI 42055606193 attempt 1 failed before acquiring a runner; its job was service-cancelled with no steps and no job log. Root-authorized attempt 2 **PASSED**, exact source unchanged. The original capacity annotation and final passed log are retained separately.

Contest portability 42055606115 retains **five passing jobs and two macOS jobs service-cancelled before any step**, with the same hosted-runner acquisition/capacity annotation. **It is not 7/7.** One authorized specific-job retry returned HTTP 500 with no new attempt. Root's one alternative failed-jobs request returned HTTP 502, also without a new attempt. Further requests are stopped; no passing job was rerun or overridden. The verified redundant single-Mac prototype push 42055606152 was cancelled, not passed.

The separate root-authorized [Windows-only new-package retry 42057459948](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42057459948) uses the same frozen source/version; it has its own outcome and cannot erase this original failure. A separate Linux runtime-only check may qualify these exact emitted bytes without rebuilding. No downstream account/WebView/runtime outcome is inferred here. Root-owned signed Mac native acceptance is separate from CI. No production install, release or hardware qualification occurred through this monitoring work.
