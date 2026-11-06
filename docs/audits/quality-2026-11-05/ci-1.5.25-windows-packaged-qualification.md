# 1.5.25 Windows packaged qualification

**Static package audit: PASS. Both hosted Windows installer scopes: PASS. Candidate: HELD. Quality phase: OPEN.**

This report covers the exact frozen 1.5.25 package and its two fresh-runner hosted acceptance jobs. Ordinary AU25 upgrade/restart/Settings acceptance is **IN PROGRESS** in its separate journey at this checkpoint. The daily Mac installation and public release are not changed by these hosted results.

## Source and run boundary

| Item | Verified value |
|---|---|
| Version | `1.5.25` |
| Source | `ff8a8e388658fe7e822f3ecb3a5b7e13f5db9cee` |
| Tree | `e7cf46381b4cbbc5f43d7f0d64660b28a9bebe25` |
| Windows run / attempt | `42286159030 / 1` |
| Workflow | `.github/workflows/prototype.yml` |
| Dispatch created | `2026-11-06T20:11:08Z` |
| Completed success observed | `2026-11-06T21:21:55.514038+00:00` |
| Package source and QA executor source | `ff8a8e388658fe7e822f3ecb3a5b7e13f5db9cee` |
| Application rebuilt in either acceptance job | `false` |

[Exact Windows workflow run](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42286159030). The package includes the canvas-readiness correction `5eb2111735c1e4abf828980a1d397f26b662874a` and Settings completion/readback correction `c98a386a6612b9d6bdce8f4835163dd96345c5dc`. It **excludes** the later source-only contact/paging correction `f53ab0ed27444d9280485489b70c1656713ee625`. Later source evidence must not be attributed to this package.

| Job | GitHub job ID | Result |
|---|---:|---|
| prototype (windows-2022) | 128127407098 | SUCCESS |
| Windows fresh-runner runtime acceptance (perMachine) | 128158982682 | SUCCESS |
| Windows fresh-runner runtime acceptance (currentUser) | 128158983080 | SUCCESS |
| Linux runtime-only container acceptance | 128158984964 | SKIPPED |

The Linux job is skipped because this dispatch selected Windows only. Success was checked against completed job state and the retained reports; successful artifact upload alone was not treated as acceptance. No retry or replacement package was used by this audit.

## Artifact and payload integrity

Downloaded artifacts were bound to this run, attempt and source; GitHub-reported byte sizes and SHA-256 digests were checked before safe extraction. Extraction inventories were rehashed. Both scope packages share the verified portable host, worker and payload manifest.

| Artifact | GitHub artifact ID | Bytes | SHA-256 |
|---|---:|---:|---|
| runtime | 13542265669 | 198,697,034 | `b6ab7a284ce2ad3da715afb1010892589cdf7b9fe0b6d34b4050248a82eb3b8f` |
| development | 13540789143 | 35,596,567 | `9dca2d9433b9e909fc6b7725d3f5a1841d319620a3d14002eb1120fb694aae7b` |
| acceptance-currentUser | 13542261503 | 646,684 | `c12b41cbc924e8ee0c7f5494830915c3d1e76f3ad3238d062dcda874906d4d15` |
| acceptance-perMachine | 13541891690 | 647,966 | `a76a485a277df50f12d5ab56b46f50f515c5583a192810d5434900d52a9455c6` |

| Packaged file | Bytes | SHA-256 |
|---|---:|---|
| All-users installer | 58,426,254 | `9be4b36b224d1481f5f2c38a2e9c82668bd5a2259c2f78c9602a55c5cf25d280` |
| Current-user installer | 58,410,068 | `4763e6b847534c62d4094aeb2797b2230e0fadc29f7674062ff732a1b11828e8` |
| Portable ZIP | 83,176,181 | `802f556fbb67fd7b8b96ffdd1adb78277fe0cef370ae89e162dc004b32d1fefc` |
| Host x64 PE | 39,549,952 | `afced6f28d645c880d00ef8addde29bc82beec0450d9a9f45c352e452f1e6a0b` |
| Worker x64 PE | 55,719,424 | `bba772ea342c1e61ffddfaeedb36e33a3566dcbe3628b64f0972d583d95622b1` |
| Payload manifest | 591,829 | `204955e48f0efdf322b62fc83f1b931f91a537cf1a90b7be849e7237aef85d3e` |

