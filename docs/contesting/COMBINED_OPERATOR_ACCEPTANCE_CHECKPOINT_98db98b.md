# Combined contest operator checkpoint

Status: accepted bounded headless UI with real isolated workers for the four-profile Run/Search-and-Pounce matrix and Super Check Partial workflow; all-rule, native, and packaged application acceptance remain open.

## Source and runs

Both final runs used unchanged clean source **`98db98b0a12e43f02afd71bf4dd84cdba5b6fe1c`**. Each committed outer runner used its own fresh absolute SwiftPM scratch and private output root because neither runner accepts a precompiled host while retaining its source checks, forced-stall probes, and provenance manifest.

The SCP run completed 115 ordinary worker frames, six lifecycle frames, and two in-memory exports. It exercised import and invalid replacement retention, bounded ranking, selection ownership, serial and structured-field preservation, response races, one contact, Cabrillo and ADIF capture, restart/cache restoration, stale-selection rejection, and old-generation rejection.

The eight-session run exercised CQ WW CW/SSB and CQ WPX CW/SSB in both Run and Search-and-Pounce styles. It completed 291 ordinary frames, two lifecycle frames, 25 contact commits, 16 serial reservations, 16 independently parsed Cabrillo/ADIF exports, and ten screenshots. Its fixed independent expectations, correction/deletion rescoring, duplicate promotion, restart recovery, and serial non-reuse assertions are unchanged from the reviewed eight-session harness.

Both runs reported unchanged protected normal-database metadata. Their response and shutdown stall probes each reaped the XCTest host and Node descendant with no lingering PIDs. Source status and tracked diff were empty before and after each run.

## Evidence

| Artifact | Path / SHA-256 |
| --- | --- |
| SCP output root | `/Users/oliver/.codex/acceptance/contest-combined-scp-clean-98db98b` |
| SCP scratch | `/Users/oliver/.codex/build/contest-combined-scp-clean-98db98b` |
| SCP acceptance | `evidence/acceptance.json` — `1ae0e969b4990198094a7829acc52d3969bec45f2265ebac7fe8b278499ba222` |
| SCP outer provenance | `evidence/outer-runner.json` — `8b9b42b082b87814d8e8398a1120005db429aaaf8c024a0ab8677f8e3ff0e101` |
| SCP compiled host | `/Users/oliver/.codex/build/contest-combined-scp-clean-98db98b/out/Products/Debug/XLogPrototypeTests.xctest/Contents/MacOS/XLogPrototypeTests` — `815dd23775db7b84a618ddaaafbfec4d9071ff71bd42b01bfa51f95c2532f008` |
| Eight-session output root | `/Users/oliver/.codex/acceptance/contest-combined-eight-clean-98db98b` |
| Eight-session scratch | `/Users/oliver/.codex/build/contest-combined-eight-clean-98db98b` |
| Eight-session acceptance | `evidence/acceptance.json` — `dc004583e6aa97fe38a59716eb1fb47889b4c2ff9d7c6f6fd0186504de8af74c` |
| Eight-session outer provenance | `evidence/outer-runner.json` — `93d62b5c30523aa9f9fe2ce59875e914ad43a206ba7f865ad4489988dde0eb81` |
| Eight-session compiled host | `/Users/oliver/.codex/build/contest-combined-eight-clean-98db98b/out/Products/Debug/XLogPrototypeTests.xctest/Contents/MacOS/XLogPrototypeTests` — `d49c8c5bb14357f61c61cdf53659fffb48939fe4a659b88786505c31403e571d` |

The SCP runner preserves bounded raw build, run, and probe streams. Their hashes are recorded in its outer manifest. The current eight-session runner records bounded stream hashes in its outer manifest but does not persist those inner raw bytes; this checkpoint does not claim otherwise.

## Open gates

The SCP generation case proves service rejection of an old-generation selection and route replacement of the old browser consumer. It does not prove that an already-mounted panel independently discovers an external generation change without that lifecycle transition.

The eight-session matrix covers four CQ pilot profiles. It does not cover operator workflows for NAQP CW/SSB/RTTY, ARRL RTTY Roundup station-direction cases, JIDX, SAC, Oceania DX, or the remaining upstream rules. Plain logging for profiles without audited simulated output remains separate from Run/Search-and-Pounce acceptance.

These runs use a headless development UI, loopback test bridge, and test-owned picker shim. They do not establish native chooser or save-dialog behavior, packaged application or worker identity, installation, native window lifecycle, crash recovery, current contest date/category eligibility, sponsor submission, network/provider authenticity, radio, RF, audio, PTT, credentials, or hardware timing. Protected metadata sampling is not an operating-system-wide read/write audit.
