# Native Import Cancel and POTA Close

Two bounded development native UI checks observed the intended controls dismiss their review/dialog and return successful retirement replies for the exact observed session owner. Stored QSOs were unchanged. Both observer captures are **partial campaigns**: neither reached its ten-minute ended marker. These are individual control observations, not a complete campaign, allocation measurement or release qualification.

The [sanitized numeric report](native-adif-controls.json), SHA256 `dac21c8beaa0c9d890540f5a85abea9fc459662e3e0726ad3b230b37cb3d0d88`, contains the complete bounded event sequences, successful matching-owner replies, component source evidence, hashes of retained private receipts and stopped-store checks. It excludes observer secrets, raw session tokens/generations, private paths, process IDs, fixture markers and contact payloads.

Application source was `16c1b6f8a6959c6eea5940605a754e1122dbd997`, including Swift matching-token/generation retirement, frontend owner retirement wiring and the guarded idle notification change. Exact clean checkout during both native sequences was `795f77c2a48302fda632b6e7434f9e511423fb55`. Its reviewed application-input equivalence to source16 was bounded to four documentation and six QA paths, full source diff SHA256 `6c1001a533864c9a070be5a10b6dae879e19e005d834a3cfa41a98454d6753a4`. The same development images were used for both checks:

| Component | SHA256 |
|---|---|
| Development host | `3ec30e14710c02e434c1d9767b80a5ddf32bd3c7bf690db9daf111628fb3cddb` |
| Development worker | `d8aa0ac2b007e93d7342c3bd35a9a7fb7b2b5ba017428b42787622996d92632f` |
| Transfer observer preparation | `62beb49b30926805d4de69c0d00c078de0ced4791385c9dec261678c76916c25` |

This was a proper macOS development `.app` fixture with the required integration profile metadata and distinct disposable private roots, running source-equivalent frontend code through Vite. The observer did not transform product sources. It wrapped public import/export invocation and delegated each call once, preserving arguments, options, reply and rejection. It did not issue extra worker RPCs, inject native input, introduce artificial gating delays, replace product timers or collect CPU. Instrumentation overhead remained present. Its limits were 128 calls, 256 events, 16 owner aliases, 64 concurrent observed uses and 600,000 ms; bounded strict batches contained no QSO text or file bytes. Only the root controlled native UI through CUA.

Before every native binding/input the root positively checked the exact live host executable and complete private-root arguments, plus its matching child worker coordinates. Both fixtures used the source-validated `normal_logging` enum, disabled external station I/O and a blank operator draft. The fixtures used synthetic data only. No installed production app, production log, connected station, upload or hardware was used.

| Individual control check | Import Cancel | POTA Close |
|---|---:|---:|
| Stored physical/live QSOs before and after | 100,000 / 100,000 | 2 / 2 |
| Root-observed preview | 1 validated incoming contact, 0 duplicates | 2 physical, 2 included, 12 derived records, 2 files |
| Trusted observed control count | 1 | 1 |
| Persisted event count / batch count | 5 / 5 | 9 / 8 |
| Matching successful retirement event sequence | 5 | 9 |
| In-memory owner alias | import-1 | export-1 |
| Observed owner RPC uses at retirement reply | 0 | 0 |
| Unattributed same-method RPC uses at reply | 0 | 0 |
| Dropped events | 0 | 0 |
| Campaign ended marker | false | false |

For Import, the root selected the 76-byte synthetic ADIF file. The review showed one validated incoming contact and zero duplicates. The root clicked the actual **Cancel import** control, observed the review controls disappear and retained contact count 100,000. Confirm was never used. The persisted retirement reply reported `matchesObservedBegin=true`, `workerOK=true`, `retired=true` for `import-1`; the root inspected this receipt before ordinary Quit. The incoming record was previewed, not imported.

