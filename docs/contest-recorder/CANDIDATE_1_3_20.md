# macOS 1.3.20 recorder candidate

Package only; no installation, recording, playback or station action is authorized by this receipt.

Composition: recorder implementation `18ff24d2`, preserved current 1.3.18 source/receipts through `f751ae05`, and the tested acceptance-root fix `1553574f041dd4e3349a16cbc4ad92c966891088`. The final clean release commit compiled into this candidate will be recorded after signing in the exact-source receipt. Version 1.3.19 / source `9dfde2be` was rejected for a disposable fixture path error; it is not the delivery candidate.

Build: clean canonical `main` at `/Users/oliver/Documents/Projects/OM0RX-xLog`, `CARGO_BUILD_JOBS=2 bash prototype/scripts/package-macos.sh`. Native and distribution metadata embed exact Git HEAD. Swift/Python runtime and resources are built and staged by the same canonical script. Developer ID Hardened Runtime signing includes only the audio-input entitlement; deep/strict verification is mandatory. Notarization is separate and unclaimed.

After signing, copy the complete bundle to the versioned candidate folder and run its explicit `--recorder-acceptance` fixture and read-only `--recorder-audio-devices` enumeration. The fixture uses generated native PCM plus a fresh actual bundled Python contest, not production data. Source gates and the regression for the real macOS temp path passed; independent review rechecked the correction.

Physical verdict remains **NOT READY** because the operator's audio is disconnected. Signed-app TCC grant/deny, input/channel content, independent physical listening/VOX route, source interruption trials, and a measured real-time source soak remain pending. Direct TCI/Flex/DAX and independent dual-device capture remain deferred M5.

## Verified delivery identity

- Candidate: **1.3.20**, arm64 macOS, exact source **`5e48489f6a1d2408920ed0a29d4d7da173a295d4`**. Native fixture, Python runtime receipt and distribution receipt agree; Python source changes are empty.
- Bundle: `/Users/oliver/Documents/Builds/OM0RX-xLog-1.3.20-recorder/OM0RX-xLog.app`.
- Executable SHA-256: `8f880d0ca2009b135467e23622a3648da33a1ad76ba6141f62da15e4a45054e1`.
- CDHash: `ea1e7a58f3c5ba5fea8e299885be0032ad72e434`.
- Developer ID **Oliver Bross (4WCMQ4U946)**; Hardened Runtime; deep/strict signature valid after relocation. Only `com.apple.security.device.audio-input=true` is present. Purpose text verified. Not notarized by this task.
- **13/13 signed-bundle checks passed** in 2,186 ms: native queue sample equality, frame-continuous segments/frozen prefix, real bundled `not1mm-python` commit/retry/correction/deletion, exact Analytics contact ID, restart/recovery, immutable originals and independent export decoding. Exactly **8,000 stereo frames** decoded. This generated-sample duration is not a real-time soak.
- Read-only Core Audio enumeration completed: permission status **authorized**, 19 devices observed, capture/output both false. This does not establish actual signed-app capture or physical route behavior.
- Installed **1.3.18** / source `78a294206216e490699716f5088acd25707f5eed` remains unchanged: executable, worker and Info.plist hashes match before/after. All listed rollback bundles and the original recorder stash/backup remain present. This task opened no production log/settings through its fixture and performed no station action.

[Exact-source/signature receipt](evidence/1.3.20/candidate-receipt.json), [packaged sample and actual-path results](evidence/1.3.20/native-fixture.json), [preservation readback](evidence/1.3.20/preservation.json), and [reproduction script](evidence/1.3.20/verify-candidate.py) are retained with the build log. No further application source changed after this build; later receipt commits are documentation only.

Verdict: **software candidate verified; NOT READY for physical audio acceptance**. The active application was not replaced. No real capture/playback, permission prompt, source soak, station action or M5 transport was exercised. Stop this delivery here; hardware follow-up requires the named connected route and operator authorization.
