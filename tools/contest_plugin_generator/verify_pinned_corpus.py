#!/opt/homebrew/bin/python3.14
"""Required, non-skipping reconciliation check for the external pinned corpus."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from extract_plugins import REQUIRED_PIN, build_inventory


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--upstream", type=Path, required=True)
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--inventory", type=Path, required=True)
    args = parser.parse_args()
    if not args.upstream.is_dir():
        raise SystemExit(f"required pinned corpus is missing: {args.upstream}")
    current = build_inventory(args.upstream.resolve(), args.ledger.resolve(), REQUIRED_PIN)
    checked = json.loads(args.inventory.read_text(encoding="utf-8"))
    canonical_current = json.dumps(current, ensure_ascii=False, sort_keys=True)
    canonical_checked = json.dumps(checked, ensure_ascii=False, sort_keys=True)
    if canonical_current != canonical_checked:
        raise SystemExit("checked-in inventory differs from a fresh pinned-corpus extraction")
    print(json.dumps({"verified": True, "pin": REQUIRED_PIN, "plugins": len(current["plugins"]),
                      "activePreviews": current["ledgerReconciliation"]["activePreviewCount"]}, sort_keys=True))


if __name__ == "__main__":
    main()
