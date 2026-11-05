# Canonical 1.5.18 CI — terminal disposition

**HELD — FAILED.** [Original run 41987734820](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41987734820) used application/workflow source `0b7c669663841c2e55569b0c21c76ad03805cad7`. Windows stopped at the installer clean-source guard before NSIS. This original result remains failed; its downstream native runtime jobs remain skipped.

| Job | Result |
|---|---|
| [prototype (windows-2022)](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41987734820/job/127112949366) | FAILURE |
| [prototype (macos-15)](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41987734820/job/127112949377) | SUCCESS |
| [prototype (ubuntu-24.04)](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41987734820/job/127112949401) | SUCCESS |
| [Windows runtime acceptance (scope matrix skipped)](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41987734820/job/127146899152) | SKIPPED |
| [Linux runtime-only container acceptance](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41987734820/job/127146899427) | SKIPPED |

All three platforms passed frontend/core tests. macOS/Linux build jobs passed. Windows worker, framing, dummy lifecycle, desktop build and portable packaging passed; installer packaging failed and distribution upload was skipped. No Windows distribution or installer artifact was emitted.

Failure: `package-windows-installer.ps1:34`: “Commit source changes before packaging; installer provenance requires a clean canonical checkout.” The guard did not print dirty paths. Full private log: `job-127112949366-full.log`, lines 24875–24880. Uploaded Cargo.lock/package-lock.json have only checkout CRLF differences; normalized content matches source.

## Verified distribution packages

| Package | Bytes | SHA-256 |
|---|---:|---|
| OM0RX-xLog-1.5.18-Beta-Linux-x64.deb | 62065604 | `a49d9210951f55bc5f830888f69c3b0530a4f5b1b276230d44519ec6fdbe1b27` |
| OM0RX-xLog-1.5.18-Beta-Linux-x64.tar.gz | 82528773 | `b76b68eaec34999385da69a9bd23d7c96330bdda4d75c7b7dfd803fc11892deb` |

Both Linux package checksums match published sidecars; runtime manifests identify version 1.5.18 and source `0b7c669663841c2e55569b0c21c76ad03805cad7`. This proves package identity, not runtime acceptance.

## Preserved GitHub artifacts

| Artifact | ID | Bytes | ZIP SHA-256 |
|---|---:|---:|---|
| [portable-swift-pins-windows-2022](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41987734820/artifacts/13400642937) | 13400642937 | 4263 | `e1fb8dedc65bd5cac23e995885f2e9a7c8ac096d8ea954adeae79ca099def58a` |
| [xlog-prototype-windows-2022](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41987734820/artifacts/13400578199) | 13400578199 | 35584099 | `c2b08a9abc616ac74d234b87f8692ad18be319bcef1f01e3cb0ce58eee030488` |
| [portable-swift-pins-ubuntu-24.04](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41987734820/artifacts/13398677287) | 13398677287 | 5583 | `bafbb9327a95ac49c5f989b3319ec3bed1e8386fd19881e99bd5de5f58c36955` |
| [xlog-prototype-ubuntu-24.04](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41987734820/artifacts/13398238442) | 13398238442 | 38527693 | `57328dc914b387470836196c1c786ca53292707a3b997956104b5d434df534e6` |
| [xlog-prototype-macos-15](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41987734820/artifacts/13398124904) | 13398124904 | 27940197 | `89f87b7ddbf491633c99380d4c229dda130f764fb7b930437440885d98696154` |
| [xlog-runtime-linux](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41987734820/artifacts/13398058668) | 13398058668 | 315705297 | `e19dbc9b4c5f86387a135b5592bc7603be42d432c348ae11075f8b70b548af4f` |

All six downloaded artifact ZIP hashes match GitHub's artifact digests. [ci-1.5.18-original.json](ci-1.5.18-original.json) retains exact names and every job/step conclusion.

## Native acceptance boundaries

The original Linux and Windows runtime jobs were **SKIPPED**. There are no runtime account, OS/WebKit/WebView2, actual installer path, scope, uninstall or preservation receipts to report. Both Windows installer scopes, ordinary-user/UAC, upgrade/reinstall, physical radio/rotator and normal consumer-desktop outcomes are **NOT RUN** here. Build-runner versions are not substituted for runtime observations. Local signed macOS acceptance/stress evidence belongs to root's separate record.

A separately authorized [Linux runtime-only check 41999011743](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41999011743) consumes the unchanged Linux artifact from this failed run without rebuilding. Its workflow checkout is documentation-only `384ca7afab84821a08ae3e8ca7cd3c5664aa7f73`; workflow blob `3ac20c46e3e101f04369d7f39645f26559847824` matches original. It completed FAILED at a stale 97 catalogue assertion against the exact 98-entry package, before GUI. Its separate report is [ci-1.5.18-linux-initial](ci-1.5.18-linux-initial.md); it cannot replace this failure or rewrite skipped jobs.

[Ordinary CI 41987671520](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41987671520) passed; [Contest portability 41987671423](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41987671423) passed all seven jobs.

## Preserved earlier dispositions

- [Run 41978769883](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41978769883): SUPERSEDED after separately demonstrated native first-QSO own-station field loss; cancellation is not a pass. Evidence: `../run 41978769883/inventory.json`.
- [Run 41983234450](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41983234450): HELD/SUPERSEDED after Linux frontend first-editor-input failure; Linux job remains FAIL, other unfinished jobs CANCELLED. Evidence: `../run 41983234450/inventory.json`.
- [Run 41987671424](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41987671424): CANCELLED as explicitly authorized redundant Mac-only validation; not a pass. Evidence: `../run 41987671424/final-jobs.json`.

No production installation or public release was performed by this inventory. Raw logs/environment data stay private; this report contains no signed temporary download URLs.


Separate QA-corrected [Linux recheck 42000560531](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42000560531) passed against the unchanged package, with bounded container-native coverage and equipment skipped. See [ci-1.5.18-linux-runtime](ci-1.5.18-linux-runtime.md). Neither original failure is rewritten.
