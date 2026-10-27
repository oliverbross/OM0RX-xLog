"""Bounded message drafts and previews. This module has no station/output owner.

The host owns transactions, session/revision fencing and the ESM projection.
Only explicit bank activation changes setup.macros; previews never allocate serials.
"""
from copy import deepcopy
import hashlib
import re

from .plugins import CONFIGURED_SENTNR_PLUGINS, SSA_MT_PLUGINS
from .upstream import adapt_cw_template

MAX_SOURCE = 65536
MAX_BANKS = 24
TEXT_TOKENS = {"MYCALL", "CALL", "HISCALL", "RST", "SNT", "EXCHANGE", "EXCH",
               "SENTNR", "PREVNR", "OTHER1", "OTHER2"}
ACTIONS = {"LOGIT": "log", "RUN": "ui", "SANDP": "ui", "WIPE": "ui"}
UNSAFE = re.compile(r"RI:|\$\(|`|(?:[A-Za-z]:[\\/])|\.\.[\\/]|\\\\|<[^>]*>|\{(?:CAT|CAT1|CAT2|PYTHON|SHELL|EXEC|CMD|WINDOWS|RUNSCRIPT|APP|FILE|OPENTXT|PATH)(?:[}:\s])", re.I)
SYNTAX = re.compile(r"\{[^{}]*\}|\[[^\[\]]*\]|#|\^.")
KEY = re.compile(r"F(?:[1-9]|1[0-2])\Z")
ASSET = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}\Z")


def _text(value, maximum, name):
    if not isinstance(value, str) or len(value) > maximum or any(ord(c) < 32 and c not in "\n\r\t" for c in value):
        raise ValueError(f"Invalid or oversized {name}")
    return value


def _scope(value):
    if not isinstance(value, dict) or set(value) != {"mode", "contest", "operator"}:
        raise ValueError("Message scope requires mode, contest and operator")
    result = {key: _text(value[key], 128, key).strip() for key in value}
    if not all(result.values()) or result["mode"] not in {"CW", "SSB", "RTTY", "DIGITAL", "MIXED"}:
        raise ValueError("Invalid message bank scope")
    return result


def _inspect(template, mode="CW"):
    """Inspect syntax only: substituted contact text is never inspected again."""
    _text(template, 1024, "message template")
    warnings, rejected, actions, assets = [], [], [], []
    if UNSAFE.search(template):
        rejected.append("Shell, Python, CAT, XML controls and file paths are unsupported")
    residue = SYNTAX.sub("", template)
    if any(char in residue for char in "{}[]^"):
        rejected.append("Malformed or nested message syntax; recursive expansion is unsupported")
    for match in SYNTAX.finditer(template):
        syntax = match.group()
        if syntax.startswith("{"):
            token = syntax[1:-1]
            if token in ACTIONS:
                actions.append({"kind": ACTIONS[token], "token": token, "executed": False})
            elif token in TEXT_TOKENS:
                continue
            elif re.fullmatch(r"VOICE(?:10|[1-9])", token):
                assets.append("f" + token[5:])
                warnings.append(f"{syntax}: Not1MM radio memory is translated to an xLog managed WAV slot; these are different providers")
            elif KEY.fullmatch(token) or token.startswith("REPEAT"):
                rejected.append(f"{syntax}: message recursion/references are unsupported")
            else:
                rejected.append(f"{syntax}: undefined or unavailable control token")
        elif syntax.startswith("["):
            asset = syntax[1:-1]
            if not ASSET.fullmatch(asset):
                rejected.append(f"{syntax}: asset must be a managed slot name, without a path")
            else:
                assets.append(asset)
        elif syntax.startswith("^") and (syntax != "^M" or mode != "RTTY"):
            rejected.append(f"{syntax}: unavailable control; ^M requires the RTTY provider")
    tokens = [action["token"] for action in actions]
    if "RUN" in tokens and "SANDP" in tokens or len(tokens) != len(set(tokens)):
        rejected.append("Conflicting or repeated message actions")
    return {"warnings": warnings, "rejections": rejected, "actions": actions, "assets": assets}


