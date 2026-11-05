# Original 1.5.20 canonical gate — HELD / FAILED

[Run 42016723457](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42016723457) used exact source **3d9cb0981c30764f1188db350ffebc22a5f328a7**, version **1.5.20**, one all-platform dispatch with packaging enabled and CI Mac packaging disabled. All three build jobs and original Linux native runtime acceptance passed. Both Windows installed-scope jobs failed. No retry or extra dispatch replaced this result.

| Job | Conclusion |
|---|---|
| [prototype (macos-15)](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42016723457/job/127209006672) | SUCCESS |
| [prototype (windows-2022)](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42016723457/job/127209006909) | SUCCESS |
| [prototype (ubuntu-24.04)](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42016723457/job/127209007198) | SUCCESS |
| [Linux runtime-only container acceptance](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42016723457/job/127245303338) | SUCCESS |
| [Windows fresh-runner runtime acceptance (currentUser)](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42016723457/job/127245303413) | FAILURE |
| [Windows fresh-runner runtime acceptance (perMachine)](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42016723457/job/127245303500) | FAILURE |

Frontend totals from final build logs: macos: 5225 tests / 381 files passed, windows: 5225 tests / 381 files passed, linux: 5225 tests / 381 files passed. Ordinary [CI 42016577073](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42016577073) and all seven [portability jobs 42016577154](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42016577154) passed. Redundant exact-source Mac push 42016577155 was cancelled; not a pass.

## Windows: observed partial passes and blocking failure

Both fresh hosts passed portable worker/framing/Python/contest/native WebView2 acceptance and two portable GUI launches with 36 checks each. Both EXE installers then installed to their real silent defaults, invoked with **/S only, no /D override**. Scope-specific registration, Start Menu target and all 3,270 installed payload hashes passed:

| Scope | Actual directory | Registry | Default/shortcut/payload | Installed local self-test | Installed GUI/uninstall/marker retention |
|---|---|---|---|---|---|
| currentUser | %LOCALAPPDATA%\OM0RX-xLog | HKCU | PASS | FAIL | NOT REACHED |
| perMachine | %ProgramFiles%\OM0RX-xLog | HKLM | PASS | FAIL | NOT REACHED |

Both installed runs failed **accept-windows.ps1:274**, after invoking xlog-prototype-worker.exe --local-logbook-self-test: “Packaged local logbook round trip failed.” The unchanged assertion requires ok/passed true, award_programmes = 192 and network_contact/station_io false. The original failed reply was **NOT RETAINED** because the write follows validation at line276; the specific false field and cause remain undetermined. No application fix is inferred from this conjunction alone. Installed GUI, uninstall and marker-preservation checks were **NOT REACHED**.

Both portable raw local-self-test replies passed and are byte-identical (SHA-256 867dc5d0da0fa26be0fe4b23b018b1c5819e0f7e57bd0eeebbe0daa91d7b98d5). The ZIP and both actually loaded portable/installed workers agree on SHA-256 **2dd9a007937b0cee8240bc73785a76ce2fbe4cc6a6dbe9dcde5114abce5593e5**. The [sanitized comparison](windows-installed-1.5.20.json) and [independent package audit](windows-package-1.5.20-audit.json) retain their exact scope; environment/path coordinates and raw receipts remain private.

Actual runtime receipts report Windows 10.0.20348 / X64 (hosted Server 2022), PowerShell 7.6.9, WebView2 registry version 131.0.2903.86, and no Swift found by documented probes. Both installer harnesses were **elevated**. Ordinary-user/UAC, interactive installer defaults, upgrades, reinstall rollback and external-media retention are **NOT RUN**. No token account name was recorded. Observed installation roots are normalized to the verified Windows known-folder tokens shown above; raw path/profile/TEMP/process/marker coordinates remain private. Default-path equality and scope/payload checks come from actual receipts.

Portable perMachine screenshot 1 shows the app. Both currentUser portable screenshots show the hosted-agent console occluding the app; their native JSON checks passed, but those captures do not visually confirm the app. No installed GUI screenshot exists.

## Linux native runtime — PASS, bounded container scope

Ubuntu 24.04.5 LTS; uid/gid 10001 (acceptance); WebKitGTK/JavaScriptCore 2.52.6-0ubuntu0.24.04.1; GTK 3.24.41; Weston 13.0.0. Four native embedded UI launches passed 36 checks each:3 X11/Xvfb and1 nested Wayland via Weston X11/pixman;3 installed-DEB launches and1 relocated-archive launch. Installed/relocated worker framing and bundled contest save/read/reopen/cleanup passed, exact catalogue_count = 98. Runtime has no development toolchains and Docker networking/capabilities were disabled. Linux X11/Wayland screenshots were inspected and show the app.

All Linux and portable Windows onboarding receipts explicitly skip radio/rotator and use synthetic private data. This does not establish physical desktop, equipment, accounts or RF qualification. The isolated rotor-unavailable banner remains visible.

## Exact distribution identities

