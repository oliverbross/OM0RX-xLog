"""Print pinned contest-sw WPX helper results for fixture review.

Usage: python3 probe_wpx_prefix.py /absolute/path/to/contest-sw
This development-only probe imports the pure helper; it does not launch Not1MM.
"""

import ast
import json
import pathlib
import re
import subprocess
import sys


EXPECTED_SHA = "7c8b499225a73f7f8f792246881bd7aefc05452f"
CALLS = (
    "K1ABC",
    "K1ABC/P",
    "OM/K1ABC",
    "K1ABC/4",
    "ABCD",
    "OPON",
    "K1ABC/P/QRP",
    "3ABC",
    "EA8/K1ABC/P",
    "K1ABC/MM/QRP",
)


def main() -> None:
    root = pathlib.Path(sys.argv[1]).resolve()
    sha = subprocess.run(
        ["git", "-C", str(root), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if sha != EXPECTED_SHA:
        raise SystemExit(f"refusing unpinned source {sha}")
    source_path = "not1mm/lib/ham_utility.py"
    source = subprocess.run(
        ["git", "-C", str(root), "show", f"{EXPECTED_SHA}:{source_path}"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    module = ast.parse(source, filename=f"{EXPECTED_SHA}:{source_path}")
    function = next(
        node for node in module.body
        if isinstance(node, ast.FunctionDef) and node.name == "calculate_wpx_prefix"
    )
    namespace = {"re": re}
    exec(compile(ast.Module(body=[function], type_ignores=[]), f"{EXPECTED_SHA}:{source_path}", "exec"), namespace)
    calculate_wpx_prefix = namespace["calculate_wpx_prefix"]

    actual = [{"callsign": call, "prefix": calculate_wpx_prefix(call)} for call in CALLS]
    expected_path = pathlib.Path(__file__).with_name("wpx_prefix_expected.json")
    expected = json.loads(expected_path.read_text(encoding="utf-8"))
    if actual != expected:
        raise SystemExit("pinned WPX source fixture differs:\n" + json.dumps(actual, indent=2))
    for row in actual:
        print(f"{row['callsign']}\t{row['prefix']!r}")


if __name__ == "__main__":
    main()