For POTA, a separate fresh private workspace contained exactly two synthetic contacts before host launch. Their explicit station/operator/grid/power fields were `K1TEST/P`, `K1TEST`, `FN31PR` and 37 W, with own parks `SK-0001,SK-0002`, own state `SK-BL` and three contacted parks. Supported settings CAS configured local mode, disabled automatic sync and completed setup. The setup worker ended through actual EOF before launch. No contact-writing setup RPC ran after the native UI began. The root observed a valid frozen preview with two physical and included contacts, 12 derived records and two files, then clicked the actual enabled **Close POTA export** control and observed the dialog disappear. Save, a native chooser and export-file publication were not used. The persisted matching `export-1` retirement reply reported the same three true flags before ordinary Quit.

| Observed asynchronous dispatch-to-reply wall time | Seconds |
|---|---:|
| Import preview against 100,000 stored QSOs | 8.741 |
| Import retirement | 0.584 |
| Two-QSO export begin | 0.134 |
| POTA preview | 0.021 |
| POTA file metadata | 0.006 |
| Export/POTA retirement | 0.027 |

These durations subtract the correlated dispatch and reply event timestamps for the same observed call. They include development/Vite transport, scheduling and private-observer overhead, with the VM running during these ADIF checks. They are asynchronous wall time, not CPU time, isolated Swift operation timing or a two-second responsiveness qualification; the 100k preview exceeded two seconds. The focused headless worker lifetime report's approximately 0.177-second import-retire wire time used different measurement boundaries and load, so it is retained as a separate observation rather than substituted for the 0.584-second native result.

These replies demonstrate that retirement was accepted for the owner coordinates compared in memory by the observer. The preceding trusted control was linked within a bounded temporal window; that association is not causal proof. Zero observed RPC-use counters cover this invocation wrapper. They do **not** establish that every frontend async user had drained: that field remains `UNKNOWN`. No raw token or generation was persisted or published. The service's lock-serialized ownership and automatic release behavior are covered by the separate focused Swift tests and [worker lifetime correction](preview-export-lifetime-correction.md); a successful native retire reply alone does not measure freed allocations or physical footprint.

Both cases ended through the root's ordinary native Quit after inspecting the matching reply, then process-only absence checks. Neither helper sent an app or worker signal. The original exclusive Popen owners stopped only their own Vite servers through explicit root-requested TERM; both observed exit code 143 and an absent loopback listener. No direct process wait handle remained for the app-owned worker, so its actual exit code is unknown and is not labelled measured EOF0.

| Stopped stored-QSO check | Import fixture | POTA fixture |
|---|---|---|
| Integrity | ok | ok |
| Physical/live rows | 100,000 / 100,000 | 2 / 2 |
| Before and after ordered stored-QSO SHA256 | `c890ab242dca96dd196217168a1f05dcc299b1ba6a2e877149abbddeaea59af2` | `4b73f9a52f96186b5bbac6080596d96b70ac11a0288de589e49de89574a1f072` |

Hashing streamed all 12 stored columns in local-ID order: `local_id`, `wavelog_id`, `call`, `qso_start`, `band`, `mode`, `frequency_hz`, `is_dirty`, `deleted_at`, `updated_at`, `record_json` and `baseline_json`. Each typed value was length-prefixed before SHA256, retaining exact stored JSON/BLOB bytes rather than canonicalizing them. Thus the equality covers stored contact contents and unknown ADIF data present in those columns, not just displayed contact counts.

After positive process absence, normal read-only/query-only SQLite backup honored the source WAL. Only a diagnostic destination was normalized to DELETE journal mode and closed, then copied as a MAIN-only file for normal read-only integrity and all-column hashing. Both final copies had journal header1/1 and no WAL/SHM. Source main/WAL hashes remained unchanged during each read. Physical equality across the complete application lifetime is not claimed; application activity/checkpointing may change database files while preserving stored QSOs. Python SQLite runtime was 3.53.4, independently labelled from bundled Swift SQLite.

Native controls are now observed for these development inputs. Packaged candidate Close/Cancel behavior, native Save/chooser cancellation, complete ten-minute observer campaigns, all-frontend-user drain, CPU, full memory, connected equipment and ordinary OS qualification remain outside these checks. Candidate 1.5.21 remains held; the installed daily baseline and public-release disposition are unchanged.
