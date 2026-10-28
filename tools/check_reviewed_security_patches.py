#!/usr/bin/env python3
"""Regression guard for the stable dependency lines adjudicated in Phase 5.

This is a narrow patch-floor check, not a replacement for an advisory scan.
Changing a reviewed release line requires reviewing/updating this policy too.
"""
import argparse
import json
from pathlib import Path
import re
import tomllib

FLOORS = {"rustls": (0, 23, 46), "rustls-webpki": (0, 103, 16), "tokio": (1, 53, 3)}
ADVISORIES = {"rustls": "RUSTSEC-2026-0346/0347/0348/0349",
              "rustls-webpki": "RUSTSEC-2026-0382", "tokio": "RUSTSEC-2026-0386"}


def violations(packages):
    errors = []
    for name, floor in FLOORS.items():
        rows = [row for row in packages if row.get("name") == name]
        if not rows:
            errors.append(f"{name}: reviewed dependency missing; review the policy")
        for row in rows:
            value = row.get("version", "")
            match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", value)
            version = tuple(map(int, match.groups())) if match else None
            if version is None or version[:2] != floor[:2]:
                errors.append(f"{name} {value}: unreviewed release line")
            elif version < floor:
                errors.append(f"{name} {value}: below reviewed patch {'.'.join(map(str, floor))} ({ADVISORIES[name]})")
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lock", type=Path, default=Path(__file__).resolve().parents[1] / "prototype/src-tauri/Cargo.lock")
    args = parser.parse_args()
    packages = tomllib.loads(args.lock.read_text())["package"]
    errors = violations(packages)
    print(json.dumps({"ok": not errors, "scope": "reviewed stable patch floors only", "errors": errors,
                      "versions": {name: [p["version"] for p in packages if p["name"] == name] for name in FLOORS}}, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
