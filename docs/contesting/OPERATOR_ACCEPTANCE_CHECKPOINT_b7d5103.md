# Clean eight-session operator checkpoint

Status: accepted bounded headless UI and real isolated worker test; full contest, packaged application and sponsor acceptance remain open.

## Source and scope

The reviewed eight-case harness `276441be42e6fffd05bcdbc54c269fc41ab9f1db` was combined with the current contest foundation `89bff236cf58e917b19dced947f48c803de95b25` at clean source **`b7d51036a2cf536ed2af009f52330384c6c1ae8b`**. Combined validation compiled/discovered the SwiftPM test host, verified one ordinary opt-in skip, passed all 144 contesting frontend tests, and passed TypeScript/Vite/window-bundle checks. The final full acceptance used a fresh private scratch directory and unchanged clean source before and after execution.

The production ContestWorkspace and mutation owner ran in headless Vite against the real LiveWorker, contest lane and SQLite repository in the isolated Contesting Test profile. No station, keying, radio, audio, PTT or credential adapter was supplied. All exports stayed under the private acceptance output. The normal workspace ended with zero contacts, pending synchronization entries and outbox entries.

Each of CQ WW CW, CQ WW SSB, CQ WPX CW and CQ WPX SSB ran both Run and Search & Pounce: eight sessions with three initial contacts each. CW used 14.025/7.025 MHz; SSB used 14.250/7.120 MHz. A post-restart WPX contact used 21.025 MHz. These synthetic frequencies do not establish regional operating eligibility.

## Results

- 291 ordinary worker frames plus two lifecycle frames; 25 successful contact commits, 16 serial reservations, 16 exports, and ten screenshots.
- Each WW session: seven points, six band-scoped multipliers, score 42. Each WPX session: eleven points, two prefixes, score 22, including doubled intercontinental points on 40 metres.
- Eight authoritative invalid-exchange blocks and eight duplicate blocks. Invalid entry produced no reserve, commit or simulated output. Run duplicates produced exactly one QSOB4; Search & Pounce duplicates stayed silent. Neither committed a duplicate.
- Independent sent-exchange checks required WW `15` and WPX `001`, `002`, `003` rather than trusting export output as its own oracle.
- Both Cabrillo and ADIF were read, hashed and parsed for every session. Assertions covered contest/mode, reports, raw exchanges, serial fields, callsigns, frequencies, bands, UTC timestamps matched to committed receipts, QSO count and recomputed score metadata. Cabrillo claimed-score headers matched the fixed oracle.
- After restart, authoritative correction receipts contained WW `04` and WPX `126`. Deletion changed WW to six points/four multipliers/24 and WPX to nine points/one multiplier/9.
- After deletion, DL1ABC/40m became clear while retained K1ABC/40m remained duplicate in both sessions. WPX retained its existing reservation `004`; the next contact committed that reservation and reached twelve points/two multipliers/24 without reusing a deleted contact's serial.
- Forced response and shutdown stalls reaped the owned host and Node processes with no lingering PIDs. A TERM-ignoring descendant probe escalated to SIGKILL and reaped both processes. Spawn-failure handling also passed.
- Protected production database metadata was unchanged.

Root inspected the clean-source evidence, verified its hashes, and viewed the WPX SSB Search & Pounce screenshot, including the integrated human-readable prefix labels.

## Evidence

All paths are local acceptance artifacts; source and this report are committed separately.

| Artifact | Path / SHA-256 |
| --- | --- |
| Output root | `/Users/oliver/.codex/build/contest-operator-eight-case-clean-b7d5103-20261018T093000Z` |
| Acceptance frames and results | `evidence/acceptance.json` — `8253992411d5bb4cb5005584f1f04a228c9b6c5a1e21f8bc71891d54402049cb` |
| Outer-runner provenance and probes | `evidence/outer-runner.json` — `8889baa28356b2f7db58af5a34ac3783ea9d84bff7bc4a481ac1ca1bbfced658` |
| Artifact checksum manifest | `/Users/oliver/.codex/build/contest-operator-eight-case-clean-b7d5103-20261018T093000Z-logs/artifact-sha256.txt` — `8b2da76a84a7d7d67820c48e4319f762c53f02b7a502fa66d9cc543b74a6f6c0` |
| Compiled test-host executable | `/Users/oliver/.codex/build/contest-operator-eight-case-clean-b7d5103-swift/out/Products/Debug/XLogPrototypeTests.xctest/Contents/MacOS/XLogPrototypeTests` — `9934c2804b136b783b9dae686970caf2788792b219b0009486bb671c2788cc3a` |

The `-logs` directory preserves raw outer-runner stdout/stderr and provenance. The committed runner records inner compilation/run stream hashes; those inner streams are not claimed as archived raw files. Earlier dirty development runs remain development evidence and are not substituted for this clean checkpoint.

## Open gates

This result does not cover SCP import/query/selection operator acceptance, all eleven catalog previews or all 94 upstream entries, crash recovery, long-session performance, current contest dates/categories, sponsor submission, native chooser/save dialogs, a packaged worker/app identity, native window lifecycle, hardware or RF timing. Main integration remains on the separate chat's runtime acceptance hold. The previous four-case report remains historical evidence; this report expands only the stated operator matrix.
