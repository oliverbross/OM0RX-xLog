# macOS 1.3.23 candidate — callsign cursor and SCP recovery

The operator requested a new build to prepare for replacing the running app later. This task builds and verifies the candidate only; it does not install, launch or replace the active application.

Application change source: `71a2d5c05040bc61590a4eb68ad1faaa910f0b30`.

- Preserve the callsign/exchange cursor and selected range when an asynchronous save reply changes only letter case. Real shared-value replacements still apply normally.
- Recover the native SCP session scope from the Python host's saved active session after a worker restart. Cross-session/workspace checks remain enforced. Check Partial displays query errors directly and retries an existing corpus locally.

Validation already completed on the application changes: 187 detached-window tests, TypeScript/production frontend/window-bundle checks, and an isolated Chromium check of the actual input component preserving both a collapsed cursor and a backward selection during delayed uppercase replies. The SCP fix passed 19 focused native tests, including a real-host restart regression that failed with the observed `stale_context` error before the fix and passed afterward. The earlier 291-test SCP frontend suite passed before the cursor change.

Build only from clean canonical `main` with `CARGO_BUILD_JOBS=2 bash prototype/scripts/package-macos.sh`. The script records exact Git HEAD through `XLOG_SOURCE_COMMIT`, native and distribution provenance, refreshes the frontend, stages worker/Python resources and signs the bundle. Version 1.3.23 is reserved for this candidate. Exact packaged source, hashes, signature and retained candidate location are recorded below after packaging.

The installed 1.3.22 application's Info.plist, executable and worker hashes were captured before packaging for a final unchanged comparison. Installation acceptance remains separate and requires preserving the latest log/settings/recordings before replacement.
