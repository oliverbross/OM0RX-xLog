# Main 1.2.21 compatibility checkpoint

18 October 2026, Australia/Darwin.

This isolated merge combines contest checkpoint `bf654378b28731b9362cf96c2c4bf301bc28a6ed` with the main chat's installed/runtime-accepted 1.2.21 source `6dabf97db3097c7a908d263a505bdb2d565fce37` on `codex/contest-main-1-2-21-integration`. It is not final integration or a packaged release. The main chat owns the canonical checkout and its ongoing 1.2.22–1.2.23 changes.

The three conflicts preserve both HF Propagation and Contesting navigation: `LiveApp.tsx`, `workspaceNavigation.test.ts`, and native `workspace_navigation.rs`. Contest availability remains bound to the isolated Test profile. The new native HF HTTP command now applies the existing Test-profile external-I/O guard before constructing the fetch; its rejection assertion runs inside the existing native admission suite on all CI platforms. Production endpoint validation is unchanged.

The export test helper now waits for the Export button to become enabled and the dialog to appear before filling it. The initial selected run had 315 passes and one readiness failure; the repaired full selected run passes all 316. No product behavior was changed to accommodate that fixture.

## Validation

| Check | Result | Local log | SHA-256 |
| --- | --- | --- | --- |
| Contesting, HF, desk/navigation, spot and layout frontend suites | 316 passed, 29 files | `/tmp/xlog-main-121-contest-integration-frontend-final.log` | `a5d77a561e2284744ec1a75d58bc7d2b9ad97f90a844591451345ac66a0945b2` |
| TypeScript, Vite and window bundle checks | Passed | `/tmp/xlog-main-121-contest-integration-build.log` | `63511247d0e82084a1413cac2c1dcb9168c47479c32f44523d71d08735bf2e35` |
| Native Test-profile admission | 5 passed | `/tmp/xlog-main-121-contest-native-admission.log` | `6f99642d7f4b92aeb5368645e40b5b1d07c53f084aa5277db2974de0604a9958` |
| Native workspace filter | 86 passed | `/tmp/xlog-main-121-contest-native-workspace.log` | `54348dc8202237d7867386a0995eaeb4a06bae226800ff1ff8e41c876ace2ab6` |
| Native HF endpoint/input validation | 2 passed | `/tmp/xlog-main-121-contest-native-hf.log` | `992e8c2f051c4a0ab23f32f8993bed487e089884186612164fb923ee513f830e` |

Native commands use `cargo test --locked --jobs 2 --target-dir /tmp/om0rx-history-ui-rust --bin xlog-prototype --features contesting-test` with filters `contesting_test_native_admission_tests::`, `workspace_`, and `hf_propagation::tests::`. The Test product/identifier override disables packaging and external binaries. Filter counts overlap and must not be added as distinct test counts. No network fetch or radio keying was performed. Swift product sources are unchanged by this merge.

The earlier contest history checkpoint `22857aa98a6dce1f4684937443f017866cdc8cd8` independently passes all six Swift/Rust native jobs across macOS, Windows and Linux in [run 39084858294](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39084858294), plus regular CI `39084858207`. Those results belong to that exact source, not this newer merge.

## Remaining integration gates

- Reconcile the main chat's final accepted source, including Follow Radio transient-fence recovery, retained spot continuation, passive local radio-state refresh and Remote Agent tuning compatibility.
- Integrate the separate reviewed declarative export/runtime branch and forthcoming generic definition activation and exclusive module ownership.
- Complete the 14-profile operator rehearsal and remaining full-port, sponsor-rule, feature and platform/package acceptance. No full-port claim follows from this checkpoint.
- Package/install only from the canonical checkout after the accepted integration handoff. Preserve the open parity workbook and its user lock.
