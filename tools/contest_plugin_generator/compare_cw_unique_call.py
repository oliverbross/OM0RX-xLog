#!/opt/homebrew/bin/python3.14
"""Run three reviewed pure scoring functions without importing plugin modules."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
from pathlib import Path

PIN = "7c8b499225a73f7f8f792246881bd7aefc05452f"
PLUGINS = {
    "cwt": ("cwt.py", "12010bc2f8a4822e45444c996f82993aea952916405de8449a3ca6fe68c9de64"),
    "cwOpen": ("cwo.py", "e162c7e11759cd97322e2d60257f05e47312d997751c2fb2db2b5751872b3a8e"),
    "icwcMST": ("icwc_mst.py", "4fcf5971b539a3f7634fea21a752d1a5915d8d11f08c14d0a608a62d57ffb8ca"),
}
SELECTED = ("points", "show_mults", "calc_score")
ALLOWED_CALLS = {
    "int", "show_mults", "result.get",
    "self.database.fetch_call_count", "self.database.fetch_points",
}
DENIED_NODES = (ast.Import, ast.ImportFrom, ast.Lambda, ast.With, ast.AsyncWith,
                ast.Try, ast.Raise, ast.Global, ast.Nonlocal, ast.ClassDef)


def dotted_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = dotted_name(node.value)
        return f"{parent}.{node.attr}" if parent else None
    return None


def load_functions(path: Path, expected_sha: str) -> dict[str, object]:
    payload = path.read_bytes()
    actual = hashlib.sha256(payload).hexdigest()
    if actual != expected_sha:
        raise ValueError(f"source hash mismatch for {path.name}: expected {expected_sha}, observed {actual}")
    tree = ast.parse(payload, filename=str(path))
    functions = {node.name: node for node in tree.body if isinstance(node, ast.FunctionDef)}
    missing = sorted(set(SELECTED) - functions.keys())
    if missing:
        raise ValueError(f"missing selected functions in {path.name}: {', '.join(missing)}")
    selected = [functions[name] for name in SELECTED]
    for function in selected:
        for node in ast.walk(function):
            if isinstance(node, DENIED_NODES):
                raise ValueError(f"denied {type(node).__name__} in {path.name}:{function.name}")
            if isinstance(node, ast.Call):
                target = dotted_name(node.func)
                if target not in ALLOWED_CALLS:
                    raise ValueError(f"unreviewed call {target!r} in {path.name}:{function.name}")
    module = ast.fix_missing_locations(ast.Module(body=selected, type_ignores=[]))
    namespace: dict[str, object] = {"__builtins__": {"int": int}}
    exec(compile(module, str(path), "exec"), namespace)  # exact-hash, allowlisted AST only
    return namespace


class FakeDatabase:
    def __init__(self, call_count: int, points: int):
        self.call_count = call_count
        self.points = points

    def fetch_call_count(self):
        return {"call_count": self.call_count}

    def fetch_points(self):
        return {"Points": self.points}


class FakeHost:
    def __init__(self, dupe: int, call_count: int, points: int):
        self.contact_is_dupe = dupe
        self.database = FakeDatabase(call_count, points)


def compare(source_root: Path) -> dict[str, object]:
    results = []
    for plugin, (filename, expected_sha) in PLUGINS.items():
        namespace = load_functions(source_root / "not1mm" / "plugins" / filename, expected_sha)
        points = namespace["points"]
        show_mults = namespace["show_mults"]
        calc_score = namespace["calc_score"]
        results.append({
            "plugin": plugin,
            "source": f"not1mm/plugins/{filename}",
            "sha256": expected_sha,
            "cases": {
                "acceptedPoints": points(FakeHost(0, 2, 3)),
                "duplicatePoints": points(FakeHost(1, 2, 3)),
                "uniqueCallMultipliers": show_mults(FakeHost(0, 2, 3)),
                "score": calc_score(FakeHost(0, 2, 3)),
            },
        })
    return {"upstreamRevision": PIN, "execution": "selected exact-hash allowlisted AST only", "results": results}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(compare(args.source_root), sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
