#!/opt/homebrew/bin/python3.14
"""Safely inventory pinned contest-sw plugins without importing or executing them."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "1.0.0"
EXTRACTOR_VERSION = "1.0.0"
REQUIRED_PIN = "7c8b499225a73f7f8f792246881bd7aefc05452f"
REQUIRED_PYTHON = (3, 14)
DECLARATIONS = ("name", "cabrillo_name", "mode", "EXCHANGE_HINT", "columns", "dupe_type")
REQUIRED_DECLARATIONS = ("name", "cabrillo_name", "mode", "columns", "dupe_type")
BEHAVIOR_KINDS = {
    "points": "points",
    "show_mults": "multipliers",
    "show_mults_per_band": "multipliers",
    "calc_score": "score",
    "recalculate_mult": "recalculation",
    "recalculate_mults": "recalculation",
    "set_contact_vars": "exchange-mapping",
    "prefill": "prefill",
    "predupe": "history",
    "populate_history_info_line": "history",
    "check_call_history": "history",
    "adif": "export-adif",
    "cabrillo": "export-cabrillo",
    "process_esm": "esm",
    "set_tab_next": "tab-order",
    "set_tab_prev": "tab-order",
    "interface": "ui",
    "init_contest": "initialization",
}
UI_METHODS = {"show", "hide", "setText", "setAccessibleName"}


def require_inventory_python(version_info: tuple[int, ...] | None = None) -> None:
    """Keep version-sensitive ast.dump fingerprints reproducible."""
    observed = tuple(version_info or sys.version_info)
    if observed[:2] != REQUIRED_PYTHON:
        found = ".".join(str(part) for part in observed[:3])
        required = ".".join(str(part) for part in REQUIRED_PYTHON)
        raise SystemExit(
            f"contest plugin inventory requires Python {required}.x; found {found} "
            "(ast.dump fingerprints are Python-version-dependent)"
        )


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def location(node: ast.AST, function: str | None = None) -> dict[str, Any]:
    value: dict[str, Any] = {
        "line": getattr(node, "lineno", 0),
        "endLine": getattr(node, "end_lineno", getattr(node, "lineno", 0)),
    }
    if function:
        value["function"] = function
    return value


def canonical_fingerprint(node: ast.AST) -> str:
    return digest(ast.dump(node, annotate_fields=True, include_attributes=False).encode())


def dotted_name(node: ast.AST) -> str | None:
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        return ".".join(reversed(parts))
    return None


def self_attribute(node: ast.AST) -> str | None:
    if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == "self":
        return node.attr
    return None


def static_value(node: ast.AST) -> tuple[bool, Any]:
    try:
        return True, ast.literal_eval(node)
    except (ValueError, TypeError, SyntaxError, MemoryError, RecursionError):
        return False, None


def translated_text(node: ast.AST) -> tuple[bool, str | None]:
    resolved, value = static_value(node)
    if resolved and isinstance(value, str):
        return True, value
    if isinstance(node, ast.Call) and dotted_name(node.func) in {
        "QtWidgets.QApplication.translate", "QCoreApplication.translate"
    } and len(node.args) >= 2:
        resolved, value = static_value(node.args[1])
        if resolved and isinstance(value, str):
            return True, value
    return False, None


def iter_with_branch_depth(node: ast.AST, depth: int = 0):
    yield node, depth
    branch_nodes = (ast.If, ast.IfExp, ast.Match, ast.For, ast.AsyncFor, ast.While, ast.Try, ast.With, ast.AsyncWith)
    child_depth = depth + 1 if isinstance(node, branch_nodes) else depth
    for child in ast.iter_child_nodes(node):
        yield from iter_with_branch_depth(child, child_depth)


def expression_sources(node: ast.AST) -> list[str]:
    result = {
        name
        for child in ast.walk(node)
        if (name := dotted_name(child)) is not None and name.startswith("self.")
    }
    return sorted(result)


def extract_declarations(tree: ast.Module) -> dict[str, dict[str, Any]]:
    found: dict[str, dict[str, Any]] = {}
    assignments: dict[str, list[ast.AST]] = {key: [] for key in DECLARATIONS}
    dynamic_changes: dict[str, list[ast.AST]] = {key: [] for key in DECLARATIONS}
    for node in tree.body:
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        value_node = node.value
        if value_node is None:
            continue
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        for target in targets:
            if not isinstance(target, ast.Name) or target.id not in DECLARATIONS:
                continue
            assignments[target.id].append(node)
            resolved, value = static_value(value_node)
            found[target.id] = {
                "status": "resolved" if resolved else "unresolved",
                **({"value": value} if resolved else {"reason": "non-literal top-level assignment"}),
                "provenance": {**location(node), "astSha256": canonical_fingerprint(value_node)},
            }
    top_level_node_ids = {id(node) for node in tree.body}
    mutators = {"append", "extend", "insert", "remove", "pop", "clear", "sort", "reverse", "update", "setdefault"}
    def module_scope_nodes(node: ast.AST):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
            return
        yield node
        for child in ast.iter_child_nodes(node):
            yield from module_scope_nodes(child)

    for node in module_scope_nodes(tree):
        if isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign, ast.NamedExpr)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                if isinstance(target, ast.Name) and target.id in DECLARATIONS:
                    if isinstance(node, ast.AugAssign) or id(node) not in top_level_node_ids:
                        dynamic_changes[target.id].append(node)
                elif isinstance(target, ast.Subscript) and isinstance(target.value, ast.Name):
                    if target.value.id in DECLARATIONS:
                        dynamic_changes[target.value.id].append(node)
        elif isinstance(node, ast.Delete):
            for target in node.targets:
                name = target.id if isinstance(target, ast.Name) else (
                    target.value.id if isinstance(target, ast.Subscript) and isinstance(target.value, ast.Name) else None
                )
                if name in DECLARATIONS:
                    dynamic_changes[name].append(node)
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in mutators:
            if isinstance(node.func.value, ast.Name) and node.func.value.id in DECLARATIONS:
                dynamic_changes[node.func.value.id].append(node)
    for key in DECLARATIONS:
        found.setdefault(key, {"status": "missing", "reason": "no top-level assignment"})
        if dynamic_changes[key]:
            found[key] = {
                "status": "unresolved",
                "reason": "declaration is reassigned or mutated; effective runtime value is not statically promoted",
                "provenance": [location(node) for node in assignments[key] + dynamic_changes[key]],
            }
    return found


def imports(tree: ast.Module) -> list[str]:
    values: set[str] = set()
    for node in tree.body:
        if isinstance(node, ast.Import):
            values.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            values.add(node.module or "")
    return sorted(value for value in values if value)


def function_inventory(function: ast.FunctionDef | ast.AsyncFunctionDef) -> dict[str, Any]:
    calls = sorted({name for node in ast.walk(function) if isinstance(node, ast.Call) and (name := dotted_name(node.func))})
    host_dependencies = sorted({name for name in calls if name.startswith("self.")})
    returns: list[dict[str, Any]] = []
    for node in ast.walk(function):
        if isinstance(node, ast.Return) and node.value is not None:
            resolved, value = static_value(node.value)
            returns.append({
                "status": "resolved" if resolved else "dynamic",
                **({"value": value} if resolved else {"astSha256": canonical_fingerprint(node.value)}),
                "provenance": location(node, function.name),
            })
    shape = {
        "branches": sum(isinstance(node, (ast.If, ast.IfExp, ast.Match)) for node in ast.walk(function)),
        "loops": sum(isinstance(node, (ast.For, ast.AsyncFor, ast.While)) for node in ast.walk(function)),
        "tries": sum(isinstance(node, ast.Try) for node in ast.walk(function)),
        "returns": len(returns),
    }
    evidence: list[str] = []
    if any(name.startswith("self.database.") for name in calls):
        evidence.append("database-dependent")
    if "self.cty_lookup" in calls:
        evidence.append("entity-dependent")
    if any("serial" in name.lower() or "current_sn" in name.lower() for name in host_dependencies):
        evidence.append("serial-dependent")
    if returns and all(item["status"] == "resolved" and isinstance(item.get("value"), (int, float)) for item in returns):
        evidence.append("literal-numeric-return-candidates")
    if shape["branches"]:
        evidence.append("branch-dependent")
    return {
        "name": function.name,
        "kind": BEHAVIOR_KINDS.get(function.name, "other"),
        "provenance": {**location(function, function.name), "astSha256": canonical_fingerprint(function)},
        "calls": calls,
        "hostDependencies": host_dependencies,
        "shape": shape,
        "returnEvidence": returns,
        "patternEvidence": evidence,
        "semanticStatus": "unresolved",
        "semanticReason": "AST shape inventories behavior but does not prove contest semantics",
    }


def extract_ui(functions: dict[str, ast.FunctionDef | ast.AsyncFunctionDef]) -> dict[str, Any]:
    operations: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []
    interface = functions.get("interface")
    if interface:
        for node, depth in iter_with_branch_depth(interface):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
                continue
            target = self_attribute(node.func.value)
            method = node.func.attr
            if target is None or method not in UI_METHODS:
                continue
            base = {"target": target, "action": method, "branchDependent": depth > 0,
                    "provenance": location(node, "interface")}
            if method in {"show", "hide"} and not node.args:
                operations.append(base)
            elif method in {"setText", "setAccessibleName"} and node.args:
                ok, text = translated_text(node.args[0])
                if ok:
                    operations.append({**base, "value": text})
                else:
                    unresolved.append({**base, "reason": "dynamic UI text", "astSha256": canonical_fingerprint(node.args[0])})

    tab_orders: dict[str, Any] = {}
    for function_name, attribute in (("set_tab_next", "tab_next"), ("set_tab_prev", "tab_prev")):
        function = functions.get(function_name)
        if not function:
            tab_orders[attribute] = {"status": "missing"}
            continue
        matches = []
        for node, depth in iter_with_branch_depth(function):
            if not isinstance(node, ast.Assign) or len(node.targets) != 1:
                continue
            target = node.targets[0]
            if not isinstance(target, ast.Attribute) or dotted_name(target) != f"self.{attribute}":
                continue
            if isinstance(node.value, ast.Dict):
                pairs = []
                valid = True
                for key, value in zip(node.value.keys, node.value.values, strict=True):
                    key_name = self_attribute(key) if key else None
                    value_name = self_attribute(value)
                    if key_name is None or value_name is None:
                        valid = False
                        break
                    pairs.append({"from": key_name, "to": value_name})
                matches.append((node, depth, valid, pairs))
        if len(matches) == 1 and matches[0][2] and matches[0][1] == 0:
            node, _, _, pairs = matches[0]
            tab_orders[attribute] = {"status": "resolved", "edges": pairs, "provenance": location(node, function_name)}
        else:
            tab_orders[attribute] = {"status": "unresolved", "reason": "tab map is missing, dynamic, or branch-dependent"}

    mappings: list[dict[str, Any]] = []
    function = functions.get("set_contact_vars")
    if function:
        for node, depth in iter_with_branch_depth(function):
            if not isinstance(node, (ast.Assign, ast.AnnAssign)):
                continue
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            if len(targets) != 1 or node.value is None:
                continue
            target = targets[0]
            if not isinstance(target, ast.Subscript) or dotted_name(target.value) != "self.contact":
                continue
            resolved, key = static_value(target.slice)
            if not resolved or not isinstance(key, str):
                unresolved.append({"action": "contact-mapping", "reason": "dynamic contact key",
                                   "provenance": location(node, "set_contact_vars")})
                continue
            mappings.append({
                "contactField": key,
                "expression": ast.unparse(node.value),
                "sources": expression_sources(node.value),
                "branchDependent": depth > 0,
                "provenance": {**location(node, "set_contact_vars"), "astSha256": canonical_fingerprint(node.value)},
            })
    label_fields = {"snt_label": "field1", "rcv_label": "field2", "other_label": "field3", "exch_label": "field4"}
    field_labels = [
        {"field": label_fields[item["target"]], "labelTarget": item["target"], "value": item["value"],
         "branchDependent": item["branchDependent"], "provenance": item["provenance"]}
        for item in operations
        if item["action"] == "setText" and item["target"] in label_fields and "value" in item
    ]
    visibility = [
        {"field": item["target"], "visible": item["action"] == "show",
         "branchDependent": item["branchDependent"], "provenance": item["provenance"]}
        for item in operations
        if item["action"] in {"show", "hide"} and item["target"].startswith("field")
    ]
    return {"operations": operations, "fieldLabels": field_labels, "fieldVisibility": visibility,
            "tabOrder": tab_orders, "contactMappings": mappings, "unresolved": unresolved}


def disposition(declarations: dict[str, Any], ui: dict[str, Any], parse_error: str | None) -> tuple[str, list[str]]:
    reasons: list[str] = []
    if parse_error:
        return "manual", [parse_error]
    missing = [key for key in REQUIRED_DECLARATIONS if declarations[key]["status"] == "missing"]
    dynamic = [key for key in REQUIRED_DECLARATIONS if declarations[key]["status"] == "unresolved"]
    if missing:
        return "unknown", [f"missing required declarations: {', '.join(missing)}"]
    if dynamic:
        return "manual", [f"dynamic required declarations: {', '.join(dynamic)}"]
    if ui["unresolved"] or any(value["status"] == "unresolved" for value in ui["tabOrder"].values()):
        reasons.append("one or more UI values require a bounded adapter or manual policy mapping")
        return "needs-adapter", reasons
    return "automatic", ["declared metadata and recognized UI wiring extracted; scoring semantics remain unresolved"]


def plugin_record(path: Path, plugin_root: Path) -> dict[str, Any]:
    raw = path.read_bytes()
    source = raw.decode("utf-8")
    parse_error = None
    try:
        tree = ast.parse(source, filename=str(path))
    except SyntaxError as error:
        parse_error = f"syntax error at line {error.lineno}: {error.msg}"
        declarations = {key: {"status": "unresolved", "reason": parse_error} for key in DECLARATIONS}
        ui = {"operations": [], "fieldLabels": [], "fieldVisibility": [], "tabOrder": {},
              "contactMappings": [], "unresolved": []}
        functions: dict[str, ast.FunctionDef | ast.AsyncFunctionDef] = {}
        imported: list[str] = []
    else:
        declarations = extract_declarations(tree)
        functions = {node.name: node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
        ui = extract_ui(functions)
        imported = imports(tree)
    category, reasons = disposition(declarations, ui, parse_error)
    return {
        "pluginID": path.stem,
        "source": {"path": path.relative_to(plugin_root.parent.parent).as_posix(), "sha256": digest(raw), "bytes": len(raw)},
        "declarations": declarations,
        "ui": ui,
        "behavior": {
            "functions": [function_inventory(functions[name]) for name in sorted(functions) if name in BEHAVIOR_KINDS],
            "imports": imported,
            "semanticStatus": "unresolved",
        },
        "coverageDisposition": category,
        "coverageReasons": reasons,
    }


def git_head(root: Path) -> str:
    result = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"], check=False, capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(f"cannot resolve upstream git HEAD: {result.stderr.strip()}")
    return result.stdout.strip()


def build_inventory(upstream: Path, ledger_path: Path, required_pin: str) -> dict[str, Any]:
    require_inventory_python()
    actual_pin = git_head(upstream)
    if actual_pin != required_pin:
        raise SystemExit(f"pin mismatch: expected {required_pin}, found {actual_pin}")
    ledger_raw = ledger_path.read_bytes()
    ledger = json.loads(ledger_raw)
    if ledger.get("upstream", {}).get("commit") != required_pin:
        raise SystemExit("pin mismatch: acceptance ledger records a different upstream commit")
    plugin_root = upstream / ledger["upstream"]["pluginRoot"]
    paths = sorted(plugin_root.glob("*.py"))
    excluded_paths = {item["path"] for item in ledger["upstream"].get("excluded", [])}
    included = [path for path in paths if path.relative_to(upstream).as_posix() not in excluded_paths]
    records = [plugin_record(path, plugin_root) for path in included]
    ledger_ids = [row["pluginID"] for row in ledger["plugins"]]
    extracted_ids = [row["pluginID"] for row in records]
    if sorted(ledger_ids) != sorted(extracted_ids):
        missing = sorted(set(ledger_ids) - set(extracted_ids))
        extra = sorted(set(extracted_ids) - set(ledger_ids))
        raise SystemExit(f"ledger reconciliation failed: missing={missing} extra={extra}")
    if len(paths) != ledger["upstream"]["pluginPythonFileCount"] or len(records) != ledger["upstream"]["contestPluginCount"]:
        raise SystemExit("ledger reconciliation failed: plugin counts differ")
    ledger_sources = {row["pluginID"]: row.get("source", {}) for row in ledger["plugins"]}
    for record in records:
        expected = ledger_sources[record["pluginID"]]
        if record["source"]["path"] != expected.get("path"):
            raise SystemExit(
                f"source path mismatch for {record['pluginID']}: "
                f"expected {expected.get('path')}, found {record['source']['path']}"
            )
        if record["source"]["sha256"] != expected.get("sha256"):
            raise SystemExit(
                f"source hash mismatch for {record['pluginID']}: "
                f"expected {expected.get('sha256')}, found {record['source']['sha256']}"
            )
    for excluded in ledger["upstream"].get("excluded", []):
        excluded_path = upstream / excluded["path"]
        if not excluded_path.is_file():
            raise SystemExit(f"excluded source is missing: {excluded['path']}")
        observed_hash = digest(excluded_path.read_bytes())
        if observed_hash != excluded.get("sha256"):
            raise SystemExit(
                f"excluded source hash mismatch for {excluded['path']}: "
                f"expected {excluded.get('sha256')}, found {observed_hash}"
            )
    dispositions = {key: 0 for key in ("automatic", "needs-adapter", "manual", "unknown")}
    for record in records:
        dispositions[record["coverageDisposition"]] += 1
    active_ids = sorted(row["pluginID"] for row in ledger["plugins"] if row["xlogAcceptance"]["implementationStatus"] != "pending")
    return {
        "schemaVersion": SCHEMA_VERSION,
        "extractor": {"name": "contest-plugin-ast-extractor", "version": EXTRACTOR_VERSION,
                      "python": f"{sys.version_info.major}.{sys.version_info.minor}"},
        "upstream": {"repository": ledger["upstream"]["repository"], "commit": actual_pin,
                     "pluginRoot": ledger["upstream"]["pluginRoot"], "pythonFileCount": len(paths),
                     "contestPluginCount": len(records), "excluded": ledger["upstream"].get("excluded", [])},
        "ledgerReconciliation": {"path": ledger_path.name, "sha256": digest(ledger_raw),
                                 "pluginIDsExact": True, "activePreviewCount": len(active_ids),
                                 "activePreviewPluginIDs": active_ids},
        "coverage": {"dispositions": dispositions,
                     "boundary": "automatic means deterministic metadata/UI extraction only; no scoring semantics are auto-accepted"},
        "plugins": records,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--upstream", type=Path, required=True)
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--required-pin", default=REQUIRED_PIN)
    args = parser.parse_args()
    inventory = build_inventory(args.upstream.resolve(), args.ledger.resolve(), args.required_pin)
    encoded = json.dumps(inventory, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(encoded, encoding="utf-8")
    else:
        sys.stdout.write(encoded)


if __name__ == "__main__":
    main()
