# macOS 1.3.20 recorder candidate

Package only; no installation, recording, playback or station action is authorized by this receipt.

Composition: recorder implementation `18ff24d2`, preserved current 1.3.18 source/receipts through `f751ae05`, and the tested acceptance-root fix `1553574f041dd4e3349a16cbc4ad92c966891088`. The final clean release commit compiled into this candidate will be recorded after signing in the exact-source receipt. Version 1.3.19 / source `9dfde2be` was rejected for a disposable fixture path error; it is not the delivery candidate.

Build: clean canonical `main` at `/Users/oliver/Documents/Projects/OM0RX-xLog`, `CARGO_BUILD_JOBS=2 bash prototype/scripts/package-macos.sh`. Native and distribution metadata embed exact Git HEAD. Swift/Python runtime and resources are built and staged by the same canonical script. Developer ID Hardened Runtime signing includes only the audio-input entitlement; deep/strict verification is mandatory. Notarization is separate and unclaimed.

After signing, copy the complete bundle to the versioned candidate folder and run its explicit `--recorder-acceptance` fixture and read-only `--recorder-audio-devices` enumeration. The fixture uses generated native PCM plus a fresh actual bundled Python contest, not production data. Source gates and the regression for the real macOS temp path passed; independent review rechecked the correction.

Physical verdict remains **NOT READY** because the operator's audio is disconnected. Signed-app TCC grant/deny, input/channel content, independent physical listening/VOX route, source interruption trials, and a measured real-time source soak remain pending. Direct TCI/Flex/DAX and independent dual-device capture remain deferred M5.

The active 1.3.18 app and rollback are preserved. Final source identity, hashes, signature, packaged results and installed-app preservation readback follow in this document and its JSON evidence.
