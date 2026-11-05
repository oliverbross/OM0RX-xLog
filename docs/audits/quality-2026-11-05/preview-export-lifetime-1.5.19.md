# Signed 1.5.19 preview/export lifetime

Two distinct worker-only fixtures completed 20 replacement cycles: the unchanged generated 100k log for a tiny incoming ADIF preview plus a full 100k ADIF export, and a separate two-QSO synthetic station-populated log for successful POTA byte export. All replies were correlated; all four workers retired on clean stdin EOF. The controller subsequently exited 1 because its final assertion expected `invalid_request` while the correct confirmed response was `invalid_params`. This is a harness expectation error, not an application failure or an all-harness PASS. Post-replacement memory was not captured. Raw failure/script and all receipts are preserved; no new probe/repeat was run.

| Scope | Phase | Sample UTC | RSS MiB | Physical footprint MiB |
|---|---|---|---:|---:|
| generated | baseline | 10:46:50.578 | 36.94 | 23.63 |
| generated | first-import-preview | 10:46:58.017 | 637.59 | 630.64 |
| generated | first-full-ADIF-export | 10:47:02.744 | 686.53 | 629.80 |
| generated | replacement-cycle 1 | 10:47:04.197 | 686.78 | 629.91 |
| generated | replacement-cycle 20 | 10:51:07.155 | 865.78 | 871.95 |
| generated | quiet-after-last-replacement-60s | 10:52:09.378 | 351.73 | 559.06 |
| generated | quiet-after-last-replacement-310s | 10:56:19.380 | 13.91 | 559.11 |
| generated | after-expired-request | 10:56:21.572 | 17.62 | 559.11 |
| tinyPOTA | baseline | 10:46:51.628 | 29.75 | 14.41 |
| tinyPOTA | replacement-cycle 1 | 10:47:05.262 | 19.77 | 15.64 |
| tinyPOTA | replacement-cycle 20 | 10:51:08.251 | 18.66 | 15.91 |
| tinyPOTA | quiet-after-last-replacement-60s | 10:52:10.439 | 17.34 | 15.69 |
| tinyPOTA | quiet-after-last-replacement-310s | 10:56:20.439 | 13.81 | 15.69 |
| tinyPOTA | after-expired-request | 10:56:22.637 | 16.27 | 15.69 |

Generated active-cycle sampled footprints ranged 511.02–1031.85 MiB and were nonmonotonic. Active high-water and quiet settled values are separate observations; post-replacement memory is unavailable. All samples are retained in JSON; sampled maxima are not transient peaks.

After more than 300 seconds without further RPCs, ADIF, import-preview and POTA reads rejected expired tokens. The rejection is eligibility evidence, not evidence of memory release. Source guards do not clear `adifPreview`, `adifExport` or `potaExport`. The sole-client trace and unchanged source therefore imply those owners remain until replacement/worker retirement. A fresh ADIF Begin replaced the generated export with one selected record and created a fresh two-record tiny export. Owning code clears POTA on Begin; the corresponding read returned confirmed `invalid_params`, as that code specifies when no retained preview matches. Post-replacement footprint/RSS is explicitly unavailable because the harness then stopped on its wrong expected label. No actual GUI close/cancel was tested.

One bounded heap/vmmap observation ran during post-20 quiet after the 60-second sample, before expiry requests. It found 807,016 current allocated blocks totaling 550,446,624 bytes (524.95 MiB). This is substantial allocated storage, not just an inference from process footprint. It is not a full ARC retaining-path graph. Source/heap types support the existing-import-index and frozen-export owners:

| Heap type | Allocations | Allocated MiB |
|---|---:|---:|
| `Swift._DictionaryStorage<Foundation.UUID, XLogCore.QSO>` | 1 | 212.047 |
| `Swift._DictionaryStorage<Swift.String, Swift.String>` | 200,003 | 122.114 |
| `Swift._ContiguousArrayStorage<XLogCore.QSO>` | 100,000 | 85.449 |
| `Swift._DictionaryStorage<XLogCore.SemanticQSOIdentity, Swift.Int>` | 1 | 32.000 |
| `Swift._DictionaryStorage<XLogCore.SemanticQSOIdentity, Swift.Array<XLogCore.QSO>>` | 1 | 22.047 |
| `Swift._ContiguousArrayStorage<XLogCore.ADIFRecord>` | 1 | 4.000 |
| `Swift._ContiguousArrayStorage<Foundation.UUID>` | 1 | 1.531 |
| `Task stack` | 5 | 0.006 |

The general string dictionary type is shared and cannot all be charged to export. Heap/vmmap were an observer-on phase; they can affect pages/timing/residency. Later expiry samples carry that history. No unbounded leak or original high-memory incident is established.

The generated fixture had blank recorded station/operator fields, so successful POTA used a separately authorized two-QSO root. It produced two 40,914-byte files, 12 derived records, four bounded reads per file plus a final empty chunk; all 20 reconstructions had identical hashes. Full 100k POTA preparation was intentionally rejected under the existing 32 MiB/50,000-derived-record budget; it is not counted as successful full-log POTA export. Only 76-byte incoming preview text was needed to retain the existing 100k duplicate indexes; exact bytes are in JSON.

Both fixtures passed recovered post-EOF integrity and ordered stored-QSO hash checks through normal readonly/query-only SQLite backup with WAL honored. All 100,000 original rows and the two synthetic rows were preserved; original generated input main-file hash still matched its pinned source. Each stopped measurement source main/WAL remained unchanged during the backup checks. No production store, GUI, network or station output was used, and no source change/rebuild was made.

Artifact source `72a5926c2878ceedf70789ff4bae619ae5e14511`, version `1.5.19`; worker SHA256 `a34ca68f95b8a03b27e9eb9ea09034cfc83b7f4c7593fbc0bf615e7dbfe93c43`. Exact host/ZIP/sealed-manifest hashes, units, all samples, expiry receipts, byte hashes and fixture checks are retained in sanitized JSON. Private PID/root/marker/traffic and raw observer evidence remain local.
