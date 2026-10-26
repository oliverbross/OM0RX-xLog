# Offline Mac CW payload

The accepted main application inspected on 26 October 2026 is arm64. Its existing
Swift helper contains arm64 and x86_64 slices; this does not establish an accepted
Intel main application. The CW payload lane targets the accepted Apple Silicon
application on macOS 14 or later. Intel, Windows and Linux packages need their own
runtime and exact-package qualification.

Production packages default to `experimentalEnabled: false`. The native owner
rejects decoder Start, DAX handoff and listener Start, and does not probe IQ
capabilities in a disabled build. Settings/Stop remain available. A deliberate
engineering build can set `XLOG_CW_EXPERIMENTAL=1`; this does not qualify RF mapping
or automatic spots. Incomplete CW engineering must not silently become an enabled
feature in an otherwise ready contest update.

`prototype/scripts/package-macos.sh` prepares the pinned native worker and stages
its resources into the canonical candidate. `cw-macos.py` verifies the official
ONNX Runtime 1.24.3 arm64 archive before selecting regular headers/library/notices.
It never uses Homebrew ONNX Runtime in the distributed application. The model and
metadata are checked against their committed hashes. Only application-relative
runtime references and Apple system dependencies survive relocation.

The package includes the model's full license, runtime license/third-party
notices, upstream identities, and a compressed archive of the exact tracked xLog
source candidate, including the implementation, model and build scripts. These
files record the material included; they are not a separate legal certification.

After nested signing, `finalize` records the actual signed worker/runtime hashes,
source archive hash, compiler, SDK, source commit and packaging script hash. It
rejects a source commit that moved during build or after staging. The final probe
uses the bundled model, an empty stdin and a small clean environment without a
developer library path. This verifies offline loading and the two-span protocol
ceiling; it does not prove real-time density or radio decoding quality.

An isolated payload fixture (without an application UI or Info.plist) can exercise
staging before creating a versioned application candidate:

```sh
python3 prototype/scripts/cw-macos.py prepare --fixture-only --runtime-archive /path/to/pinned-archive.tgz
mkdir -p .build/cw-payload-fixture/Contents/MacOS
python3 prototype/scripts/cw-macos.py stage --bundle .build/cw-payload-fixture
codesign --force --sign - --timestamp=none .build/cw-payload-fixture/Contents/Frameworks/libonnxruntime.dylib
codesign --force --sign - --timestamp=none .build/cw-payload-fixture/Contents/MacOS/xlog-cw-worker
python3 prototype/scripts/cw-macos.py finalize --bundle .build/cw-payload-fixture
python3 prototype/scripts/cw-payload.check.py .build/cw-payload-fixture
```

The fixture check moves the payload into a path containing spaces and probes it
again, then verifies rejection of a changed executable and a development rpath.
A fixture signature does not imply a signed full-app candidate, installation,
notarization, hardware acceptance, or the required 8-hour/24-hour soak runs.
Fixture preparation records dirty-source paths and native input hashes, and its
payload is rejected from a real application bundle. Production preparation
requires a clean source tree. Fixture manifests cannot enable CW acquisition.

Runtime source: [official 1.24.3 release assets](https://github.com/microsoft/onnxruntime/releases/expanded_assets/v1.24.3).
The archive SHA-256 is `c255663d40755f84b1b86373bdb9870bb65f3a2c3d779b3d7ae31aaa00cebb4f`.