The manifest accounts for **3,270 payload entries / 236,540,997 bytes**, excluding the manifest itself. The actual payload contains 3,271 files including that manifest. Every entry, byte count and hash was checked, with exact inventory checks. The manifest has no source/version fields; source/version association comes from the actual portable and installer provenance and run/artifact metadata. The portable provenance SHA-256 is `eced51c54be08cb4792c0cb6f90676bf96657e86589a3c66ac45c61774e7a053` (25190 bytes).

| Installer mode | Default directory token | Registry | Installer provenance SHA-256 | Config SHA-256 |
|---|---|---|---|---|
| `perMachine` | `%ProgramFiles%\OM0RX-xLog` | HKLM | `022e656aa7b6d096629ff80b35b9cdac13c8605be4b50a186c7792c94d828ab2` | `44a1762a5addf97bcef73a14ee704c6126cf04209c18e4fe79e5cc6edbcb58ec` |
| `currentUser` | `%LOCALAPPDATA%\OM0RX-xLog` | HKCU | `f7ee61274a1a4e1aa243b1197b444f3d6ff2c324ed2a8108ae7461528a10caf8` | `edb54495cd83bf536c33ace76ae82d39dd3303eaa750ea89a362e0165e830a7c` |

The configurations differ only in the intended installation mode. The development artifact host, worker and SQLite DLL match the portable bytes. The privacy scan covered 3,271 actual files with zero findings; its recorded hashes match the audited bytes. Privacy report SHA-256: `91dba1f58aa4542dce2ebd1e0bffdbd50f6cc786c1ad179c78caf41207696bd3`. These are unsigned internal Windows candidates; checksums establish integrity rather than publisher authentication.

### Actual development lockfiles

The portable ZIP contains no source lockfiles. Its empty lock list is **not** credited as a lock verification pass. Both actual development-artifact lockfiles were uniquely located and byte-compared with their fixed paths at the frozen source after CRLF normalization.

| Frozen source path | Raw bytes / SHA-256 | Normalized bytes / frozen SHA-256 | Result |
|---|---|---|---|
| `prototype/src-tauri/Cargo.lock` | 148,637 / `e6ac992d9ef853f654df3bf8796a1cfbd42833682df1fd700841fd9205dc6ab3` | 142,738 / `96a2a7d6187178644eeeb64b163a0ea1001dffddb3e974a9913d2a373cdcd297` | Exact match |
| `prototype/package-lock.json` | 120,467 / `038a13d643759457edd2fcbaaa06442473d9bb9a8bc69ae0e078941c78f410b5` | 117,113 / `db7b0ce59e4f5ffec6af57ce2548bf348bd884620efeee2162aa1f9877a34869` | Exact match |

## Hosted installed and portable results

Both elevated Windows Server 2022 X64 harnesses passed their default-path, registry scope, Start menu shortcut, installed payload, native runtime, uninstall and marker-retention checks. Current-user mode used the LocalAppData default and HKCU; all-users mode used the Program Files default and HKLM. The preservation assertion covers a **harness-owned marker** only: existing logbooks and account settings were not read.

| Scope | Runtime | Top-level checks | GUI launches | Result |
|---|---|---:|---:|---|
| `currentUser` | portable | 14 | 2 | PASS |
| `currentUser` | installed | 15 | 2 | PASS |
| `perMachine` | portable | 14 | 2 | PASS |
| `perMachine` | installed | 15 | 2 | PASS |

There are **2 installer-scope reports, 4 runtime reports, 58 top-level check evaluations and 8 GUI launches**, with no failed checks. Each GUI launch must satisfy the same exact **36-key contract** derived from the frozen source: 32 native local checks plus 4 ordinary frontend checks. The 288 GUI-check evaluations are repeated evaluations of these 36 keys, **not 288 unique tests**. Missing, extra, false or empty check inventories cannot satisfy the verifier.

Frozen GUI contract source hashes:

