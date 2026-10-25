# macOS 1.3.19 recorder candidate

**REJECTED — not a delivery candidate.** Exact compiled source `9dfde2be3d64fff45fbd5163ae67476a34cd0f4b`. Packaging, Developer ID signature and 21 exact-source native recorder tests passed, but the packaged Swift fixture used a macOS `/var` temporary root that the Python host correctly rejected. No installation or audio occurred. The acceptance harness was corrected and regression-tested; the next candidate is 1.3.20. This record preserves the rejected attempt; do not install it.

Composition: recorder feature `18ff24d2`, integrated source `b4cc01dfc2985cca680d9f2ea5a751889a83eb2e`, including all 1.3.18 fixes and installation receipt `f751ae05`. These are ancestry identities; the exact clean release commit compiled into the candidate is recorded in the post-build receipt.

Build from clean canonical `main` at `/Users/oliver/Documents/Projects/OM0RX-xLog` using `bash prototype/scripts/package-macos.sh`, with `CARGO_BUILD_JOBS=2`. The script records Git HEAD in distribution metadata and native code, builds/stages the actual Swift/Python worker and framework, signs all components with the available Developer ID and the minimal audio-input entitlement, and verifies the complete bundle. No installation script is run. Notarization is separate and not claimed.

Targeted source evidence is in [ACCEPTANCE.md](ACCEPTANCE.md) and [evidence](evidence). After signing, run the explicit `--recorder-acceptance` fixture and read-only `--recorder-audio-devices` enumeration from this exact bundle. The fixture uses generated native PCM and fresh temporary actual Python contest data; no input/output stream, station owner, production singleton/log/settings or permission prompt is permitted.

Physical acceptance remains **NOT READY**: Oliver confirmed audio is disconnected. Actual signed-app input permission, source content/channel attribution, separate listening/VOX route, unplug/format/clock trials, and the bounded real-time source soak remain external acceptance. No direct TCI/Flex/DAX or independent dual-device transport is included.

The active 1.3.18 application, its rollback bundles, station data and original recorder checkpoint remain preserved. Candidate identity, hashes, signature, fixture results and preservation readback will be added to the final receipt after packaging.
