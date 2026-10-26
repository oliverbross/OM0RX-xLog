#!/usr/bin/env python3
"""Pinned offline CW payload, separate from app version/release authorization."""
import argparse
import hashlib
import json
import os
import pathlib
import platform
import re
import shutil
import subprocess
import tarfile
import tempfile
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
VERSION = "1.24.3"
ARCHIVE = "onnxruntime-osx-arm64-1.24.3.tgz"
ARCHIVE_SHA = "c255663d40755f84b1b86373bdb9870bb65f3a2c3d779b3d7ae31aaa00cebb4f"
RUNTIME_SHA = "81b90223e770bfaea12783cb99370258387bae7ed70ff7e99f2717382800d217"
MODEL_SHA = "ef120799457bca042d4690944f0faf93268eb4654e7f50f28784ad63bdc1fe02"
METADATA_SHA = "b4342157b90229ee7380e165f3d8036179b80d1e6ae02f2557388b7fcd558c01"
URL = "https://github.com/microsoft/onnxruntime/releases/download/v1.24.3/" + ARCHIVE
CACHE = ROOT / ".build/cw-package"
RUNTIME = CACHE / "runtime"
BUILD = CACHE / "native"
MODEL = ROOT / "vendor/deepcw-engine"
SYSTEM = ("/usr/lib/", "/System/Library/")


def run(*args, **kwargs):
    return subprocess.check_output([str(arg) for arg in args], cwd=ROOT, text=True, **kwargs).strip()


def digest(path):
    path = pathlib.Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError("Expected a regular payload file: " + str(path))
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(65536), b""):
            h.update(block)
    return h.hexdigest()


def check_hash(path, expected):
    if digest(path) != expected:
        raise ValueError("Payload digest mismatch: " + str(path))


def source_commit():
    commit = os.environ.get("XLOG_SOURCE_COMMIT", run("git", "rev-parse", "HEAD"))
    if not re.fullmatch("[0-9a-f]{40}", commit) or commit != run("git", "rev-parse", "HEAD"):
        raise ValueError("CW payload must use the selected current source commit")
    return commit


def payload_paths(bundle):
    contents = pathlib.Path(bundle).resolve() / "Contents"
    if not contents.is_dir():
        raise ValueError("Bundle Contents directory is missing")
    return contents, contents / "MacOS/xlog-cw-worker", contents / "Frameworks/libonnxruntime.dylib", contents / "Resources/CWDecode"


def dependencies(path):
    return [line.strip().split(" (", 1)[0] for line in run("otool", "-L", path).splitlines()[1:] if line.strip()]


def rpaths(path):
    return re.findall(r"cmd LC_RPATH\s+cmdsize \d+\s+path (.+?) \(offset", run("otool", "-l", path))


def verify_links(executable, runtime):
    for target in [executable, runtime]:
        if run("lipo", "-archs", target) != "arm64":
            raise ValueError("CW payload architecture must match the accepted arm64 app")
        # otool lists a dylib's own ID first; it is deliberately the same rpath ID.
        if any(not item.startswith(SYSTEM) and item != "@rpath/libonnxruntime.dylib" for item in dependencies(target)):
            raise ValueError("CW payload has an external dependency: " + str(target))
        if any(item != "@loader_path/../Frameworks" for item in rpaths(target)):
            raise ValueError("CW payload retains a development rpath")
        minimum = re.search(r"\bminos ([0-9.]+)", run("otool", "-l", target))
        if not minimum or tuple(int(part) for part in minimum.group(1).split(".")) > (14, 0, 0):
            raise ValueError("CW payload raises the accepted macOS 14 deployment target")