- `prototype/src-tauri/src/acceptance.rs`: `247a48bd65b2d5b8e69c648e56ae9d446fb5f6fc4ff24ab07e6526f6f5da9d5e`.
- `prototype/src/integratedAcceptance.ts`: `fedde29a830f7ca004b641af2bfefdc276233cf0bd2d420b25a1c7332951f9b5`.

Each QA receipt independently identifies `packageSource` and `qaExecutorSource` as the frozen source, `packageRunId` as `42286159030`, and literal `applicationRebuiltInThisJob: false`. QA receipt SHA-256 values are `c40a2e13766749765f1d965e5ddc0e6652f80b92a411f8b813206b92e3ada482` (current-user) and `2c27ad24dae8ba001d0c1b6a3aff997f0340aa5297ce38ab4aedd7ae76a30599` (all-users).

### Settings completion, canvas readback and map predicate

All eight retained Settings reports identify fresh attempt 1 as **applied**, followed by one matching readback in the same generation with revision **2 → 3**. The expected changed value matches the readback, and differs from the previous value. No raw sample setting values or generation identifiers are published here. These are acceptance ordering/readback assertions, not a responsiveness benchmark.

All eight canvas reports passed controls and readback, kept the draft unchanged, persisted map hiding and ended locked. The actual conflict-recovery branch is recorded in **3 of 8** launches; the other five record no recovery. This distinction is retained instead of describing all eight as recovery tests.

| Scope | Runtime / launch | Settings | Conflict recovered | Matched map probes |
|---|---|---|---|---:|
| `currentUser` | portable / 1 | Applied; same generation; 2 → 3 | No | 192/192 |
| `currentUser` | portable / 2 | Applied; same generation; 2 → 3 | No | 192/192 |
| `currentUser` | installed / 1 | Applied; same generation; 2 → 3 | No | 192/192 |
| `currentUser` | installed / 2 | Applied; same generation; 2 → 3 | No | 32/32 |
| `perMachine` | portable / 1 | Applied; same generation; 2 → 3 | Yes | 32/32 |
| `perMachine` | portable / 2 | Applied; same generation; 2 → 3 | Yes | 192/192 |
| `perMachine` | installed / 1 | Applied; same generation; 2 → 3 | Yes | 192/192 |
| `perMachine` | installed / 2 | Applied; same generation; 2 → 3 | No | 32/32 |

The native final-map predicate is enforced separately: loaded, visible, tiles loaded and WebGL are true; error text is empty; probe count is an unsigned integer of at least 8; all probes match; mismatch lists are empty; capture timestamps are positive unsigned integers. Screenshot bytes/hashes are retained, but this audit makes no visual screenshot-review claim.

### Retained stderr and environment

All eight GUI launches retained one `Failed to unregister class Chrome_WidgetWin_0. Error = 1412` stderr line, for **8 lines total**. They are preserved alongside successful GUI exit/report results. Worker EOF exits, GUI exit codes and uninstall reports do **not** establish a complete orphan-WebView census.

The hosted environment was Windows Server 2022 X64 / 10.0.20348, runner image `win22` / `20261101.353.1`, PowerShell `7.6.9`, and existing Evergreen WebView2 `131.0.2903.86`. No Swift installation was performed; absence was checked through command lookup, conventional installation paths and uninstall registry, with the documented non-exhaustive scope. GUI runs used isolated synthetic namespaces with large-log and station I/O disabled. Radio and rotator onboarding were skipped.

## Original 1.5.24 failures remain recorded

Run `42266613054`, attempt 1, source `b294b606a579a25929a9a90a82ec76e55c961b22`, retains both portable passes and these separate installed failures:

- Current-user: `Unavailable canvas recovery control: Use saved layout`.
- All-users: `Acceptance failed: settings_save_readback`.

Their second installed GUI launch, uninstall and marker-retention stages were not reached. The new S25 outcomes do not rewrite those failures or retrospectively prove the exact at-failure DOM/readback timing. Failure-analysis receipt SHA-256: `281e50cae4ac1129db8bc249fcaa822a1a2e2ebc7a717d818f856e5d571adfa3`. The separately recorded bounded ordinary AU24 pass also remains distinct from those hosted failures.

## Acceptance boundary and remaining work

