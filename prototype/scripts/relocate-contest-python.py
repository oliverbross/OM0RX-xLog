#!/usr/bin/env python3
"""Build-time CPython dependency closure, relocation and strict acceptance."""
import argparse
from collections import deque
from datetime import datetime, UTC
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
MACHO = {bytes.fromhex(value) for value in ("feedface", "cefaedfe", "feedfacf", "cffaedfe", "cafebabe", "bebafeca", "cafebabf", "bfbafeca")}


def run(*args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, text=True, capture_output=True, **kwargs).stdout


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def is_macho(path):
    if path.is_symlink() or not path.is_file():
        return False
    with path.open("rb") as stream:
        return stream.read(4) in MACHO


def machos(root):
    return sorted(path for path in root.rglob("*") if is_macho(path))


def dependencies(path):
    return re.findall(r"^\s+(.+?) \(compatibility version", run("/usr/bin/otool", "-L", path), re.M)


def install_ids(path):
    return [line.strip() for line in run("/usr/bin/otool", "-D", path).splitlines() if line and not line.endswith(":")]


def rpaths(path):
    return re.findall(r"cmd LC_RPATH\s+cmdsize \d+\s+path (.+?) \(offset", run("/usr/bin/otool", "-l", path))


def version_tuple(value):
    return tuple(([int(part) for part in value.split(".")] + [0, 0, 0])[:3])


def check_minimum(path, target):
    output = run("/usr/bin/xcrun", "vtool", "-show-build", path)
    versions = re.findall(r"\bminos\s+([\d.]+)", output)
    versions += re.findall(r"cmd LC_VERSION_MIN_MACOSX\s+cmdsize \d+\s+version ([\d.]+)", output)
    require(bool(versions), f"Cannot establish deployment target: {path}")
    require(all(version_tuple(value) <= version_tuple(target) for value in versions),
            f"{path.name} requires macOS {versions}; app promises {target}")
    return versions


def system_path(value):
    return os.path.normpath(value).startswith(("/usr/lib/", "/System/Library/"))


def expand(value, loader, executable):
    if value.startswith("@loader_path/"):
        return loader.parent / value[len("@loader_path/"):]
    if value.startswith("@executable_path/"):
        return executable.parent / value[len("@executable_path/"):]
    return Path(value) if value.startswith("/") else None


def source_dependency(value, source, executable):
    direct = expand(value, source, executable)
    if direct is not None and direct.is_file():
        return direct.resolve()
    if value.startswith("@rpath/"):
        for rpath in rpaths(source):
            base = expand(rpath, source, executable)
            if base is not None:
                candidate = base / value[len("@rpath/"):]
                if candidate.is_file():
                    return candidate.resolve()
    raise RuntimeError(f"Unresolved source dependency {value} in {source}")


def relocate(framework, source_runtime, target):
    runtime = framework / "Versions/3.12"
    source_executable = source_runtime / "bin/python3.12"
    source_by_target = {path: source_runtime / path.relative_to(runtime) for path in machos(runtime)}
    queue, processed, external = deque(source_by_target), set(), {}
    while queue:
        path = queue.popleft()
        if path in processed:
            continue
        processed.add(path)
        source = source_by_target[path]
        check_minimum(source, target)
        ids = install_ids(path)
        for dependency in dependencies(path):
            if dependency in ids or system_path(dependency):
                continue
            original = source_dependency(dependency, source, source_executable)
            if original.is_relative_to(source_runtime):
                destination = runtime / original.relative_to(source_runtime)
                require(destination.is_file(), f"Framework dependency absent: {destination}")
            else:
                key = str(original)
                if key not in external:
                    filename = hashlib.sha256(key.encode()).hexdigest()[:12] + "-" + original.name
                    destination = runtime / "lib/xlog-dylibs" / filename
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(original, destination)
                    external[key] = {"source": key, "sourceSHA256": digest(original),
                                     "bundledPath": str(destination.relative_to(framework))}
                    source_by_target[destination] = original
                    queue.append(destination)
                destination = framework / external[key]["bundledPath"]
            run("/usr/bin/install_name_tool", "-change", dependency,
                "@loader_path/" + os.path.relpath(destination, path.parent), path)
        if ids:
            run("/usr/bin/install_name_tool", "-id", "@loader_path/" + path.name, path)
        for rpath in set(rpaths(path)):
            run("/usr/bin/install_name_tool", "-delete_rpath", rpath, path)
        run("/usr/bin/codesign", "--force", "--sign", "-", "--timestamp=none", path)
    return list(external.values())


