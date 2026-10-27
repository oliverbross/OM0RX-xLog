"""Finite developer examples for the current Python registry; no install/eval path."""
from dataclasses import asdict
import hashlib
import json
from pathlib import Path
import re
from .plugins import PLUGIN_REGISTRY
from .upstream import VENDOR, load_plugin
from .multipliers import dimensions

TEMPLATES = ("cq_wpx_cw", "naqp_cw", "darc_vhf", "wae_cw")
KIT_VERSION = "1.0.0"


def describe(plugin_id):
    if plugin_id not in TEMPLATES:
        raise ValueError("Choose one of the four reviewed Python lifecycle examples; other template mappings are not supplied")
    examples = json.loads((Path(__file__).parent / "resources/developer-examples.json").read_text())
    example = examples[plugin_id]
    registry = PLUGIN_REGISTRY[plugin_id]
    module = load_plugin(plugin_id)  # finite built-ins only, never caller source.
    path = Path(__file__).with_name("wae.py") if plugin_id.startswith("wae_") else VENDOR / f"not1mm/plugins/{plugin_id}.py"
    roles = {"callsign":"worked callsign", "sent":"sent report", "receive":"received report",
             "other_1":"host-reserved sent serial", "other_2":"received serial"}
    if plugin_id == "naqp_cw": roles.update(other_1="received name", other_2="received state/province/country token")
    if plugin_id == "darc_vhf": roles.update(other_2="received serial and six-character locator")
    return {"schemaVersion":1, "kitVersion":KIT_VERSION, "templateID":plugin_id, "engine":"not1mm-python",
            "origin":"bundled-first-party" if plugin_id.startswith("wae_") else "pinned-upstream-with-reviewed-host-adapter",
            "sourceSHA256":hashlib.sha256(path.read_bytes()).hexdigest(), "registry":asdict(registry),
            "adapterSHA256":{name:hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest() for name in ("host.py","upstream.py","store.py")},
            "dimensions":[asdict(value) for value in dimensions({**example["fixture"]["state"],"pluginID":plugin_id})],
            "reference":example["fixture"]["state"]["reference"],
            "definitionVersion":"1.0.0" if plugin_id.startswith("wae_") else example["fixture"]["state"].get("scoringRevision") or "pinned upstream; preserve legacy session marker",
            "cabrilloName":module.cabrillo_name, "fieldRoles":roles, "example":example,
            "conditionalExamples":[{"condition":"unknown country/exchange/locator", "expectation":"preserve unknown evidence; no invented score or Needed identity"},
                                   {"condition":"existing definition updated", "expectation":"explicit source/version review; do not rescore completed sessions automatically"}],
            "readiness":{"newDefinition":"UNVERIFIED", "rules":"official edition and participant/category review required", "fixtures":"existing example oracles only; replace for the new definition", "install":"developer source review only; no live package loader"},
            "requiredChecks":["tools/check_all_contests_readiness.py --plugin REGISTERED_ID --output RECEIPT.json", "focused Python host lifecycle tests", "independent expected points/multipliers/export bytes", "read-only Analytics/restart/serial and reference compatibility"],
            "conversion":{"udc":"unsupported; original retained with diagnostics", "legacySwiftDrafts":"historical archive tooling only; not a second live contest engine"}}


def inspect_udc(raw):
    if not isinstance(raw, bytes) or len(raw) > 65536:
        raise ValueError("UDC inspection is bounded to 64 KiB; no input was executed")
    try:
        content=raw.decode("utf-8",errors="strict")
    except UnicodeDecodeError:
        content=None
    keys=[]
    if content is not None:
        for number,line in enumerate(content.splitlines(),1):
            match=re.match(r"\s*([A-Za-z][A-Za-z0-9_]*)\s*=",line)
            if match:keys.append({"line":number,"key":match.group(1),"status":"unsupported"})
    return {"schemaVersion":1,"converted":False,"executed":False,"installed":False,"supportedSemantics":[],
            "reason":"UDC semantics are not translated by the Python developer kit. Bonus/QTC/dynamic exchange/control expressions require individual reviewed mappings.",
            "original":{"sha256":hashlib.sha256(raw).hexdigest(),"byteLength":len(raw),"encoding":"utf-8" if content is not None else "unrecognized", "content":content},
            "diagnostics":keys or [{"status":"unsupported","reason":"No supported UTF-8 UDC declarations"}]}
