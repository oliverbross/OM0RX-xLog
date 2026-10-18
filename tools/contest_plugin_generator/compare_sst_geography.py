#!/opt/homebrew/bin/python3.14
"""Inspect the pinned SST arithmetic without importing upstream modules."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Any

PIN = "7c8b499225a73f7f8f792246881bd7aefc05452f"
PLUGIN = (
    "not1mm/plugins/k1usn_sst.py",
    "73cf9b72f53c6bd65d1f804f28b4ea80f6bf82d2b8b08406b2153691fd1d8120",
)
DATABASE = (
    "not1mm/lib/database.py",
    "855840a01e80e82fc5d7e83c1e7e9f0f367e6db9be504944e0db0173e28e52e8",
)
FIXTURE = (
    Path(__file__).parents[2]
    / "Tests/XContestCoreTests/SourceFixtures/sst-geography-authority.json"
)
SELECTED = ("points", "show_mults", "calc_score")
ALLOWED_CALLS = {
    "int",
    "show_mults",
    "result.get",
    "self.database.fetch_points",
    "self.database.fetch_section_band_count_nodx",
}
DENIED_NODES = (
    ast.Import,
    ast.ImportFrom,
    ast.Lambda,
    ast.With,
    ast.AsyncWith,
    ast.Try,
    ast.Raise,
    ast.Global,
    ast.Nonlocal,
    ast.ClassDef,
)
EXPECTED_NODX_QUERY = (
    "select count(DISTINCT(Sect || ':' || Band)) as sb_count from dxlog "
    "where ContestNR = ? and Sect != 'DX';"
)
def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def dotted_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = dotted_name(node.value)
        return f"{parent}.{node.attr}" if parent else None
    return None


def fingerprint(node: ast.AST) -> str:
    return sha256(ast.dump(node, annotate_fields=True, include_attributes=False).encode())


def pinned_tree(path: Path, expected_sha: str) -> ast.Module:
    payload = path.read_bytes()
    actual = sha256(payload)
    if actual != expected_sha:
        raise ValueError(
            f"source hash mismatch for {path.name}: expected {expected_sha}, observed {actual}"
        )
    return ast.parse(payload, filename=str(path))


def load_plugin_functions(path: Path, expected_sha: str) -> tuple[dict[str, Any], dict[str, str]]:
    tree = pinned_tree(path, expected_sha)
    functions = {
        node.name: node for node in tree.body if isinstance(node, ast.FunctionDef)
    }
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
                    raise ValueError(
                        f"unreviewed call {target!r} in {path.name}:{function.name}"
                    )
    module = ast.fix_missing_locations(ast.Module(body=selected, type_ignores=[]))
    namespace: dict[str, Any] = {"__builtins__": {"int": int}}
    exec(compile(module, str(path), "exec"), namespace)  # exact-hash, allowlisted AST only
    return namespace, {name: fingerprint(functions[name]) for name in SELECTED}


def inspect_nodx_query(path: Path, expected_sha: str) -> tuple[str, str]:
    tree = pinned_tree(path, expected_sha)
    methods = [
        node
        for parent in tree.body
        if isinstance(parent, ast.ClassDef)
        for node in parent.body
        if isinstance(node, ast.FunctionDef)
        and node.name == "fetch_section_band_count_nodx"
    ]
    if len(methods) != 1:
        raise ValueError("expected exactly one fetch_section_band_count_nodx method")
    method = methods[0]
    queries = [
        value.value
        for value in ast.walk(method)
        if isinstance(value, ast.Constant)
        and isinstance(value.value, str)
        and value.value.lstrip().lower().startswith("select count")
    ]
    if queries != [EXPECTED_NODX_QUERY]:
        raise ValueError(f"reviewed no-DX query changed: {queries!r}")
    return queries[0], fingerprint(method)


class SQLiteDatabase:
    def __init__(self, connection: sqlite3.Connection, query: str, points: int):
        self.connection = connection
        self.query = query
        self.points = points

    def fetch_section_band_count_nodx(self):
        row = self.connection.execute(self.query, (1,)).fetchone()
        return {"sb_count": row[0]}

    def fetch_points(self):
        return {"Points": self.points}


class FakeHost:
    def __init__(self, duplicate: int, database: SQLiteDatabase):
        self.contact_is_dupe = duplicate
        self.database = database


def load_fixture_rows(
    fixture_path: Path,
) -> tuple[tuple[tuple[str, str, int], ...], tuple[tuple[str, str, int], ...]]:
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    official = tuple(
        (contact["location"], contact["band"], 1)
        for contact in fixture["officialSample"]["contacts"]
    )
    guards = tuple(
        (row["section"], row["band"], row["contestNumber"])
        for row in fixture["pythonComparator"]["queryGuardRows"]
    )
    if len(official) != 12:
        raise ValueError(f"expected 12 official sample rows, observed {len(official)}")
    if len(guards) != 2:
        raise ValueError(f"expected 2 query guard rows, observed {len(guards)}")
    return official, guards


def sample_database(
    query: str,
    official_rows: tuple[tuple[str, str, int], ...],
    guard_rows: tuple[tuple[str, str, int], ...],
) -> tuple[sqlite3.Connection, SQLiteDatabase]:
    connection = sqlite3.connect(":memory:")
    connection.execute("create table dxlog (Sect text, Band text, ContestNR integer)")
    connection.executemany(
        "insert into dxlog (Sect, Band, ContestNR) values (?, ?, ?)",
        official_rows + guard_rows,
    )
    return connection, SQLiteDatabase(connection, query, points=len(official_rows))


def compare(source_root: Path, fixture_path: Path = FIXTURE) -> dict[str, Any]:
    plugin_path = source_root / PLUGIN[0]
    database_path = source_root / DATABASE[0]
    namespace, plugin_fingerprints = load_plugin_functions(plugin_path, PLUGIN[1])
    query, query_fingerprint = inspect_nodx_query(database_path, DATABASE[1])
    official_rows, guard_rows = load_fixture_rows(fixture_path)
    connection, database = sample_database(query, official_rows, guard_rows)
    try:
        sample = FakeHost(0, database)
        duplicate = FakeHost(1, database)
        without_dx_filter = query.replace(" and Sect != 'DX'", "")
        without_contest_filter = query.replace(
            "where ContestNR = ? and Sect != 'DX'", "where Sect != 'DX'"
        )
        return {
            "upstreamRevision": PIN,
            "execution": "selected exact-hash allowlisted AST plus in-memory sqlite3",
            "plugin": {
                "path": PLUGIN[0],
                "sha256": PLUGIN[1],
                "functionFingerprints": plugin_fingerprints,
            },
            "database": {
                "path": DATABASE[0],
                "sha256": DATABASE[1],
                "methodFingerprint": query_fingerprint,
                "query": query,
                "excludedSectionToken": "DX",
            },
            "comparatorInput": {
                "officialSampleRows": len(official_rows),
                "queryGuardRows": len(guard_rows),
                "points": database.points,
            },
            "queryControls": {
                "exactReviewedQuery": database.fetch_section_band_count_nodx()["sb_count"],
                "withoutDXFilter": connection.execute(
                    without_dx_filter, (1,)
                ).fetchone()[0],
                "withoutContestFilter": connection.execute(
                    without_contest_filter
                ).fetchone()[0],
            },
            "sourceOutcomes": {
                "acceptedPoints": namespace["points"](sample),
                "duplicatePoints": namespace["points"](duplicate),
                "officialSampleSectionBandCount": namespace["show_mults"](sample),
                "officialSampleScore": namespace["calc_score"](sample),
            },
        }
    finally:
        connection.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--fixture", type=Path, default=FIXTURE)
    args = parser.parse_args()
    print(json.dumps(compare(args.source_root, args.fixture), sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
