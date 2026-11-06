# Signed macOS 1.5.22: isolated transfer and restart evidence

The signed 1.5.22 candidate completed a bounded native two-contact import/export/POTA journey and same-root restart. Native chooser and review cancellation, duplicate skipping, published export bytes and durable data checks passed within that scope. This is not a whole release, large-log, memory, CPU or equipment qualification.

The [sanitized receipt](native-1.5.22.json), SHA256 `8f4295c393ee01a90f1e8e6624b4d559795bfb2dbf0218592a81dd2c477246ce`, separates sealed artifact evidence, root-observed native controls, stopped-store checks and independent export-byte validation. Private paths, process IDs, fixture identifiers, account details and session coordinates are omitted.

| Signed artifact | Value |
|---|---|
| Version / frozen source | 1.5.22 / `fc7909d63aa0f4d9fd9abf278c2b08bfd557cdd5` |
| ZIP SHA256 | `01dc4cbc5544efa251c3b83f7732ab897c8164da82b85c749767dbf8d8db8fb4` |
| Host SHA256 | `da3d4834421e854454f4d414773cf94b19a52394278ea49d9849406d63d22c7a` |
| Worker SHA256 | `80b4b6da225d4c2a2e1f82d513ed35e02905a9acec1865eab3c03e5579157390` |
| Build manifest SHA256 | `12636d537a3fbd06bafa6d6859eec62755f072687fb0e5d1f1c2fc931b3af9b9` |

The canonical recipe's invocation was recorded before compilation. The recipe exited0 with final source guard passed; its retained result matches the archive and separately signed executable hashes. Both images are arm64 with matching Developer ID authorities. Deep strict bundle and worker signature checks passed. Nine signed-worker tests passed with no failures or skips. The privacy scan passed over3,546 files with no findings. Build-manifest input hashes describe pre-sign files; signed executable hashes above are separate. The artifact-only extraction seal's no-launch flag applies to extraction, not the later native journey.

The root explicitly launched a fresh marked offline native-quality root with source-validated `normal_logging`, disabled external station I/O and synthetic data only. Exact host/worker PID, executable, complete private-root arguments and matching child coordinates were positively checked before native binding/input and again for the explicit restart. The exact candidate app was bound through CUA. Setup used `K1TEST`/`FN31PR`, skipped radio/rotor and rendered Desk, then an empty Logbook.

The 630-byte ADIF fixture had two records (`K1SYN`, `K2SYN`), strict UTC date/time,20m/SSB/14.250MHz, explicit station/operator `K1TEST`, own grid `FN31PR` and37W. Its SHA256 was `8e846fec87e1e141d36704bafcacee3015da8067af3f5b5c5443f28381ffda3c`. Own parks were `SK-0001,SK-0002`, state `SK-BL`, and contacted parks `US-0001,US-0002,US-0003`. Length-tagged UTF-8 ADIF fields and POTA reference syntax were checked against the owning ADIF/QSO/POTA code; park syntax does not establish sponsor-directory eligibility. Imported37W is source ADIF data, not a new first-draft/default-power capture test.

The root observed these native results in order:

| Stage | Actual observation |
|---|---|
| Empty transfers | Export all said no QSOs without a chooser. Import chooser explicit Cancel returned Logbook0. |
| Import review Cancel | The reviewed fixture showed2contacts/0duplicates; explicit Cancel returned Logbook0. |
| Import confirmation | Reopened the fixture; Confirm imported2/skipped0. |
| Standard export | Save chooser Cancel produced the cancellation notice; repeated Export all and Save reported2exported. |
| POTA frozen preview |2physical/2included/12derived records/2files; each own park2contacts/6records. Captured `2026-11-06T01:18:57Z`. |
| POTA chooser Cancel | After the review checkbox, save chooser Cancel retained the same captured preview and enabled Save. |
| POTA publication/Close | Repeat Save reported2ADI files plus manifest. Explicit Close dismissed the dialog. |
| Duplicate consent | Reimporting the same fixture showed2duplicates; Confirm imported0/skipped2 and Logbook stayed2. |
| Ordinary Quit/restart | App-menu Quit, stopped proof and durable check passed. Explicit same-root restart with fresh proof retained `K1TEST`/`FN31PR` Desk without onboarding and Logbook2 with calls/date/frequency/comments. Second app-menu Quit, stopped proof and durable check passed. |

Independent stopped-file validation parsed the saved exports as strict UTF-8, byte-length-tagged ADIF, checked all imported station/grid/power/date/time/frequency fields and verified each POTA own-park/contacted-park cross-product. The POTA manifest retained the same captured instant,2physical/2included/12derived records, two files, zero issues and no embedded file text. Only the two listed ADI files and manifest existed in the published set. Every published file's hash remained unchanged during read-only validation.

| Published artifact | Bytes / records | SHA256 |
|---|---|---|
| Standard ADIF |636 /2 | `1ef13d9378e754cb43214b93c8a5f332657b57a41538f815ffff725c1ee0b63a` |
| SK-0001 POTA ADI |2,100 /6 | `8367988c7bc785711b195cb07972cb8bb87e19f49154a7b05502c889d92f73bd` |
| SK-0002 POTA ADI |2,100 /6 | `82fb134919bdf04a51449d1ad5f2bd60649a4435de9e4764547fdbc571f950ce` |
| POTA manifest | JSON | `7bdae0e5f904c041cd9ef71fc4f84b1df661f009bb7101f18a8b56ce60abe781` |

The standard export semantically matches the two source contacts; it is not claimed byte-identical to the630-byte input. The shipping writer normalizes interchange serialization, including frequency precision.

Both stopped-store checks passed integrity and exactly2physical/live contacts. The ordered all12stored-column SHA256 was identical before and after restart: `5fcb86038f62ea82d213ec2336dc561301b222a9ed73fb0d50a8a5852716dd53`. It streams `local_id`, `wavelog_id`, `call`, `qso_start`, `band`, `mode`, `frequency_hz`, `is_dirty`, `deleted_at`, `updated_at`, `record_json` and `baseline_json` in local-ID order, with typed length-prefixed values and exact stored JSON/BLOB bytes. This covers stored-QSO equality across restart, not just displayed counts. Configured local/onboarding/station/grid settings and explicit imported POTA/37W fields also matched.

Each store read followed process-only candidate/root/known-PID absence. Source normal read-only/query-only SQLite backup honored WAL; only a diagnostic intermediate was normalized to DELETE/closed, then copied as a MAIN-only file for normal read-only integrity/hash. No immutable read, source checkpoint or source PRAGMA tuning was used. Source main/WAL hashes stayed unchanged during each read. Whole-database physical equality across the application lifetime is not claimed. No app/worker signal was issued; ordinary Quit and absence do not provide an actual app-owned worker exit code or measured EOF.

**Scope limits remain explicit:** no signed22 matching-retirement RPC reply was captured, universal frontend async-user drain remains UNKNOWN, and signed-worker300-second expiry/live allocated heap/CPU were not measured. The prior [development native owner observations](native-adif-controls.md) and [worker lifetime correction](preview-export-lifetime-correction.md) retain their own source, instrumentation and workload bounds; they are not relabelled as this signed binary's measurements. This two-contact journey does not repeat100k/representative workloads, qualify the unresolved ordinary Windows behavior or establish full platform/equipment qualification, notarization, a daily install or public release.
