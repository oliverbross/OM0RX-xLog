# P1 Linux runtime packaging gate

This lane targets **Ubuntu 24.04 amd64 only**. It packages the isolated synthetic
prototype; it includes no Hamlib helper, station/account access, production
installer signing, or claim of compatibility with other Linux distributions.

After the normal native worker/frontend/Tauri release build and the shared
distribution metadata generator, run:

```sh
bash prototype/scripts/package-linux.sh
```

Outputs are under `prototype/dist-linux/<source-commit>/`: a Debian package, a
relocatable tar archive, and their SHA-256 checksums. Each payload contains the
exact worker and shell, Swift libraries selected by native `ldd` closure,
version-pinned Swift redistribution licenses/notices, shared dependency notices
and component metadata, source/lockfile inputs, a runtime manifest, a payload
hash manifest, and native `readelf`/`ldd` diagnostics. The loader JSON records
resolved library hashes and OS package names/versions. It is an inventory, not
an independently certified complete SBOM or release license audit.

The launcher selects its own private library directory. Swift/Rust/Node
toolchains are not installed for acceptance. Application system prerequisites
are declared in `prototype/scripts/linux-runtime-dependencies.txt`; Ubuntu
provides them and their transitive packages rather than copying host libraries
into the application. Exact package versions are retained in acceptance evidence.

Build and run the runtime image from a fresh checkout of the package commit,
with downloaded `.deb` and `.tar.gz` in that commit's output directory:

```sh
docker build -f prototype/scripts/Dockerfile.linux-runtime -t xlog-p1-runtime .
mkdir -p evidence
chmod 777 evidence
docker run --rm --network none --cap-drop ALL \
  -v "$PWD/evidence:/evidence" xlog-p1-runtime
```

The image installs the actual Debian package as root during image construction;
runtime checks run as a regular user with network access disabled. Python,
binutils, Xvfb, D-Bus, and ImageMagick are QA tools, not declared application
dependencies. No compiler, Swift/Rust/Node toolchain or development library is
installed. The harness rejects unexpected development executables, verifies all
payload hashes, checks native recursive loader resolution, executes worker
self-test plus both open-pipe/fragments and malformed/oversized-line recovery
regressions, then launches the installed embedded UI twice to check shutdown and
reopen. A third launch uses the tar archive extracted at a new user-writable path.
Each UI run saves a native report and an X11 screenshot. Any failed report,
missing screenshot, loader failure, timeout or nonzero exit fails the lane.

The authoritative result is `evidence/acceptance.json` together with the three
UI reports/screenshots, worker report, logs, loader inventories, package versions,
OS/user records and hash checks from the same run. Successful builds or local
script syntax checks do not establish Linux clean-runtime acceptance. Xvfb
acceptance also does not establish physical desktop, display-driver, radio/RF or
production-account behavior.

Primary platform references: [Tauri Debian distribution](https://tauri.app/distribute/debian/),
[Swift Linux packaging](https://docs.swift.org/latest/documentation/swiftlinux/packaging/),
and version-tagged Swift source license URLs recorded in `runtime-manifest.json`.
