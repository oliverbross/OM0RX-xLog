"""Load original pinned modules with a finite, inspectable import overlay.

Original bytes remain in vendor. No contest expressions or SQL are converted.
The two overlaid modules have only imports/output destination adjusted.
"""
from importlib import import_module, util
from hashlib import sha256
import json
from pathlib import Path
import sys

VENDOR = Path(__file__).resolve().parents[1] / "vendor/not1mm/upstream"
_verified = False


def verify_source():
    global _verified
    if _verified:
        return
    manifest = json.loads((VENDOR.parent / "source-manifest.json").read_text(encoding="utf-8"))
    for relative, expected in manifest["sha256"].items():
        if sha256((VENDOR / relative).read_bytes()).hexdigest() != expected:
            raise RuntimeError(f"Pinned Not1MM source hash differs: {relative}")
    _verified = True


def overlay(name, replacements):
    path = VENDOR.joinpath(*name.split(".")).with_suffix(".py")
    source = path.read_text(encoding="utf-8")
    for original, replacement in replacements:
        if source.count(original) != 1:
            raise RuntimeError(f"Pinned overlay no longer matches {name}")
        source = source.replace(original, replacement)
    spec = util.spec_from_file_location(name, path)
    module = util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        exec(compile(source, str(path), "exec"), module.__dict__)
    except BaseException:
        sys.modules.pop(name, None)
        raise
    return module


def load_cqww():
    verify_source()
    if str(VENDOR) not in sys.path:
        sys.path.insert(0, str(VENDOR))
    import_module("not1mm.lib")
    if "not1mm.lib.plugin_common" not in sys.modules:
        overlay("not1mm.lib.plugin_common", [
            ("import adif_io\n", "# adif_io is loaded only by the unsupported import callback.\n"),
            ("from PyQt6.QtCore import QCoreApplication, Qt", "from contest_host.qt_compat import QCoreApplication, Qt"),
            ("from PyQt6.QtWidgets import QApplication, QDialog, QProgressDialog, QPushButton", "from contest_host.qt_compat import QApplication, QDialog, QProgressDialog, QPushButton"),
            ("def imp_adif(self):", "def imp_adif(self):\n    import adif_io  # real optional dependency; never a stand-in"),
        ])
    if "not1mm.plugins.cq_ww_cw" not in sys.modules:
        import_module("not1mm.plugins")
        overlay("not1mm.plugins.cq_ww_cw", [
            ("from PyQt6 import QtWidgets", "from contest_host.qt_compat import QtWidgets"),
            ("str(Path.home())", "str(self.export_directory)"),
        ])
    return sys.modules["not1mm.plugins.cq_ww_cw"]
