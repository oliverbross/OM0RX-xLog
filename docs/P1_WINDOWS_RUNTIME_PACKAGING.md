# P1 Windows portable package and acceptance

Scope: isolated OM0RX-xLog prototype, x86_64, Swift 6.3.3. The intended consumer target is Windows 11; Windows Server 2022 is the native CI reference. Windows 10 support is not accepted by this stage. The scripts create a new output directory and do not replace an installed app, access a station, install Swift on an acceptance host, or deploy to the user's remote Windows station. Native CI results must be recorded separately from the user's later Windows desktop test.

## Native builder

After the existing worker, frontend and Rust build and `distribution-metadata.mjs` step:

```powershell
./prototype/scripts/package-windows.ps1 -SkipBuild -OutputRoot "$env:RUNNER_TEMP/xlog-windows-package"
```

Outputs are `OM0RX-xLog-Prototype-windows-x86_64.zip`, its `.sha256` companion, and the directory with the same basename. The executable names remain `xlog-prototype.exe` and `xlog-prototype-worker.exe`. Swift runtime DLLs, selected vcpkg SQLite and Visual Studio REDIST CRT DLLs are app-local beside both executables.

Packaging uses the native builder's Visual Studio `dumpbin /HEADERS` and `/DEPENDENTS`, recursively stages imported non-OS DLLs from explicitly recorded installed runtime directories, checks x64 architecture and refuses ambiguous versions or unresolved redistributables. API-set contracts and Microsoft-signed System32 libraries remain OS-provided. This native audit is a next-stage Windows operation; no previously denied local PE inspector is retried or replaced.

For Swift DLLs the official `Runtimes/6.3.3` component takes precedence over explicit fallback directories, SDK directories and compiler-host copies. Different hashes within the selected source tier still fail packaging; lower-priority copies are recorded as shadowed candidates in `provenance.json`. Visual Studio CRT lookup validates the actual versioned x64 redistributable directory instead of assuming the `v143` alias is usable.

The package contains `dependencies.json`, raw native import evidence, `provenance.json`, SHA-256 `payload-manifest.json`, dependency locks, shared component/license metadata, official Swift 6.3.3 license texts and conditional third-party notices. Third-party notice snapshots that are not tied to exact runtime source versions are disclosed in provenance and need review before public distribution. The package is unsigned internal test material; this metadata is not a certified complete SBOM or an authenticity signature. Sorted ZIP entries and fixed commit timestamps remove filesystem timestamp variation; absolute source provenance paths and upstream notice snapshots mean this is not a claim of bit-identical rebuilds across arbitrary builders.

`-DumpbinPath`, `-VCRedistDirectory` and `-AdditionalRuntimeDirectory` permit explicit installed-toolchain inputs when the native layout differs. The CRT directory must be a Visual Studio REDIST x64 `Microsoft.VC*.CRT` directory. No arbitrary PATH search or System32 copy supplies a missing CRT.

## Fresh native acceptance job

Use a separate `windows-2022` job that downloads the exact ZIP and never installs Swift or build dependencies. PowerShell 7 is an acceptance harness dependency, not an application runtime dependency.

```powershell
Expand-Archive -LiteralPath ./OM0RX-xLog-Prototype-windows-x86_64.zip -DestinationPath "$env:RUNNER_TEMP/xlog-windows-accept"
$package = "$env:RUNNER_TEMP/xlog-windows-accept/OM0RX-xLog-Prototype-windows-x86_64"
& "$package/accept-windows.ps1" -PackageDirectory $package -EvidenceDirectory "$env:RUNNER_TEMP/xlog-windows-evidence" -RequireNoSwiftToolchain
```

Upload the entire evidence directory even on failure. `acceptance.json` records OS/runner details, original developer-command presence, conventional Swift installation paths and uninstall-registry probes, restricted child PATH, isolated synthetic profile, payload hashes, module origins, executed worker checks and two GUI reports. The parent environment and installed applications remain unchanged. The script retains its own evidence/profile directory for diagnosis.

The harness verifies synthetic `health`, `self_test`, `parse_adif`, both process-framing regressions, EOF shutdown, worker CLI self-test and two independent `--acceptance-report` GUI launches. GUI reports must use schema 1, status `passed`, `embeddedUi: true`, `worker: true`, true native checks and exit 0. Reports are polled while the app is alive; partial JSON is retried. Worker module evidence requires app-local Swift core and SQLite hashes, and refuses packaged DLL names loaded outside the package. A native desktop screenshot is attempted while the GUI holds open; an unavailable capture is explicitly recorded and does not become visual acceptance.

Microsoft Evergreen WebView2 is an explicit prerequisite and its installed registry version is recorded. The portable archive does not silently install a system runtime. The native GUI launch provides actual WebView rendering/IPC evidence when its report passes. Windows Server CI remains distinct from Windows 11 desktop acceptance; developer tools already present in the base runner are disclosed even though the application child PATH excludes them.

## User's later Windows desktop test

Download the exact portable ZIP and its checksum, compare SHA-256, and extract the whole package to a new folder outside the stable application. Keep the two prototype executables and all DLLs together. Launch `xlog-prototype.exe` and verify the prototype label, rendered dashboard/map, synthetic worker results, resize behavior, close and restart. Confirm that no station radio, rotor, cluster connection, credentials or personal logbook is requested or accessed. Preserve any missing-DLL, WebView2 or SmartScreen diagnostic without overriding machine policy.

If PowerShell 7 is already available, run the bundled `accept-windows.ps1 -PackageDirectory .` from the extracted directory and return `acceptance.json`, both GUI reports and screenshots. Do not use `-RequireNoSwiftToolchain` on an ordinary developer machine; the report will disclose detected tools. No automated remote deployment is authorized by this checklist.

Primary sources: [Swift Windows installation](https://www.swift.org/install/windows/), [Swift 6.3.3 Windows runtime/SDK/toolchain layout](https://github.com/swiftlang/swift/blob/swift-6.3.3-RELEASE/docs/WindowsToolchain.md), [Swift license](https://www.swift.org/legal/license.html), [Microsoft DLL dependency inspection](https://learn.microsoft.com/cpp/build/reference/dependents), [Microsoft runtime redistribution](https://learn.microsoft.com/cpp/windows/redistributing-visual-cpp-files), [Visual Studio 2022 REDIST list](https://learn.microsoft.com/en-us/visualstudio/releases/2022/redistribution), [WebView2 distribution](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution), [SQLite public domain](https://www.sqlite.org/copyright.html).