def prepare(archive):
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise ValueError("This pinned CW packaging lane supports the accepted Apple Silicon app")
    commit = source_commit()
    CACHE.mkdir(parents=True, exist_ok=True)
    archive = pathlib.Path(archive) if archive else CACHE / ARCHIVE
    if not archive.exists():
        with tempfile.NamedTemporaryFile(dir=CACHE, delete=False) as output:
            temporary = pathlib.Path(output.name)
            try:
                with urllib.request.urlopen(URL, timeout=30) as incoming:
                    total, started = 0, time.monotonic()
                    for block in iter(lambda: incoming.read(65536), b""):
                        total += len(block)
                        if total > 64 * 1024 * 1024 or time.monotonic() - started > 180:
                            raise ValueError("Runtime download exceeded its finite budget")
                        output.write(block)
                output.flush()
                check_hash(temporary, ARCHIVE_SHA)
                temporary.replace(archive)
            finally:
                temporary.unlink(missing_ok=True)
    check_hash(archive, ARCHIVE_SHA)
    RUNTIME.mkdir(exist_ok=True)
    prefix = "onnxruntime-osx-arm64-1.24.3/"
    wanted = {"lib/libonnxruntime.1.24.3.dylib", "LICENSE", "ThirdPartyNotices.txt", "VERSION_NUMBER", "GIT_COMMIT_ID"}
    # Copy regular selected members only; never extract links or archive paths.
    with tarfile.open(archive, "r:gz") as source:
        for member in source:
            if not member.name.startswith(prefix):
                continue
            relative = pathlib.PurePosixPath(member.name[len(prefix):])
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError("Unsafe runtime archive path")
            if not member.isfile() or not (str(relative) in wanted or str(relative).startswith("include/")):
                continue
            destination = RUNTIME.joinpath(*relative.parts)
            if destination.is_symlink():
                raise ValueError("Runtime extraction target is a symlink")
            destination.parent.mkdir(parents=True, exist_ok=True)
            with source.extractfile(member) as incoming, destination.open("wb") as output:
                shutil.copyfileobj(incoming, output)
    library = RUNTIME / "lib/libonnxruntime.1.24.3.dylib"
    if not (RUNTIME / "include/onnxruntime_cxx_api.h").is_file():
        raise ValueError("Pinned runtime headers are missing")
    check_hash(library, RUNTIME_SHA)
    check_hash(MODEL / "model.onnx", MODEL_SHA)
    check_hash(MODEL / "model.onnx.json", METADATA_SHA)
    run("cmake", "-S", ROOT / "native/cw-worker", "-B", BUILD,
        "-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_OSX_ARCHITECTURES=arm64", "-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0",
        "-DCMAKE_BUILD_WITH_INSTALL_RPATH=TRUE", "-DONNXRUNTIME_INCLUDE_DIR=" + str(RUNTIME / "include"), "-DONNXRUNTIME_LIBRARY=" + str(library))
    run("cmake", "--build", BUILD, "--target", "xlog-cw-worker", "-j2")
    if source_commit() != commit:
        raise ValueError("Source commit changed during the CW build; rebuild the selected candidate")
    (CACHE / "build.json").write_text(json.dumps({"sourceCommit": commit, "architecture": "arm64", "runtimeArchiveSHA256": ARCHIVE_SHA,
        "packagingScriptSHA256": digest(__file__),
        "compiler": run("clang++", "--version").splitlines()[0], "sdk": run("xcrun", "--show-sdk-version")}, indent=2) + "\n")


def stage(bundle):
    contents, executable, runtime, resources = payload_paths(bundle)
    build = json.loads((CACHE / "build.json").read_text())
    if build["sourceCommit"] != source_commit():
        raise ValueError("CW native build is from another source candidate")
    if build.get("packagingScriptSHA256") != digest(__file__):
        raise ValueError("Packaging script changed after CW preparation")
    for directory in [executable.parent, runtime.parent, resources]:
        directory.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(BUILD / "xlog-cw-worker", executable)
    shutil.copyfile(RUNTIME / "lib/libonnxruntime.1.24.3.dylib", runtime)
    executable.chmod(0o755); runtime.chmod(0o644)
    run("install_name_tool", "-id", "@rpath/libonnxruntime.dylib", runtime)
    for dependency in dependencies(executable):
        if not dependency.startswith(SYSTEM):
            if "libonnxruntime" not in dependency:
                raise ValueError("Unexpected native dependency")
            run("install_name_tool", "-change", dependency, "@rpath/libonnxruntime.dylib", executable)
    for target in [executable, runtime]:
        for entry in rpaths(target):
            if entry != "@loader_path/../Frameworks":
                run("install_name_tool", "-delete_rpath", entry, target)
    if "@loader_path/../Frameworks" not in rpaths(executable):
        run("install_name_tool", "-add_rpath", "@loader_path/../Frameworks", executable)
    verify_links(executable, runtime)
    for name in ["model.onnx", "model.onnx.json", "manifest.json"]:
        shutil.copyfile(MODEL / name, resources / ("upstream-model-manifest.json" if name == "manifest.json" else name))
    for source, name in [(MODEL / "LICENSE", "MODEL-LICENSE"), (RUNTIME / "LICENSE", "ONNXRUNTIME-LICENSE"),
                         (RUNTIME / "ThirdPartyNotices.txt", "ONNXRUNTIME-ThirdPartyNotices.txt")]:
        shutil.copyfile(source, resources / name)
    # Ship the exact tracked implementation source alongside its binary/model.
    run("git", "archive", "--format=tar.gz", "--output=" + str(resources / "xlog-source.tar.gz"), source_commit())
    (resources / "SOURCE.txt").write_text("OM0RX-xLog CW Decode source candidate " + source_commit() + "\n"
        "Exact tracked xLog source, model and build scripts: xlog-source.tar.gz\n"
        "Model upstream: https://github.com/e04/deepcw-engine/tree/8e264d243bbd4467bd19f3f28292219405b47e0e\n"
        "Model license: MODEL-LICENSE (AGPL-3.0-only); xLog implementation license is in its source archive.\n"
        "Runtime: https://github.com/microsoft/onnxruntime/tree/3a728b75062256951b6e19ce718907cf1a1d4cf0\n"
        "Runtime license and third-party notices are included here.\n"
        "Automatic spotting and RF mapping remain unqualified. Hardware acceptance is separate.\n")
    (resources / "build-provenance.json").write_text(json.dumps(build, indent=2) + "\n")


