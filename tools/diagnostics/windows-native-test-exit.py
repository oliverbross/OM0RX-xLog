"""One already-built Windows Swift Testing child. Observation only; never builds or edits PE headers."""
import argparse, ctypes, hashlib, json, os, plistlib, shutil, struct, subprocess, sys, time, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def pe_stack(path):
    with path.open("rb") as file:
        header = file.read(64)
        assert header[:2] == b"MZ"
        pe = struct.unpack_from("<I", header, 60)[0]
        assert 64 <= pe <= 1_048_576
        file.seek(pe)
        data = file.read(160)
    assert data[:4] == b"PE\0\0"
    machine, optional_size = struct.unpack_from("<H", data, 4)[0], struct.unpack_from("<H", data, 20)[0]
    magic = struct.unpack_from("<H", data, 24)[0]
    assert optional_size >= 96 and magic in (0x10b, 0x20b)
    reserve, commit = struct.unpack_from("<QQ" if magic == 0x20b else "<II", data, 24 + 72)
    return dict(machine=hex(machine), optionalMagic=hex(magic), stackReserveBytes=reserve, stackCommitBytes=commit)

def sha(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()

def runtime_paths():
    # Match SwiftPM6.3.3 UserToolchain's SDK platform XCTest/Testing bin64 paths.
    sdk = Path(os.environ["SDKROOT"])
    platform = sdk.parent.parent.parent
    info = plistlib.loads((platform / "Info.plist").read_bytes())
    def entries(value):
        if isinstance(value, dict):
            for key, item in value.items():
                yield "".join(c for c in key.lower() if c.isalnum()), item
                yield from entries(item)
    values = dict(entries(info))
    result = []
    for key, project in [("swifttestingversion", "Testing"), ("xctestversion", "XCTest")]:
        version = values.get(key)
        assert isinstance(version, str), "Swift SDK platform does not identify " + project
        folder = platform / "Developer/Library" / (project + "-" + version) / "usr"
        candidates = [folder / "bin64", folder / "bin"]
        selected = next((p for p in candidates if p.is_dir()), None)
        assert selected is not None, "Missing SDK runtime directory for " + project
        result.append(str(selected))
    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--scratch", default=".build/prototype-tests")
    parser.add_argument("--filter", required=True)
    args = parser.parse_args()
    assert os.name == "nt" and os.environ.get("XLOG_PORTABLE_ONLY") == "1"
    assert args.filter and len(args.filter) <= 4096 and "\0" not in args.filter
    sys.stdout.reconfigure(encoding="utf-8")
    directory = ROOT / ".build/native-direct-diagnostics" / str(uuid.uuid4())
    directory.mkdir(parents=True)
    record = dict(schema=1, sourceCommit=os.environ.get("GITHUB_SHA"), diagnosticOnly=True,
                  fullProductQualification=False, started=time.time(), state="preparing")
    target = directory / "receipt.json"
    try:
        scratch = (ROOT / args.scratch).resolve()
        assert scratch.is_relative_to(ROOT / ".build")
        found = list(scratch.glob("x86_64-unknown-windows-msvc/debug/*PackageTests.xctest"))
        found = [p.resolve() for p in found if p.is_file()]
        assert len(found) == 1, "Require exactly one already-built Windows PackageTests.xctest"
        executable = found[0]
        record.update(executable=str(executable), executableSHA256=sha(executable), pe=pe_stack(executable))
        assert record["pe"]["machine"] == "0x8664"
        paths = runtime_paths()
        environment = dict(os.environ)
        environment["PATH"] = os.pathsep.join([*paths, environment.get("PATH", "")])
        environment["NO_COLOR"] = "1"
        record["swiftPMRuntimeDirectories"] = paths
        # Retain original wrapper/Swift command results independently of direct native status.
        originals = []
        for folder in ["native-core-diagnostics", "portable-swift-lock-receipts"]:
            files = sorted((ROOT / ".build" / folder).glob("*.json"), key=lambda p:p.stat().st_mtime)[-4:]
            for source in files:
                copy = directory / (folder + "-" + source.name)
                shutil.copyfile(source, copy)
                original = json.loads(source.read_text())
                originals.append(dict(path=str(source), sha256=sha(source),
                    childExitCode=original.get("childExitCode"), exitCode=original.get("exitCode"), state=original.get("state")))
        record["originalSwiftAndWrapperReceipts"] = originals
        command = [str(executable), "--no-parallel", "--filter", args.filter, "--testing-library", "swift-testing"]
        record.update(command=command, filter=args.filter, timeoutSeconds=60)
        target.write_text(json.dumps(record, indent=2)+"\n")
        with (directory / "native-output.log").open("wb") as output:
            child = subprocess.Popen(command, cwd=ROOT, env=environment, stdout=output, stderr=subprocess.STDOUT)
            record["pid"] = child.pid
            target.write_text(json.dumps(record, indent=2)+"\n")
            try:
                result = child.wait(timeout=60)
            except subprocess.TimeoutExpired:
                record["timedOut"] = True
                child.kill()  # Only this diagnostic's own handle; no app, GUI or production process.
                result = child.wait()
            native = ctypes.c_ulong()
            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            get_exit = kernel.GetExitCodeProcess
            get_exit.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
            get_exit.restype = ctypes.c_int
            assert get_exit(int(child._handle), ctypes.byref(native)), "GetExitCodeProcess failed"
        unsigned = native.value & 0xffffffff
        record.update(pythonReturnCode=result, nativeUnsignedExitCode=unsigned,
            nativeSignedExitCode=ctypes.c_int32(unsigned).value, nativeExitHex=f"0x{unsigned:08X}",
            state="timed-out" if record.get("timedOut") else "native-exited",
            executableSHA256After=sha(executable), peAfter=pe_stack(executable))
        assert record["executableSHA256After"] == record["executableSHA256"] and record["peAfter"] == record["pe"]
        text = (directory / "native-output.log").read_text(encoding="utf-8", errors="replace")
        print(text[-100000:], end="", flush=True)
        record["outputSHA256"] = sha(directory / "native-output.log")
        record["nativeCauseInterpretation"] = "Raw status only; no exception/stack cause inferred by this observer."
    except Exception as error:
        record.update(state="observer-error", error=str(error))
    finally:
        record["finished"] = time.time()
        target.write_text(json.dumps(record, indent=2)+"\n")
        print(json.dumps({"nativeDirectDiagnostic":record["state"],"receipt":str(target),
            "nativeExitHex":record.get("nativeExitHex"),"error":record.get("error")}), flush=True)
    return 0 if record.get("nativeUnsignedExitCode") == 0 and not record.get("timedOut") else 1

if __name__ == "__main__":
    sys.exit(main())