def _rows(rows, mode):
    if not isinstance(rows, list) or len(rows) > 24:
        raise ValueError("At most 24 message rows are supported")
    result, seen = [], set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"mode", "key", "label", "template"}:
            raise ValueError("Invalid message row")
        if not isinstance(row["mode"], str) or not isinstance(row["key"], str):
            raise ValueError("Invalid message key")
        identity = (row["mode"], row["key"])
        if row["mode"] not in {"R", "S"} or not KEY.fullmatch(row["key"]) or identity in seen:
            raise ValueError("Invalid or repeated message key")
        seen.add(identity)
        _text(row["label"], 128, "message label")
        _text(row["template"], 1024, "message template")
        if any(char in row["label"] for char in "|\r\n") or any(char in row["template"] for char in "\r\n"):
            raise ValueError("Message rows must remain single-line; use ^M for supported newlines")
        report = _inspect(row["template"], mode)
        if report["rejections"]:
            raise ValueError("; ".join(report["rejections"]))
        result.append(deepcopy(row))
    return result


def import_message_bank(params):
    """Return an unpersisted draft, retaining the exact original source and report.

    Not1MM uses R|F1|label|template. N1MM .mc uses explicit Run/S&P
    comment sections and F1 label,template lines. No dialect guessing.
    """
    dialect = params.get("dialect")
    if dialect not in ("not1mm", "n1mm"):
        raise ValueError("Choose the N1MM or Not1MM dialect explicitly")
    source = _text(params.get("source"), MAX_SOURCE, "message source")
    scope = _scope(params.get("scope"))
    name = _text(params.get("name", "Imported messages"), 128, "bank name").strip()
    if not name:
        raise ValueError("Bank name is required")
    rows, report, seen, bank_mode = [], [], set(), None
    for number, line in enumerate(source.splitlines(), 1):
        if number > 256:
            report.append({"line": number, "status": "rejected", "message": "Import exceeds the 256-line review bound; original source retained"})
            break
        if not line.strip():
            continue
        if line.lstrip().startswith(("#", ";")):
            # N1MM exports commonly delimit banks with these comment headings.
            heading = line.lstrip("#; \t").strip().casefold()
            if "s&p" in heading or "search and pounce" in heading or "search & pounce" in heading:
                bank_mode = "S"
            elif re.search(r"\brun\b", heading):
                bank_mode = "R"
            continue
        row = None
        if dialect == "not1mm":
            pieces = line.split("|", 3)
            if len(pieces) == 4:
                row = dict(zip(("mode", "key", "label", "template"), pieces))
        else:
            match = re.fullmatch(r"(F(?:[1-9]|1[0-2]))\s+([^,]*),(.*)", line)
            if match and bank_mode:
                key, label, template = match.groups()
                # This is intentionally a small declared subset, not N1MM execution.
                translated = template.replace("!", "{CALL}").replace("*", "{MYCALL}")
                row = {"mode": bank_mode, "key": key, "label": label.strip(), "template": translated}
                if translated != template:
                    report.append({"line": number, "status": "translated", "message": "N1MM ! → {CALL}; * → {MYCALL}; # remains simulated serial"})
                if "@" in template or "~" in template:
                    report.append({"line": number, "status": "rejected", "message": "N1MM @/~ shorthand has no declared translation"})
                    continue
        if row is None or row["mode"] not in {"R", "S"} or not KEY.fullmatch(row["key"]):
            report.append({"line": number, "status": "rejected", "message": "Invalid row or missing explicit Run/S&P section"})
            continue
        identity = (row["mode"], row["key"])
        if identity in seen:
            report.append({"line": number, "status": "rejected", "message": "Repeated bank/key"})
            continue
        seen.add(identity)
        try:
            _text(row["label"], 128, "message label")
            check = _inspect(row["template"], scope["mode"])
        except ValueError as exc:
            check = {"rejections": [str(exc)], "warnings": []}
        for status, key in (("warning", "warnings"), ("rejected", "rejections")):
            report.extend({"line": number, "status": status, "message": item} for item in check[key])
        if check["rejections"]:
            continue
        if dialect == "not1mm":
            row["template"] = re.sub(r"\{VOICE(10|[1-9])\}", lambda m: f"[f{m[1]}]", row["template"])
        rows.append(row)
        report.append({"line": number, "status": "supported", "message": f"{row['mode']} {row['key']} staged; no active messages changed"})
    if not rows:
        report.append({"line": 0, "status": "rejected", "message": "No supported message rows"})
    missing = 24 - len(rows)
    if missing:
        report.append({"line": 0, "status": "warning", "message": f"{missing} missing rows remain disabled in this named bank"})
    rows = [{"mode": mode, "key": f"F{i}", "label": "", "template": "",
             **next((r for r in rows if r["mode"] == mode and r["key"] == f"F{i}"), {})}
            for mode in ("R", "S") for i in range(1, 13)]
    return {"bank": {"name": name, "scope": scope, "dialect": dialect, "original": source,
                     "originalSHA256": hashlib.sha256(source.encode()).hexdigest(), "macros": rows},
            "report": report, "canSave": not any(r["status"] == "rejected" for r in report)}