def finalize(bundle):
    _, executable, runtime, resources = payload_paths(bundle)
    verify_links(executable, runtime)
    for target in [executable, runtime]:
        run("codesign", "--verify", "--strict", target)
    provenance = json.loads((resources / "build-provenance.json").read_text())
    if provenance["sourceCommit"] != source_commit():
        raise ValueError("Source commit changed after CW build/staging; rebuild the selected candidate")
    if provenance.get("packagingScriptSHA256") != digest(__file__):
        raise ValueError("Packaging script changed after CW preparation")
    manifest = {"version": 1, "sourceCommit": provenance["sourceCommit"], "runtimeVersion": VERSION,
        "executableSHA256": digest(executable), "runtimeSHA256": digest(runtime), "modelSHA256": MODEL_SHA}
    (resources / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    provenance.update({"phase": "final-component-signatures-before-outer-app-signature", "hashes": manifest,
        "sourceArchiveSHA256": digest(resources / "xlog-source.tar.gz"), "metadataSHA256": METADATA_SHA})
    (resources / "build-provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    verify(bundle)


def verify(bundle):
    _, executable, runtime, resources = payload_paths(bundle)
    manifest = json.loads((resources / "manifest.json").read_text())
    provenance = json.loads((resources / "build-provenance.json").read_text())
    if provenance.get("hashes") != manifest or provenance.get("sourceCommit") != manifest.get("sourceCommit"):
        raise ValueError("CW manifest and signed-build provenance disagree")
    check_hash(resources / "xlog-source.tar.gz", provenance["sourceArchiveSHA256"])
    check_hash(executable, manifest["executableSHA256"]); check_hash(runtime, manifest["runtimeSHA256"])
    check_hash(resources / "model.onnx", MODEL_SHA); check_hash(resources / "model.onnx.json", METADATA_SHA)
    verify_links(executable, runtime)
    environment = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "C", "LC_ALL": "C"}
    result = subprocess.run([str(executable), str(resources / "model.onnx")], input=b"", stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, env=environment, cwd=resources, timeout=15, check=True)
    ready = json.loads(result.stdout)
    if ready.get("type") != "ready" or ready.get("runtime_version") != VERSION or ready.get("max_spans") != 2:
        raise ValueError("Bundled offline runtime/model handshake failed")
    print("CW offline payload verified: arm64, ONNX Runtime " + VERSION + ", two-span ceiling; hardware/quality gates remain open")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "stage", "finalize", "verify"])
    parser.add_argument("--bundle", type=pathlib.Path)
    parser.add_argument("--runtime-archive", type=pathlib.Path)
    args = parser.parse_args()
    if args.action == "prepare":
        prepare(args.runtime_archive)
    elif args.bundle is None:
        parser.error("--bundle is required")
    else:
        {"stage": stage, "finalize": finalize, "verify": verify}[args.action](args.bundle)
