# Windows restore boundary baseline — four real regressions FAILED

[Native core diagnosis 42047371176](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42047371176/job/127313896884) ran tests-only source **47ee6cdaf3235c05aa797e8017751b9fe898bb34**, platform **windows-2022**, filter **WindowsRestorePathBoundaryTests**, with draft_precision_phases=false (observation step skipped). This builds tests, not an application candidate. Owning Sources and Package.swift are unchanged from immutable application/package **1.5.20 / 3d9cb0981c30764f1188db350ffebc22a5f328a7**; no package was rebuilt.

The uploaded selection receipt proves **actualCompletedTestRecords=4**, **childExitCode=1**, scope filtered-native-core, fullProductQualification=false. Final XCTest output reports **4 tests / 4 unexpected failures / 1.876 seconds**. Every named positive round-trip test ran and failed:

- testDirectRestoreAtTemp91
- testDirectRestoreAtTemp92
- testRPCRestoreAtTemp91
- testRPCRestoreAtTemp92

All four fixtures passed **15 stages**, including literal/native path-dimension verification, real SQLite open/seed, reference lease, selected backup creation/seal, restore-envelope/reference preflight, changed-live fixture, recovery-snapshot creation/verification and **install-database**. Stage16 **install-reference** failed in every case. The exact observed filesystem primitive was **Foundation.moveItem**, moving live reference data to its restore rollback directory:

| Case | Source native UTF-16 units | Destination native UTF-16 units | Primitive error domain / code |
|---|---:|---:|---|
| temp91-direct | 189 | 262 | NSCocoaErrorDomain / 516 |
| temp92-direct | 190 | 263 | NSCocoaErrorDomain / 516 |
| temp91-rpc | 192 | 265 | NSCocoaErrorDomain / 516 |
| temp92-rpc | 193 | 266 | NSCocoaErrorDomain / 516 |

The outer stage error is **XLogPortableCore.XLogBackupError / 2**. The companion JSON preserves all **64 sanitized stage receipts**, including operation, path lengths and error domains/codes. Raw roots, UUIDs, exception descriptions and userInfo are omitted. No underlying Win32 error code or exact path-limit threshold was recorded. The evidence identifies the failed primitive and measured dimensions; it does not establish why Foundation returned516 or prove the direct self-test threw the identical exception.

**reopen-verify-selected-data was NOT REACHED**, so its selected-contact/settings/reference/unknown-field/rollback-byte preservation assertions are unexecuted. This failed baseline is retained for a future correction; no test expectation, application source, deadline or acceptance policy was changed and no retry occurred.

| Artifact ID | Bytes | ZIP SHA-256 |
|---|---:|---|
| 13426670165 | 896 | fcb90e4ffd44ecad979f06442fbd6737572c58072e769747ab98b8cecf30b320 |
| 13426131203 | 697 | 5340f25926f1325ed2271764771280aca798d08c1c4c0bf12dd0711b788bbabe |

Both ZIPs and the final **754778-byte** job log were downloaded/hash-verified. Full log SHA-256 **5a913dfb577d71f31254de4d81ceaf664c2bda6cee8a89c2e549dc37e6eb1bad**; selection JSON SHA-256 **54b40e0867a4e906e3a71e2075afd4fed1576a7a9fed30a92d1753a844d4db07**. Ordinary CI **42047369123 passed**; verified redundant exact-source single-Mac prototype push **42047369404 was cancelled**, not passed. Original package/runtime failures remain unchanged. This native test run makes no installer/ordinary-account/UAC/hardware qualification claim.
