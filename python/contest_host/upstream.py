"""Load original pinned modules with a finite, inspectable import overlay.

Original bytes remain in vendor. No contest expressions or SQL are converted.
The overlaid modules have only imports/output destination adjusted.
"""
from importlib import import_module, util
from hashlib import sha256
import json
from pathlib import Path
import re
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


def adapt_cw_template(plugin_id, template):
    """Adapt one pinned or persisted Not1MM template to xLog's output tokens."""
    replacements = {"HISCALL": "CALL", "SNT": "RST", "EXCH": "EXCHANGE"}
    for upstream, native in replacements.items():
        template = template.replace("{" + upstream + "}", "{" + native + "}")
    if plugin_id == "cq_ww_cw":
        # CQ WW's configured zone is the number meant by MyNR. Persisted
        # macro-editor rows must receive the same migration as pinned defaults.
        template = template.replace("{SENTNR}", "{EXCHANGE}")
    if re.findall(r"\{([^}]+)\}", template) and any(
            token not in {"MYCALL", "CALL", "RST", "EXCHANGE", "SENTNR"}
            for token in re.findall(r"\{([^}]+)\}", template)):
        raise RuntimeError("Pinned Not1MM CW macro uses an unsupported token")
    return template


def load_cw_macros(plugin_id="cq_ww_cw"):
    """Return the pinned Not1MM Run/S&P macro text through a finite token adapter."""
    verify_source()
    result = {}
    source = VENDOR / "not1mm/data/cwmacros.txt"
    for line in source.read_text(encoding="utf-8").splitlines():
        parts = line.split("|", 3)
        if len(parts) != 4 or parts[0] not in {"S", "R"} or re.fullmatch(r"F(?:[1-9]|1[0-2])", parts[1]) is None:
            raise RuntimeError("Pinned Not1MM CW macro source is invalid")
        template = adapt_cw_template(plugin_id, parts[3])
        result[(parts[0], parts[1])] = {"label": parts[2], "template": template}
    if plugin_id == "cq_wpx_cw":
        # The shipped macros target a configured exchange. WPX sends the
        # host-reserved draft serial, independently of that configured text.
        for mode in ("R", "S"):
            result[(mode, "F3")]["template"] = "{RST} {SENTNR}"
    elif plugin_id == "arrl_ss_cw":
        # The pinned plugin's SOAPBOX_HINT gives its exchange macro explicitly.
        for mode in ("R", "S"):
            result[(mode, "F3")]["template"] = "{CALL} {SENTNR} {EXCHANGE}"
    if len(result) != 24:
        raise RuntimeError("Pinned Not1MM CW macro set is incomplete")
    return result


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


def load_plugin(plugin_id="cq_ww_cw"):
    if plugin_id not in {"cq_ww_cw", "cq_wpx_cw", "arrl_ss_cw"}:
        raise ValueError("Unsupported pinned plugin")
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
    module_name = f"not1mm.plugins.{plugin_id}"
    if module_name not in sys.modules:
        import_module("not1mm.plugins")
        overlay(module_name, [
            ("from PyQt6 import QtWidgets", "from contest_host.qt_compat import QtWidgets"),
            ("str(Path.home())", "str(self.export_directory)"),
        ])
    return sys.modules[module_name]


def load_cqww():
    return load_plugin("cq_ww_cw")