def validate(framework, target):
    result, root = [], framework.resolve()
    for path in machos(framework):
        versions, ids = check_minimum(path, target), install_ids(path)
        require(not any(value.startswith("/") for value in ids), f"Absolute install ID: {path}")
        require(not rpaths(path), f"Unexpected runtime search path: {path}")
        for dependency in dependencies(path):
            if dependency in ids or system_path(dependency):
                continue
            require(dependency.startswith("@loader_path/"), f"External/ambiguous linkage {dependency}: {path}")
            resolved = (path.parent / dependency[len("@loader_path/"):]).resolve()
            require(resolved.is_relative_to(root) and resolved.is_file(), f"Dependency escapes bundle: {dependency}: {path}")
        result.append({"path": str(path.relative_to(framework)), "sha256": digest(path), "minimumOS": versions,
                       "architectures": run("/usr/bin/lipo", "-archs", path).strip()})
    require(bool(result), "No Python Mach-O files were staged")
    for path in framework.rglob("*"):
        if path.is_symlink():
            require(path.resolve().is_relative_to(root) and path.resolve().exists(), f"External/broken framework symlink: {path}")
    return result


def self_test(framework, host_root):
    with tempfile.TemporaryDirectory(prefix="om0rx-python-relocation-", dir="/private/tmp") as temporary:
        fixture = Path(temporary) / "Relocated Contest.app/Contents"
        relocated, host = fixture / "Frameworks/Python.framework", fixture / "Resources/Not1MM/python"
        shutil.copytree(framework, relocated, symlinks=True)
        shutil.copytree(host_root, host, symlinks=True)
        executable = relocated / "Versions/3.12/bin/python3.12"
        env = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "C.UTF-8", "DYLD_PRINT_LIBRARIES": "1"}
        program = "\n".join([
            "import sqlite3, ssl, lzma, decimal, json, sys, pathlib",
            "db=sqlite3.connect(':memory:')",
            "db.execute('create table proof(value integer)')",
            "db.execute('insert into proof values(42)'); db.commit()",
            "assert db.execute('select value from proof').fetchone()==(42,)",
            "assert lzma.decompress(lzma.compress(b'xlog'))==b'xlog'",
            "assert decimal.Decimal('0.1')+decimal.Decimal('0.2')==decimal.Decimal('0.3')",
            "assert pathlib.Path(sys.base_prefix).resolve()==pathlib.Path(sys.executable).resolve().parents[1]",
            "print(json.dumps({'python':sys.version.split()[0], 'sqlite':sqlite3.sqlite_version, 'ssl':ssl.OPENSSL_VERSION, 'decimal':decimal.__libmpdec_version__}))",
        ])
        checked = subprocess.run([str(executable), "-I", "-B", "-c", program], env=env, capture_output=True, text=True, check=True)
        require(not re.search(r"/(?:opt/(?:local|homebrew)|usr/local)/", checked.stderr), "Relocated Python loaded a package-manager library")
        request = json.dumps({"id": "package-test", "method": "contest_catalog", "params": {}}) + "\n"
        child = subprocess.run([str(executable), "-I", "-B", str(host / "contest_host/launcher.py"), "--data-root", str(Path(temporary) / "data")],
                               input=request, env=env, capture_output=True, text=True, check=True)
        require(not re.search(r"/(?:opt/(?:local|homebrew)|usr/local)/", child.stderr), "Contest host loaded a package-manager library")
        reply = json.loads(child.stdout)
        require(reply.get("ok") is True and reply["result"]["plugins"][0]["engine"] == "not1mm-python", "Relocated catalog failed")
        return {"relocated": True, "modules": json.loads(checked.stdout), "catalog": "cq_ww_cw", "externalLibrariesLoaded": False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--source-framework", type=Path)
    parser.add_argument("--finalize-provenance", action="store_true")
    args = parser.parse_args()
    bundle = args.bundle.absolute()
    parent = ROOT / "prototype/src-tauri/target/release/bundle/macos"
    require(bundle.parent == parent and bundle.suffix == ".app" and not bundle.is_symlink(), "Unexpected candidate bundle")
    require(bundle.resolve().parent == parent.resolve(), "Candidate escapes build output")
    with (bundle / "Contents/Info.plist").open("rb") as stream:
        target = plistlib.load(stream).get("LSMinimumSystemVersion")
    require(isinstance(target, str), "App deployment target is missing")
    framework = bundle / "Contents/Frameworks/Python.framework"
    host_root = bundle / "Contents/Resources/Not1MM/python"
    manifest = bundle / "Contents/Resources/Not1MM/python-runtime.json"
    if args.finalize_provenance:
        data = json.loads(manifest.read_text())
        data["packagedMachO"] = validate(framework, target)
        data["hashPhase"] = "final-component-signatures-before-outer-app-signature"
    else:
        require(args.source_framework is not None, "Source framework required")
        source_runtime = (args.source_framework / "Versions/3.12").resolve()
        source_python = source_runtime / "bin/python3.12"
        version = run(source_python, "-I", "-c", "import platform; print(platform.python_version())").strip()
        require(version.startswith("3.12."), f"Expected Python 3.12; found {version}")
        check_minimum(source_python, target)
        check_minimum(source_runtime / "Python", target)
        for destination in (framework, host_root):
            require(not destination.is_symlink(), "Refusing a linked runtime destination")
            if destination.exists():
                shutil.rmtree(destination)
        runtime = framework / "Versions/3.12"
        shutil.copytree(source_runtime, runtime, symlinks=True, ignore=shutil.ignore_patterns("site-packages", "__pycache__", "*.pyc"))
        (framework / "Versions/Current").symlink_to("3.12")
        (framework / "Python").symlink_to("Versions/Current/Python")
        (framework / "Resources").symlink_to("Versions/Current/Resources")
        shutil.copytree(ROOT / "python", host_root, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".venv"))
        require(not list(framework.rglob("site-packages")), "site-packages survived runtime staging")
        closure = relocate(framework, source_runtime, target)
        data = {"schema": 1, "pythonVersion": version, "sourceFramework": str(source_runtime.parent.parent),
                "sourceExecutableSHA256": digest(source_python), "sourceFrameworkSHA256": digest(source_runtime / "Python"),
                "minimumSystemVersion": target, "sourceCommit": run("git", "-C", ROOT, "rev-parse", "HEAD").strip(),
                "sourceChanges": run("git", "-C", ROOT, "status", "--porcelain").splitlines(),
                "createdUTC": datetime.now(UTC).isoformat(), "dependencies": closure, "packagedMachO": validate(framework, target),
                "acceptance": self_test(framework, host_root), "hashPhase": "staged-ad-hoc-signatures"}
        data["packagingSources"] = {name: digest(ROOT / "prototype/scripts" / name) for name in
                                    ("relocate-contest-python.py", "stage-contest-python-macos.sh", "package-macos.sh")}
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"Verified bundled Python {data['pythonVersion']}: {len(data['packagedMachO'])} Mach-O files; minimum macOS {target}; {manifest}")


if __name__ == "__main__":
    main()
