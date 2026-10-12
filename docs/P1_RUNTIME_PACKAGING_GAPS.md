# P1 runtime packaging inventory and remaining clean-machine gate

Historical inventory: see [packaged runtime acceptance](P1_RUNTIME_ACCEPTANCE.md) for the follow-up packaging implementation, native loader checks and fresh-runtime results. The limitations below describe the original development archives, not the newer runtime packages.

Date: 2026-10-12. Scope: static inventory of the development artifacts from [successful native matrix run 38196764698](https://github.com/oliverbross/OM0RX-xLog/actions/runs/38196764698), commit `c3d05eac4ef88f83d4a9ed93496aed0cd4788b37`. This is not an inventory of the subsequent UI revision `46f1bca` or a production release.

**Result:** the archives contain native prototype executables, but do not establish an installable application with a closed runtime dependency set. Windows includes SQLite alone as an additional DLL; Linux includes no shared libraries. Missing Swift runtime packaging is an inference from that archive content, the dynamically linked Linux worker metadata and the build's installed Swift toolchains. Exact Windows/Linux import tables and recursive loader closure remain unverified.

## Evidence and inspection boundary

Downloaded all three existing GitHub artifacts into a new temporary directory, `/tmp/xlog-p1-runtime-20261012.eVXOst`, using `gh run download`. Inspection used artifact API metadata, complete extracted file manifests (`rg --files --no-ignore`), SHA-256 payload hashes, `file` metadata and permitted Mach-O `otool` metadata. No downloaded executable was launched. No installed app, global package, station, credential or user logbook was modified.

The existing lean-ctx allowlist rejected the local ELF/PE import-table inspector permanently. The allowlist was preserved. No Windows/Linux conclusion relies on an equivalent import-table reader, custom parser or library-name string scan. Consequently this report does **not** claim exact ELF `DT_NEEDED`/runpaths, PE imports, transitive dependency names/versions or a complete recursive dependency graph. A native loader audit is a required next-stage result, not evidence supplied by this inventory.

CI installed Swift before testing: macOS logged Apple Swift 5.10 targeting `arm64-apple-macosx14.0`; Linux and Windows logged Swift 6.3.3 targeting `x86_64-unknown-linux-gnu` and `x86_64-unknown-windows-msvc`. The workflow also installed Linux development dependencies and Windows vcpkg SQLite. Successful execution on those provisioned runners is distinct from launch on an OS with no developer toolchain.

## Exact artifact contents

Each archive has two common evidence inputs: `package-lock.json` and `src-tauri/Cargo.lock`. The executable payloads below are relative to the extracted artifact root.

| Artifact / platform | Executable payload | Other runtime payload | Total files |
| --- | --- | --- | --- |
| [11723975998 / macos-14](https://github.com/oliverbross/OM0RX-xLog/actions/runs/38196764698/artifacts/11723975998) | `src-tauri/target/release/xlog-prototype`, `src-tauri/target/release/xlog-prototype-worker` | None | 4 |
| [11724340450 / ubuntu-24.04](https://github.com/oliverbross/OM0RX-xLog/actions/runs/38196764698/artifacts/11724340450) | `src-tauri/target/release/xlog-prototype`, `src-tauri/target/release/xlog-prototype-worker` | None | 4 |
| [11724242316 / windows-2022](https://github.com/oliverbross/OM0RX-xLog/actions/runs/38196764698/artifacts/11724242316) | `src-tauri/target/release/xlog-prototype.exe`, `src-tauri/target/release/xlog-prototype-worker.exe` | `src-tauri/target/release/sqlite3.dll` | 5 |

All artifact names end with the full inspected commit SHA. None contains an installer, `.app` bundle, Linux package, Swift runtime library, Hamlib executable, distribution notices or SBOM. That statement is about these CI archives; it does not deny the separate local macOS development bundle documented in [P1 acceptance](P1_PROTOTYPE_ACCEPTANCE.md).

GitHub artifact API metadata reports the following archive sizes and digests. Digests identify the uploaded ZIPs; payload hashes below were calculated independently after extraction.

| Platform | Archive bytes | GitHub ZIP SHA-256 |
| --- | ---: | --- |
| macOS | 3,841,365 | `6de6c97a328801ac6b4f960b0d90bbd8c65d1f939c31fb2116e53fd984f3434c` |
| Linux | 8,462,133 | `d50bd5ac94050b547b1b274d3e7e4044c6f91d54fd345715c732e48fd60da700` |
| Windows | 7,672,704 | `06f281db62d146c48299a17b82091c8b6dfbfd5a5571c4bbc32057e469851d46` |

| Extracted payload | Calculated SHA-256 |
| --- | --- |
| macOS worker | `2a6b343dddb33d96b91c31bcb0d2e67a2c46550b9ce545a4d763bc62460dd38f` |
| Linux worker | `ac8a7a009e9a869c9a145a4a17d0034ba249e28de9f8fa9b4a62b88549eb1b42` |
| Windows worker | `5bab0c30aed8ec5e39198cb52664bb2b6a7c6ba0069312730aaf4dee5c7fd416` |
| Windows SQLite DLL | `6f2d41afd70aafe45ba3a4828332a2329ba77ba8b3758f9ebdfa2f5706367b11` |

## Platform findings

### Windows

`file` identifies the worker as a PE32+ console executable for x86-64 Windows. The only DLL shipped in the archive is `sqlite3.dll`. CI's build script copies this DLL from the selected vcpkg prefix, while [staging](../prototype/scripts/stage-worker.mjs) copies the worker and SQLite to the Rust development/release output directories. It does not stage a Swift runtime tree.

The worker compiles Swift Foundation, FoundationNetworking, XML and concurrency-related code against the installed Swift 6.3.3 environment. Its successful CI tests therefore do not prove the two executables and SQLite alone are sufficient. **Inference:** runtime redistribution/provisioning is incomplete or at least unproven; this pass cannot provide the authoritative DLL list or establish which components could instead be linked statically.

The shared shell uses Tauri. The archive has no WebView runtime provisioner or Windows installer, so WebView availability on the supported end-user Windows image also remains a packaging decision/test. Visual Studio/Swift/vcpkg availability on `windows-2022` must not become an undocumented end-user requirement.

### Linux

`file` identifies the worker as an x86-64 dynamically linked ELF PIE with interpreter `/lib64/ld-linux-x86-64.so.2`, a GNU/Linux 3.2.0 ABI metadata marker, and debug information. The metadata marker does not prove compatibility with arbitrary older distributions; the build and declared reference platform are Ubuntu 24.04.

No `.so` files or Linux package metadata are present in the archive. The CI lane installed Swift 6.3.3 and SQLite, WebKitGTK, appindicator, librsvg, curl, XML, ICU and SSL development dependencies before the tests/build. Those are observed **build requirements**, not a verified minimal runtime package list. **Inference:** the worker's Swift runtime payload and the shell's system-library/package prerequisites need explicit closure/provisioning. The exact shared-library graph, symbol-version floor, search paths and library load order are unavailable in this pass.

### macOS

The permitted `otool -L` check of both downloaded binaries reports only Apple framework paths and `/usr/lib` dependencies. The worker directly names system SQLite, Foundation/CFNetwork, CryptoKit and OS Swift libraries; no Homebrew library path is reported. Its load metadata declares minimum macOS 13.0, SDK 14.5 and `@loader_path` as a runpath.

This narrows the macOS runtime gap, but a declared deployment minimum is not launch evidence on macOS 13. The CI artifact is two raw executables, not the ad-hoc-signed local `.app`, a Developer ID-signed/notarized distribution or an Intel artifact. Supported OS/architecture launch and final nested-helper signing remain separate checks.

## Next bounded packaging gate

The next stage should produce one traceable package per supported target, then prove the following on clean target OS images without Swift, Node, Rust, Xcode/Homebrew or vcpkg installed:

1. Obtain an approved native direct/transitive loader inventory for the exact worker, shell and SQLite payload. Record dependency origin, version, hash, redistributable notice and whether it is bundled or provided by the OS/package manager. Preserve the current allowlist rather than using this report as permission to override it.
2. Select and implement the Windows Swift/CRT/WebView provisioning strategy and the Linux Swift/system-library packaging strategy from that inventory. Verify loader search paths, including every child worker; do not rely on the CI toolchain directory or inherited developer `PATH`.
3. Install the exact package and exercise native `health`, `self_test`, synthetic `parse_adif`, the two process-framing regressions and UI-to-worker launch. Record environment, executed counts, hashes and missing-library/loader diagnostics. An installer that only copies files is not sufficient evidence.
4. Verify shutdown/restart, helper location and nested signing under the final package layout. Complete platform signing/notarization separately from the existing ad-hoc macOS development-signature result.
5. Add the selected Hamlib helpers, notices/source information and SBOM only when their own native build and packaging evidence exists. The present archives include no Hamlib runtime and do not establish local hardware operation.

This inventory ends at identifying the gate. It performs no runtime bundling, installer generation, credential use, hardware connection or production deployment.