Ordinary AU25 acceptance remains **IN PROGRESS** at this report checkpoint and is owned by the separate ordinary-desktop journey. This hosted pass does not certify an ordinary Windows desktop, Standard account, interactive UAC/Finish launch token, upgrade/rollback, external media, native desktop graphics or physical radio/rotator/audio/PTT equipment. The synthetic native X64 hosted environment does not replace ordinary native-X64 desktop acceptance.

Large-log packaged behavior, complete process cleanup, full profile restore, Linux desktop paths, Mac package/notarization, original approximately 7 GB attribution and the full attributed memory/idle CPU budget remain outside this Windows run. No performance improvement or absence-of-bugs claim is made. The later paging fix still needs its own package qualification. Candidate **1.5.25 remains HELD** and the quality phase remains **OPEN**.

## Retained evidence and publication

Evidence is retained under `.build/quality-ci/run42286159030/`. The original static receipt still records runtime acceptance as pending at its earlier capture; the later hosted receipt below supplies the completed result without rewriting that history. This report was prepared from retained files without executing packaged software, re-running workflows or modifying the ordinary VM.

| Evidence file | SHA-256 |
|---|---|
| `windows-package-1.5.25-audit.json` | `81326ff82ba8d8f9e73269aaff5a13336e69bc2d2dff3ef52afeb965e2644cc3` |
| `au25-native-package-pins.json` | `f5e163700058ea6fb15ce90fb3c599db50717cbddc41e02780e9add580d86a17` |
| `hosted-windows-acceptance-audit-20261106T212256098311Z.json` | `b4cf8213b14aa9e1e4486cc3027459a15992868efc57f952b14d85f9537e46aa` |
| `hosted-s25-detailed-readback-inspection.json` | `a1cb06a77ede4e0453150d51d48fb34e009075f277e74578ed1b0af291610c42` |
| `status-hosted-03-20261106T212154288775Z.json` | `55fa8456a8cf26a1c1f0f0c891e5bee5a9922b63c1d4510e5517516993096202` |
| `s25-gui-contract.json` | `ce1410fce797a40a2677837eebdaa38c2387b594022099e43f75cae6732ce4e8` |
| `helper-preparation.json` | `2b68dacab42c1a925103fe1067c3cd330caec1d2e34fc87866e7eb43c513141a` |
| `helper-independent-review.json` | `9c5dc925250d628fe59004194bd03f42b576b546a5caab584ec7b91f28d32736` |
| `job-128127407098.log-receipt.json` | `2695fc3a490d4f34d2d180c00b1ca3ed4f9a31f955f1da0814da71c4cb4af1fc` |
| `job-128158982682.log-receipt.json` | `35814c949bf0427ae9da80070da887e739b6e29fa1e5c296707e54668933bf7f` |
| `job-128158983080.log-receipt.json` | `89b31e0c9e2372b8defe62559ed3bb7b8d5387ee91fb22644d10025049e1800c` |
| `job-128127407098.log` | `3b1f7025ba98857b00d61462b83aff3e5c20a845596cec2e71c00a3c67ab195b` |
| `job-128158982682.log` | `6661b6df2a72e23f54e8b6c6df4bac295e58660f45884fd51486f9e28a915f9b` |
| `job-128158983080.log` | `c733bca6961ee4b380afc09c55f84ed3c1a9fcf4a19ea1c823dbd686b155b8ad` |

The machine-readable companion, `ci-1.5.25-windows-packaged-qualification.json`, contains sanitized artifact inventories, per-runtime and per-GUI result pins, development-lock comparisons and the complete 36-key contract. Its SHA-256 is `2de42de5145e4b70351b996f794e090996d74a650b081a4d4918e0fb1f4cd9da`. Machine user paths, process IDs, raw settings and sample contact content are omitted. GitHub run/job/artifact identifiers are retained for provenance.

## Later ordinary checkpoint — 7 November 2026 publication

The earlier IN PROGRESS state above is retained. The separate [ordinary AU25 report](windows-ordinary-1.5.25.md), completed at 21:58:02 UTC on 6 November, now records the bounded upgrade, acknowledged Settings save/restart/restoration and two-QSO preservation journey as PASS. Its scope does not expand the hosted results. The original report remains pinned at SHA-256 `32fb154d10359381acffe60295f4fe16b08a1d564ebbe6c4dc3493a591d67b2c`.