def message_projection(state):
    data = state.get("messageWorkbench", {})
    return {"banks": deepcopy(data.get("banks", [])), "activeBankID": data.get("activeBankID")}


def apply_message_mutation(state, method, params, *, setup_document=None):
    """Called inside the host transaction; host supplies its canonical default setup.

    Newly created sessions have no persisted setup override until a setup edit
    or message bank activation. Default construction stays with the host owner.
    """
    data = deepcopy(state.get("messageWorkbench", {"banks": [], "activeBankID": None}))
    if method == "message_bank_save":
        bank = deepcopy(params.get("bank"))
        if not isinstance(bank, dict):
            raise ValueError("Message bank is required")
        scope = _scope(bank.get("scope"))
        if scope["contest"] != state["pluginID"] or scope["operator"] != state["operator"]:
            raise ValueError("Message bank scope differs from the current contest/operator")
        name = _text(bank.get("name"), 128, "bank name").strip()
        if not name or bank.get("dialect") not in ("not1mm", "n1mm"):
            raise ValueError("Named bank and explicit dialect required")
        original = _text(bank.get("original", ""), MAX_SOURCE, "original source")
        # Independently revalidate originals; caller-provided canSave/report is not authority.
        if original:
            imported = import_message_bank({"dialect": bank["dialect"], "source": original, "scope": scope, "name": name})
            if not imported["canSave"]:
                raise ValueError("Original import has rejected rows; resolve before saving")
        rows = _rows(bank.get("macros"), scope["mode"])
        if len(rows) != 24:
            raise ValueError("Named banks require both complete F1–F12 banks")
        identity = hashlib.sha256((name + "\0" + "\0".join(scope[key] for key in ("mode", "contest", "operator"))).encode()).hexdigest()[:24]
        bank = {"id": identity, "name": name, "scope": scope, "dialect": bank["dialect"], "original": original,
                "originalSHA256": hashlib.sha256(original.encode()).hexdigest(), "macros": rows}
        banks = [item for item in data["banks"] if item["id"] != identity]
        if len(banks) >= MAX_BANKS:
            raise ValueError("Message bank limit reached")
        data["banks"] = [*banks, bank]
        # Saving the active bank does not implicitly replace active setup macros.
    elif method == "message_bank_activate":
        bank = next((item for item in data["banks"] if item["id"] == params.get("bankID")), None)
        if bank is None:
            raise ValueError("Unknown message bank")
        if bank["scope"]["contest"] != state["pluginID"] or bank["scope"]["operator"] != state["operator"]:
            raise ValueError("Message bank scope differs from the current contest/operator")
        live_mode = state.get("operatingMode", state.get("draft", {}).get("mode", "CW"))
        normalized_mode = "SSB" if live_mode in {"USB", "LSB"} else "RTTY" if live_mode in {"RTTY-R", "RTTYR"} else live_mode
        if bank["scope"]["mode"] != normalized_mode:
            raise ValueError("Message bank mode differs from the current operating mode")
        rows = _rows(bank["macros"], bank["scope"]["mode"])
        # Reuse existing plugin-specific execution adapter, without executing anything.
        for row in rows:
            adapt_cw_template(state["pluginID"], row["template"])
        setup = deepcopy(state.get("setup", setup_document))
        if not isinstance(setup, dict):
            raise ValueError("Canonical contest setup is required to activate this bank")
        setup["macros"] = rows
        state["setup"] = setup
        data["activeBankID"] = bank["id"]
    else:
        raise ValueError("Unknown message mutation")
    state["messageWorkbench"] = data
    return message_projection(state)


