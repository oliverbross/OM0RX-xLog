# macOS 1.3.23 candidate — callsign cursor and SCP recovery

The operator requested a new build to prepare for replacing the running app later. This task builds and verifies the candidate only; it does not install, launch or replace the active application.

Application change source: `71a2d5c05040bc61590a4eb68ad1faaa910f0b30`.

- Preserve the callsign/exchange cursor and selected range when an asynchronous save reply changes only letter case. Real shared-value replacements still apply normally.
- Recover the native SCP session scope from the Python host's saved active session after a worker restart. Cross-session/workspace checks remain enforced. Check Partial displays query errors directly and retries an existing corpus locally.

Validation already completed on the application changes: 187 detached-window tests, TypeScript/production frontend/window-bundle checks, and an isolated Chromium check of the actual input component preserving both a collapsed cursor and a backward selection during delayed uppercase replies. The SCP fix passed 19 focused native tests, including a real-host restart regression that failed with the observed `stale_context` error before the fix and passed afterward. The earlier 291-test SCP frontend suite passed before the cursor change.

Build only from clean canonical `main` with `CARGO_BUILD_JOBS=2 bash prototype/scripts/package-macos.sh`. The script records exact Git HEAD through `XLOG_SOURCE_COMMIT`, native and distribution provenance, refreshes the frontend, stages worker/Python resources and signs the bundle. Version 1.3.23 is reserved for this candidate. Exact packaged source, hashes, signature and retained candidate location are recorded below after packaging.

The installed 1.3.22 application's Info.plist, executable and worker hashes were captured before packaging for a final unchanged comparison. Installation acceptance remains separate and requires preserving the latest log/settings/recordings before replacement.

## Verified candidate

- Version **1.3.23**, exact packaged source **`9c8d648caed13d24745392551c878c90b7a750fa`**. The native executable embeds this source identity and distribution metadata agrees.
- Retained bundle: `/Users/oliver/Documents/Builds/OM0RX-xLog-1.3.23-contest-input/OM0RX-xLog.app`.
- Executable SHA-256: `69309b44aed61e76050a9067dac7a186e66f57917f2b1b16b5d374b0e75b0e7f`.
- Worker SHA-256: `dc505417eb9fd0f4e2f302125cea077c1dc5e964fb561e7ff134b3d68f780d57`.
- CDHash: `d342266e9809b66d2874927e5e2ddd8222fa5fdc`.
- Developer ID Oliver Bross (`4WCMQ4U946`), Hardened Runtime; deep/strict code-signature verification passed on the retained copy. Notarization is not claimed.
- Packaging passed its six Mac staging checks, worker self-test, production frontend/TypeScript/window-bundle checks and nine Python relocation checks.
- Retained candidate Info.plist, executable and worker hashes match the package output. The complete build log and `candidate-receipt.json` are beside the retained bundle.
- Installed `/Applications/OM0RX-xLog.app` remains **1.3.22**. Its Info.plist, executable and worker hashes match the pre-build snapshot. The candidate was neither launched nor installed; the running contest/recording session was not interrupted by this task.

The candidate is ready for a later operator-authorized replacement. Preserve the latest application data and finalize any active recording before using the repository installer; retain the replaced app for rollback. Installed-app behavior remains unverified for this candidate until that replacement is performed.
