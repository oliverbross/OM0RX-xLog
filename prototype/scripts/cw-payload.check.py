#!/usr/bin/env python3
"""Exercise a staged CW payload fixture; never changes an installed application."""
import argparse
import importlib.util
import json
import pathlib
import shutil
import tempfile

spec = importlib.util.spec_from_file_location("cw_macos", pathlib.Path(__file__).with_name("cw-macos.py"))
cw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cw)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("fixture", type=pathlib.Path)
args = parser.parse_args()
fixture = args.fixture.resolve()
if not fixture.is_relative_to(cw.ROOT / ".build"):
    parser.error("Use a disposable fixture under the canonical .build directory")
cw.verify(fixture)
with tempfile.TemporaryDirectory(prefix="cw-payload-test-", dir=cw.ROOT / ".build") as temporary:
    moved = pathlib.Path(temporary) / "Offline payload with spaces"
    shutil.copytree(fixture, moved)
    cw.verify(moved)
    _, executable, runtime, resources = cw.payload_paths(moved)
    provenance_file = resources / "build-provenance.json"
    original_provenance = provenance_file.read_text()
    stale = json.loads(original_provenance); stale["sourceCommit"] = "0" * 40
    provenance_file.write_text(json.dumps(stale))
    try:
        cw.finalize(moved)
        raise AssertionError("A moved source candidate was accepted")
    except ValueError as error:
        assert "Source commit changed" in str(error), str(error)
    provenance_file.write_text(original_provenance)
    with executable.open("ab") as output:
        output.write(b"tampered")
    try:
        cw.verify(moved)
        raise AssertionError("Changed executable was accepted")
    except ValueError as error:
        assert "digest mismatch" in str(error), str(error)
    shutil.copyfile(fixture / "Contents/MacOS/xlog-cw-worker", executable)
    cw.run("install_name_tool", "-add_rpath", "/private/tmp/unapproved-runtime", executable)
    try:
        cw.verify_links(executable, runtime)
        raise AssertionError("Development library path was accepted")
    except ValueError as error:
        assert "development rpath" in str(error), str(error)
print("CW payload checks passed: offline handshake, relocation, stale source candidate, changed executable, external rpath")
