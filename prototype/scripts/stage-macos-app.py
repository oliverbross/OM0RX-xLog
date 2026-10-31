#!/usr/bin/env python3
"""Stage the configured Apple bundle from a fresh production Cargo artifact.

This only replaces the canonical build-output bundle. Signing, native runtime
staging, privacy checks and notarization remain separate package gates.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
import uuid


def require(condition, message):
    if not condition:
        raise ValueError(message)


def regular(path):
    require(path.is_file() and not path.is_symlink(), f"Required regular bundle input is missing: {path}")
    return path


def digest(path):
    with regular(path).open("rb") as stream:
        value = hashlib.sha256()
        for block in iter(lambda: stream.read(65536), b""):
            value.update(block)
        return value.hexdigest()


def relative(value):
    require(isinstance(value, str) and value and "\\" not in value, "Expected a relative POSIX bundle path")
    path = PurePosixPath(value)
    require(path.parts and not path.is_absolute() and ".." not in path.parts and not any(char in value for char in "*?[]"),
            f"Unsupported or escaping bundle path: {value}")
    return Path(*path.parts)


def stage_bundle(root, receipt, target, source_commit):
    root = root.resolve(strict=True)
    project, release = root / "prototype/src-tauri", root / "prototype/src-tauri/target/release"
    require(project.resolve() == project and release.resolve() == release, "Build directories cannot be symlinks")
    require(receipt.resolve().is_relative_to(root), "Cargo receipt must belong to this checkout")
    config = json.loads(regular(project / "tauri.conf.json").read_text())
    metadata = json.loads(regular(root / "prototype/distribution-metadata/components.json").read_text())
    cargo_versions = [item["version"] for item in metadata["components"]
                      if item.get("ecosystem") == "cargo" and item.get("name") == "xlog-prototype"]
    frontend = json.loads(regular(root / "prototype/package.json").read_text())
    version, name = config["version"], config["productName"]
    require(cargo_versions == [version] and version == frontend["version"], "App, Cargo and frontend versions must match")
    require(re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?", version), "Invalid app version")
    require(name == Path(name).name and name not in ("", ".", "..") and "/" not in name and "\\" not in name, "Invalid app name")
    require(target == "aarch64-apple-darwin", "This accepted native packaging lane requires Apple Silicon")
    require(re.fullmatch(r"[0-9a-f]{40}", source_commit), "A complete source commit is required")
    require(metadata["sourceCommit"] == source_commit, "Dependency inventory does not match the selected source")
    bundle_config, executable_name = config["bundle"], config.get("mainBinaryName", "xlog-prototype")
    require(executable_name == "xlog-prototype", "Unexpected application executable")
    mac = bundle_config["macOS"]
    require(mac["minimumSystemVersion"] == "14.0" and bundle_config["category"] == "Utility", "Unsupported deployment/category configuration")
    binary = regular(release / executable_name)
    require(os.access(binary, os.X_OK), "Cargo application artifact is not executable")
    messages = [json.loads(line) for line in regular(receipt).read_text().splitlines() if line.strip()]
    require(messages and messages[-1].get("reason") == "build-finished" and messages[-1].get("success") is True,
            "Cargo build did not complete successfully")
    artifacts = [item for item in messages if item.get("reason") == "compiler-artifact"]
    require(any(item.get("target", {}).get("name") == "tauri" and "custom-protocol" in item.get("features", []) for item in artifacts),
            "Cargo receipt does not prove the production custom protocol")
    require(any(item.get("executable") == str(binary) and item.get("target", {}).get("name") == executable_name
                and re.search(r"#(?:xlog-prototype@)?" + re.escape(version) + r"$", item.get("package_id", ""))
                and item.get("fresh") is False and item.get("profile", {}).get("test") is False
                and item.get("profile", {}).get("debug_assertions") is False for item in artifacts),
            "A freshly compiled release application artifact is required")
    payload = binary.read_bytes()
    require(source_commit.encode() in payload and (source_commit + "-dirty").encode() not in payload,
            "Application executable does not contain the selected clean source identity")
    plan = [(binary, Path("MacOS") / executable_name, True)]
    for entry in bundle_config.get("externalBin", []):
        source_path = relative(entry)
        source = project / source_path.parent / f"{source_path.name}-{target}"
        require(source.resolve().is_relative_to(project), "Configured sidecar escapes the application project")
        staged = regular(release / source_path.name)
        require(digest(source) == digest(staged), f"Cargo sidecar differs from its configured source: {entry}")
        plan.append((staged, Path("MacOS") / source_path.name, True))
    icons = [relative(item) for item in bundle_config["icon"] if item.endswith(".icns")]
    require(len(icons) == 1, "Exactly one configured Apple icon is required")
    icon = regular(project / icons[0])
    require(icon.resolve().is_relative_to(project), "Configured icon escapes the application project")
    plan.append((icon, Path("Resources") / icon.name, False))
    resources = bundle_config.get("resources", [])
    require(isinstance(resources, (list, dict)), "Unsupported resource configuration")
    mappings = resources.items() if isinstance(resources, dict) else ((item, item) for item in resources)
    for source_value, destination_value in mappings:
        source_path, destination_path = relative(source_value), relative(destination_value)
        source = project / source_path
        require(source.resolve().is_relative_to(project), "Configured resource escapes the application project")
        require(source.exists() and not source.is_symlink(), f"Configured resource is missing: {source_value}")
        files = sorted(source.rglob("*")) if source.is_dir() else [source]
        for item in files:
            require(not item.is_symlink(), "Resource symlinks cannot enter the application")
            if item.is_dir():
                continue
            suffix = item.relative_to(source) if source.is_dir() else Path()
            destination = destination_path / suffix
            staged = regular(release / destination)
            require(digest(item) == digest(staged), f"Cargo resource differs from configured source: {source_value}")
            plan.append((staged, Path("Resources") / destination, False))
    destinations = [str(destination) for _, destination, _ in plan]
    require(len(destinations) == len(set(destinations)), "Bundle inputs have colliding destinations")
    info = {
        "CFBundleDevelopmentRegion": "English", "CFBundleDisplayName": name, "CFBundleExecutable": executable_name,
        "CFBundleIdentifier": config["identifier"], "CFBundleInfoDictionaryVersion": "6.0", "CFBundleName": name,
        "CFBundlePackageType": "APPL", "CFBundleShortVersionString": version,
        "CFBundleVersion": mac.get("bundleVersion", version), "CSResourcesFileMapped": True,
        "LSApplicationCategoryType": "public.app-category.utilities", "LSMinimumSystemVersion": "14.0",
        "CFBundleIconFile": icon.name, "LSRequiresCarbon": True, "NSHighResolutionCapable": True,
    }
    fragment_path = project / relative(mac["infoPlist"])
    require(fragment_path.resolve().is_relative_to(project), "Custom plist escapes the application project")
    fragment = plistlib.loads(regular(fragment_path).read_bytes())
    require(isinstance(fragment, dict) and all(key not in info or info[key] == value for key, value in fragment.items()),
            "Custom plist cannot override bundle identity or deployment metadata")
    info.update(fragment)
    require(isinstance(info.get("NSMicrophoneUsageDescription"), str) and info["NSMicrophoneUsageDescription"].strip(),
            "The configured microphone usage description is required")
    manifest = {"schema": 1, "sourceCommit": source_commit, "version": version, "target": target,
                "customProtocol": True, "executableSHA256": digest(binary),
                "inputs": {str(destination): digest(source) for source, destination, _ in plan}}
    parent = release / "bundle/macos"
    require(parent.resolve() == parent, "Bundle output directories cannot be symlinks")
    parent.mkdir(parents=True, exist_ok=True)
    destination = parent / f"{name}.app"
    require(not destination.is_symlink(), "The build-output bundle cannot be a symlink")
    if destination.exists():
        previous_info = plistlib.loads(regular(destination / "Contents/Info.plist").read_bytes())
        require(previous_info.get("CFBundleIdentifier") == config["identifier"], "Existing build bundle has a different identity")
        if previous_info.get("CFBundleShortVersionString") == version:
            previous_receipt = destination / "Contents/Resources/NativeBundleBuild.json"
            require(previous_receipt.is_file() and not previous_receipt.is_symlink(),
                    "An existing version without matching provenance requires a software version advance")
            previous = json.loads(regular(previous_receipt).read_text())
            require(all(previous.get(key) == manifest[key] for key in ("sourceCommit", "version", "target", "executableSHA256", "inputs")),
                    "A different application candidate must advance its software version")
    with tempfile.TemporaryDirectory(prefix=f".{name}-stage-", dir=parent) as temporary:
        staged_bundle = Path(temporary) / f"{name}.app"
        contents = staged_bundle / "Contents"
        for source, relative_destination, executable in plan:
            output = contents / relative_destination
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, output)
            output.chmod(0o755 if executable else 0o644)
        (contents / "Info.plist").write_bytes(plistlib.dumps(info, sort_keys=False))
        (contents / "PkgInfo").write_bytes(b"APPL????")
        (contents / "Resources/NativeBundleBuild.json").write_text(json.dumps(manifest, indent=2) + "\n")
        previous = parent / f".{name}-previous-{uuid.uuid4().hex}.app" if destination.exists() else None
        if previous:
            os.replace(destination, previous)
        try:
            os.replace(staged_bundle, destination)
        except BaseException:
            if previous and not destination.exists():
                os.replace(previous, destination)
            raise
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cargo-receipt", required=True, type=Path)
    args = parser.parse_args()
    require(sys.platform == "darwin", "Application staging requires macOS")
    root = Path(__file__).resolve().parents[2]
    commit = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
    require(os.environ.get("XLOG_SOURCE_COMMIT") == commit, "Build receipt must match the current source commit")
    require(not subprocess.check_output(["git", "-C", str(root), "status", "--porcelain"], text=True).strip(), "Packaging requires clean source")
    host = subprocess.check_output(["rustc", "-vV"], text=True)
    target = next((line[6:] for line in host.splitlines() if line.startswith("host: ")), "")
    print(stage_bundle(root, args.cargo_receipt, target, commit))


if __name__ == "__main__":
    main()
