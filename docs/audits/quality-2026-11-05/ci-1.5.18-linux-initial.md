# Separate Linux runtime-only 1.5.18 check — FAILED

[Run 41999011743](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41999011743) consumed the verified Linux artifact from original failed [run 41987734820](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41987734820), without rebuilding. Package source remains `0b7c669663841c2e55569b0c21c76ad03805cad7`; workflow checkout `384ca7afab84821a08ae3e8ca7cd3c5664aa7f73` has the same workflow/application inputs (workflow blob `3ac20c46e3e101f04369d7f39645f26559847824`). This separate failure does not replace the canonical failure or its skipped runtime jobs.

| Job | Conclusion |
|---|---|
| Linux runtime-only container acceptance127149254596 | FAILURE |
| Windows runtime acceptance127149256962 | SKIPPED |
| prototype127149257802 | SKIPPED |

Runtime image build, exact package payload hash check and loader audit passed. Worker acceptance stopped at `linux-worker-acceptance.py:37`, requiring `catalogue_count == 97`. Exact frozen and packaged `plugins.py` have 98 registry entries and identical SHA-256 `435e17db5303078a7064186d072cd9db20e0794ee9ea2945160a3a489f2a8775`. The self-test returns registry length. Its ID/ok/engine/QSO assertions passed first. The actual result is not retained because `worker.json` is written after assertions. This establishes stale QA expectation; it does not establish successful full runtime acceptance. No source edit, assertion relaxation or rerun was performed.

GUI, X11/Wayland launches, framing cases, relaunch and archive relocation were **NOT RUN**. Runtime `user.txt`, `os-release.txt`, screenshots and acceptance JSON were never reached. Container configuration records user `acceptance`, and the non-root/toolchain-absence guards passed; no actual UID/GID was collected. Runtime loader audit identifies `libwebkit2gtk-4.1-0:amd64	2.52.6-0ubuntu0.24.04.1	amd64`. Docker ran with network disabled and all capabilities dropped. This is a container harness, with no ordinary-desktop, radio/rotor, account or Windows installer acceptance.

Verified report artifact 13400814924:43581bytes, SHA-256 `5c472eb55544f03d622994157ffa393fb9caef43899e7ae615640da274b10ca9`. All five emitted files and full raw job log are preserved privately; exact file hashes, every job/step and package hashes are in [ci-1.5.18-linux-initial.json](ci-1.5.18-linux-initial.json). Original Linux DEB SHA-256 `a49d9210951f55bc5f830888f69c3b0530a4f5b1b276230d44519ec6fdbe1b27`; archive `b76b68eaec34999385da69a9bd23d7c96330bdda4d75c7b7dfd803fc11892deb`.

QA commit `be96ec25c245ff51810ffbd6a5f7f6d3ddf274dc` subsequently synchronized
the strict expected count and fixture with 98 and preserved self-test output
before validation. The [separate successful recheck](ci-1.5.18-linux-runtime.md)
records that executor source and unchanged package bytes. This initial failed
result remains immutable.
