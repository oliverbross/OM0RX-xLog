# 1.5.21 Windows targeted package/runtime retry — hosted scopes PASSED

[Run 42057459948](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42057459948) executed one root-authorized Windows-only new-package retry, frozen source **b0d6a93c314bfa2f24036121acd7b4a42ecdd173**, version **1.5.21**, after the original Ninja HTTP 504 provisioning failure. Same source/version, unchanged toolchain/assertions/deadlines, no artifact reuse. This separate run **PASSED**; original [42055932488](ci-1.5.21-original.md) remains **FAILED** with its downstream runtimes **SKIPPED**.

| Job | Conclusion |
|---|---|
| prototype (windows-2022) | SUCCESS |
| Windows fresh-runner runtime acceptance (perMachine) | SUCCESS |
| Linux runtime-only container acceptance | SKIPPED |
| Windows fresh-runner runtime acceptance (currentUser) | SUCCESS |

Actual Windows build results: **381 frontend files / 5225 tests**, **959 XCTest with 7 existing skips/0 failures**, then **584 Swift Testing tests in 82 suites**, all passed. All four unchanged formerly failing restore fixtures and nine native rename tests passed; **68 complete sanitized stage receipts** and actual native Windows generator-EOL regression output are retained. Both installer schema 2 provenance records match source/version and the same actual 3270-file payload manifest. Static audit hashes every portable file and verifies exact 3271-file inventory, resource mappings and configuration equality except install scope.

Both separate fresh hosted runners passed their portable worker/two GUI checks, then installed at real silent defaults with **/S only and no /D**. Public paths normalize actual equality-checked roots to **%LOCALAPPDATA%\OM0RX-xLog** (currentUser, HKCU, Programs) and **%ProgramFiles%\OM0RX-xLog** (perMachine, HKLM, CommonPrograms). Shortcut, registry and all 3270 installed payload hashes passed. Source arguments and default equality proof are retained; an independent OS installer-argv receipt was not recorded.

**Both installed worker local tests passed award_programmes 192, backup_restore and reopen_export, with confirmed shutdown exit 0.** The frozen executor kept the original nested synthetic-profile/Temp policy: configured native UTF-16 lengths **92 currentUser / 91 perMachine**, derived from the retained actual child-profile/CWD and unchanged TEMP/TMP ProcessStartInfo assignments. No diagnostic short root was used; independent child-environment readback was not recorded. Each installed scope then passed **two GUI runs × 36 checks, both exit 0**, followed by **uninstall and harness-owned profile marker preservation**. Existing production logbooks/account settings were not read.

Observed host: Server 2022 image win22/20261101.353.1, Windows 10.0.20348/X64, PowerShell 7.6.9. WebView2 registry 131.0.2903.86 was observed; actual loaded runtime binary version was not separately recorded. Swift was absent from command/path/registry probes (not an exhaustive disk scan). **Both harnesses were elevated**. Ordinary-account runtime, interactive UAC/default wizard, upgrade, reinstall rollback and external-media retention were **NOT RUN**. Onboarding intentionally skipped radio and rotor; no physical equipment or production installation is qualified.

| Package | Bytes | SHA-256 |
|---|---:|---|
| OM0RX-xLog-1.5.21-windows-x86_64-all-users-setup.exe | 58373597 | a62dc4c83331c8666e91ef9c046b9ee1164fa8e7c00e42a538f5d61347caaf27 |
| OM0RX-xLog-1.5.21-windows-x86_64-current-user-setup.exe | 58369246 | db37e22c5993dceed4d05ab3e1a1dc1c7a8bd9f5506cec08a79f85f9c2438ff1 |
| OM0RX-xLog-Prototype-windows-x86_64.zip | 83164995 | ab951e55d17ddcdb77bafdfa1516b376be9a9192d0b8db8095972bfe30e54196 |

| GitHub artifact ID | Bytes | ZIP SHA-256 |
|---|---:|---|
| 13434033295 | 35585627 | 85090a6a9a0fec7fff59db26b16ea0c734115b83e3dd87f65c41019b6be3fd11 |
| 13433788295 | 198596222 | 9fa1bca50808d451309d1d919770475889bf30b36cd17829e8cddd9fef046925 |
| 13433384181 | 755462 | 4522dae7f5ca5ee984148e82f28734a5daa75bda4572406f9a2690e4678d198b |
| 13433224184 | 646468 | 23e6a2848cb13f1e14be516a95ae24ea41c3a3f075c38cbf76795955811a3fa1 |
| 13432914964 | 4262 | 67387a78befee4ea0a4a90f1a41bf4dc518f30324536e606b11a1bb3270ac644 |

All five artifact ZIPs, package sidecars and three final logs were downloaded/hash-verified. Detailed normalized receipts are in windows-installed-1.5.21.json and independent static audit windows-package-1.5.21-audit.json. Ordinary CI attempt 2 passed; its initial service-capacity failure remains recorded. Portability is **five passes/two macOS before-step service cancellations**, not 7/7; retry APIs 500/502 created no new attempt and further requests stopped.

The separate [Linux runtime check](ci-1.5.21-linux-runtime.md) remains **FAILED** after three X11 passes and the nested Wayland recovery-branch gap. Source-only QA correction cc2149ab974627388f4d2862d1996636e644cadd is not inside immutable B0 application bytes; it requires a future new versioned candidate and packaged requalification. This successful hosted Windows outcome does not clear that gap or promote candidate 21. Raw runner/process/profile/marker coordinates and screenshots remain private. No retry beyond the single authorized package run, app installation in production or publication occurred through this monitoring work.
