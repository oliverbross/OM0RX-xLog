# Clean Super Check Partial operator checkpoint

Status: accepted bounded headless UI and real isolated worker test; packaged application and native chooser acceptance remain open.

## Source and result

The final run used unchanged clean source **`ef0d6474dcf4fa9eeb87d56f9711897f5cfd7dbd`**, a fresh SwiftPM scratch directory, and a fresh private output root. The browser rendered the production `ContestWorkspace`, callsign-assistance panel and client. A test-owned loopback bridge connected that UI to the compiled XCTest host running `LiveWorker`, the contest store, SCP importer/cache, scoring, and in-memory export pipeline under the Contesting Test profile.

The run completed 114 ordinary worker frames, six lifecycle frames, and two exports. It exercised valid import, invalid replacement retention, bounded ranking, callsign selection, reserved-serial and structured-exchange preservation, callsign/session response races, one committed contact, Cabrillo and ADIF capture, fully awaited worker restart, stale selection rejection, restored cache query, and old-generation selection rejection. Both forced response and shutdown stalls reaped their two owned PIDs with no lingering processes. Sampled protected normal-database metadata was unchanged. The committed source was clean before and after execution, and the run contained no duplicate-key, console-error, deadline, or failure marker.

## Evidence

| Artifact | Path / SHA-256 |
| --- | --- |
| Private output root | `/Users/oliver/.codex/acceptance/contest-scp-operator-clean-ef0d647` |
| Private SwiftPM scratch | `/Users/oliver/.codex/build/contest-scp-operator-clean-ef0d647` |
| Acceptance frames and assertions | `evidence/acceptance.json` — `cc9dbd3d91ca0788e27adf569357a21c7112bf2a1b17d6babebfa49e203b8496` |
| Outer provenance and cleanup probes | `evidence/outer-runner.json` — `a744dbf05809612e80aaef68ffd2a7fcd59bd85b848848cd719da6c944d9c1e2` |
| Compiled test-host executable | `/Users/oliver/.codex/build/contest-scp-operator-clean-ef0d647/out/Products/Debug/XLogPrototypeTests.xctest/Contents/MacOS/XLogPrototypeTests` — `7bf0a12a4d4db5c44e80a227ee85db17138867870659abeb47aa1c3e21c5c9c7` |
| Screenshot | `evidence/scp-operator-acceptance.png` — `9cfaf9c6afb7039809beecdc0ad6c71c2e658c292c28c58ca32aa194b105954a` |
| Cabrillo capture | `exports/scp-cabrillo.log` — `ab50113271299f6894d2dd73985d35186c0b45fde34be6e912932ef017250f85` |
| ADIF capture | `exports/scp-adif.adi` — `e1149e626b0c32b48c5377c7f4dedfbd44ac295dd0c1b38e8a66aef9c82e16bc` |

The outer manifest records the raw build and run streams. Build stdout/stderr hashes are `f063ec4b341fa307830a057ee1e4fd61e2ef2318375d4627084deac7f6a962f3` and `30c095238fefc56babc205a017b5fb3c6a477b5da95f633000eb88672d313e49`; run stdout/stderr hashes are `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` and `407901bb83846afdd7b5e7a5540c2de62adf27d0efbdeaf4dda89a454112a6ee`. Response-stall and shutdown-stall stderr hashes are `40fb60c6b30b3376be7dc5f2eabf39dcea04af73a5c1fffab48d6bdeae2f50d6` and `d7e19a9e6c85407e71e598ce62e56a0b5f1b9dc73a070c3adca55433f0f684e2`; their stdout streams are empty.

## Limits

The generation scenario proves that the real service rejects a selection from the replaced workspace generation and that route replacement retires the old browser consumer before its held reply is released. It does not prove that an already-mounted panel independently discovers an external generation change without that lifecycle transition.

This is a test-owned loopback picker shim and headless development UI, not the native operating-system chooser. It does not establish packaged application identity, native window lifecycle, installation, crash recovery, network/provider authenticity, sponsor submission, radio, RF, audio, PTT, credentials, or hardware behavior. The metadata comparison covers the named protected database files and sidecars; it is not an operating-system-wide read/write audit.