def preview_message(state, params, projection=None):
    """Single-pass synthetic preview; no Desk, SQL, serial reservation or I/O.

    projection must be the host's ordinary read-only projection. ESM suggestions
    come from its actual plugin highlights, never an independent ESM engine.
    """
    mode = _text(params.get("mode", state.get("operatingMode", state.get("draft", {}).get("mode", "CW"))), 16, "mode")
    if mode not in {"CW", "SSB", "RTTY", "DIGITAL", "MIXED"}:
        raise ValueError("Invalid preview mode")
    template = _text(params.get("template", ""), 1024, "message template")
    check = _inspect(template, mode)
    draft = params.get("draft", state.get("draft", {}))
    if not isinstance(draft, dict):
        raise ValueError("Invalid preview draft")
    fields = draft.get("fields", {})
    if not isinstance(fields, dict) or len(fields) > 32:
        raise ValueError("Invalid preview fields")
    fields = {key: _text(value, 1024, "preview field") for key, value in fields.items()}
    serial = params.get("serial")
    if serial is not None and (type(serial) is not int or not 1 <= serial <= 999999999):
        raise ValueError("Simulated serial must be 1–999999999")
    exchange = _text(params.get("sentExchange", str(state.get("settings", {}).get("SentExchange", ""))), 1024, "sent exchange")
    serial_text = str(serial) if serial is not None else "[serial unavailable]"
    sentnr = serial_text if state["pluginID"] in SSA_MT_PLUGINS else exchange if state["pluginID"] in CONFIGURED_SENTNR_PLUGINS else fields.get("other_1", "")
    if serial is not None and state["pluginID"] not in CONFIGURED_SENTNR_PLUGINS:
        sentnr = serial_text
    values = {"MYCALL": str(state.get("station", {}).get("Call", "")), "CALL": fields.get("callsign", ""),
              "RST": fields.get("sent", ""), "EXCHANGE": exchange, "SENTNR": sentnr,
              "PREVNR": _text(params.get("previousSerial", ""), 32, "previous serial"),
              "OTHER1": fields.get("other_1", ""), "OTHER2": fields.get("other_2", "")}
    values.update({"HISCALL": values["CALL"], "SNT": values["RST"], "EXCH": exchange})
    if serial is None and ("#" in template or "{SENTNR}" in template and sentnr == serial_text):
        check["warnings"].append("No simulated serial supplied; preview does not reserve one")
    assets = params.get("assets", [])
    if not isinstance(assets, list) or len(assets) > 64 or any(not isinstance(x, str) or not ASSET.fullmatch(x) for x in assets):
        raise ValueError("Invalid managed asset inventory")
    for asset in check["assets"]:
        if asset not in assets:
            check["rejections"].append(f"Managed WAV asset [{asset}] is missing/unverified; preview blocked")
    provider = params.get("providerAvailable") is True
    if template.strip() and not provider:
        check["warnings"].append(f"{mode} output provider unavailable/unverified; manual logging remains available")
    def expand(match):
        syntax = match.group()
        if syntax == "#":
            return serial_text
        if syntax == "^M":
            return "\n"
        if syntax.startswith("{"):
            token = syntax[1:-1]
            if token in ACTIONS:
                return ""
            # Configured exchange # is the one existing Not1MM exception;
            # received fields remain completely opaque even when they look hostile.
            value = values.get(token, syntax)
            return value.replace("#", serial_text) if token == "EXCHANGE" else value
        return syntax
    if not check["rejections"]:
        try:
            template = adapt_cw_template(state["pluginID"], template)
        except RuntimeError as exc:
            check["rejections"].append(str(exc))
    rendered = SYNTAX.sub(expand, template) if not check["rejections"] else ""
    if len(rendered) > 16384:
        raise ValueError("Rendered preview exceeds bound")
    highlighted = [item["id"] for item in (projection or {}).get("functionKeys", []) if item.get("highlighted")]
    return {"text": rendered, **check, "noOutput": True, "providerAvailable": provider,
            "binding": {"draftID": draft.get("id"), "serial": serial, "sessionID": state.get("sessionID")},
            "nextESM": {"keys": highlighted, "basis": "Current plugin projection highlights" if projection else "Unavailable: no current plugin projection",
                        "draftID": (projection or {}).get("draftID"),
                        "warning": "Current-entry suggestion only; supplied next-draft preview does not simulate plugin ESM transitions"}}