| Package | Bytes | SHA-256 |
|---|---:|---|
| OM0RX-xLog-1.5.20-windows-x86_64-all-users-setup.exe | 58373847 | 6120174e492d048fbe7e785fdcc4de04fbaef26f1e85c919f18f89fe50aed86d |
| OM0RX-xLog-1.5.20-windows-x86_64-current-user-setup.exe | 58369691 | 93ac5496ecc60dff77f405d6fa8e87a8947b21a66ee3d316678b82879a7d38f9 |
| OM0RX-xLog-Prototype-windows-x86_64.zip | 83162611 | 86fd424556409e2f8b296c9e3a54126fcbfa26fd5388a4e38c859715af962116 |
| OM0RX-xLog-1.5.20-Beta-Linux-x64.tar.gz | 82539429 | 2adf3832ffacd76cfba223a83dd87c9abc2839b4af7cd7d2821000fe5521e7c7 |
| OM0RX-xLog-1.5.20-Beta-Linux-x64.deb | 62073116 | 77806642d3d20baeea55c59245345cff17c577935f0db78ee46f21993e9e6982 |

All sidecars and source/version manifests match. Both Windows installer provenance files and the portable ZIP agree on main executable SHA-256 **d6bad092ffbde54ba9b299087da4d40f7d35fd9bac9cdcb3c066650774b975a4** and payload-manifest SHA-256 **448ca94af62660acf51cd201eee791367fa0898a6ab355f3559e41d4a9c2060d**; installed runtime payload checks independently passed.

## Preserved GitHub artifacts

| Artifact | ID | Bytes | ZIP SHA-256 |
|---|---:|---:|---|
| xlog-acceptance-linux-3d9cb0981c30764f1188db350ffebc22a5f328a7 | 13415150735 | 823590 | 712b41d920024eb89aa7d796ba5cbd3dc405be96019358d1e0075228b04c0a7d |
| xlog-acceptance-windows-currentUser-3d9cb0981c30764f1188db350ffebc22a5f328a7 | 13414886688 | 431088 | 57b7abd695f4f16a8151b1f1ca641e8105127ac9aafbd40c91d39c74148e090f |
| xlog-acceptance-windows-perMachine-3d9cb0981c30764f1188db350ffebc22a5f328a7 | 13414851897 | 324855 | 5590f29e030c5cc4839b2817bb05fa6184390340c85db7b5268722b72ca9ef75 |
| portable-swift-pins-windows-2022-3d9cb0981c30764f1188db350ffebc22a5f328a7 | 13414527016 | 4262 | 3dab526bfb04bd5053655700ee2840bf5259fd6a401124c74e8382e66d7b73a9 |
| xlog-runtime-windows-3d9cb0981c30764f1188db350ffebc22a5f328a7 | 13413349502 | 198594895 | 3869a453e665320c4fe19662595b616cebb61d8217a1e6ea80a99ac99db3d41f |
| xlog-prototype-windows-2022-3d9cb0981c30764f1188db350ffebc22a5f328a7 | 13413199827 | 35582390 | 78de5ef0f45f792ea22071e068ced916a83c7fc12ef44dca16870f2f3219ee6d |
| xlog-prototype-macos-15-3d9cb0981c30764f1188db350ffebc22a5f328a7 | 13412246760 | 27940730 | 4151529b2fd262ca4c8c7e34fad8a48c93ca22f4a53a07b54948a467dedde868 |
| xlog-runtime-linux-3d9cb0981c30764f1188db350ffebc22a5f328a7 | 13411478765 | 315724479 | e7c61e124fa2832a2d6a8af43a70d6399915e0a3779fca1673fb6d8f709b18cd |
| portable-swift-pins-ubuntu-24.04-3d9cb0981c30764f1188db350ffebc22a5f328a7 | 13411279024 | 5582 | 3450520a2b96e69b68db59d82d097d95ad5c77168c8183da68740d0fe067ab6e |
| xlog-prototype-ubuntu-24.04-3d9cb0981c30764f1188db350ffebc22a5f328a7 | 13411139688 | 38528248 | 3a8972a6b189f9d91b53b6d87c0d1cc1b2e11577eb550820989a33e7ff569641 |

All 10 artifact ZIPs were downloaded and digest-verified; all six job logs are preserved privately with hashes in ci-disposition.json. All three actual-generator EOL regressions passed with exact-source numeric/hash receipts, including native win32. Targeted LF outputs remained byte-identical and clean; removed-policy control demonstrated CRLF→LF modifications and genuine-content control stayed visible.

Root's separate signed Mac 20 native/ADIF journey is documented at e7f4d0263d98a47fad0de1b43cf20241c722b717; heap correction at aa1a338ef4597aae932438586e875e9eaa1a5849. Application inputs remain frozen at 3d9cb0981c30764f1188db350ffebc22a5f328a7. Prior 19/18 failures and earlier supersessions remain preserved; no result is rewritten. Raw traces stay private. No production installation or public release was performed by this evidence task.
