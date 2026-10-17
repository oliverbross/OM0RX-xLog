#!/usr/bin/env python3
"""Reproduce the frozen current-DXCC ADIF code fixture from the pinned ARRL PDF."""

import argparse
import hashlib
import json
import re
from pathlib import Path

from pypdf import PdfReader

EXPECTED_PDF_SHA256 = "409d7f5842375468f559753c41c5569115fa57401d587aa4573829d275f92c2c"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path, nargs="?", default=Path("/tmp/arrl-dxcc-current-2026.pdf"))
    parser.add_argument("--text-output", type=Path, default=Path("/tmp/arrl-dxcc-current-2026.txt"))
    args = parser.parse_args()

    data = args.pdf.read_bytes()
    if hashlib.sha256(data).hexdigest() != EXPECTED_PDF_SHA256:
        raise SystemExit("PDF digest does not match the pinned January 2026 authority")

    text = "\n".join((page.extract_text() or "") for page in PdfReader(str(args.pdf)).pages)
    args.text_output.write_text(text, encoding="utf-8")
    codes = [int(match.group(1)) for line in text.splitlines()
             if (match := re.search(r"(?:^|\s)(\d{3})\s*$", line))]
    unique = sorted(set(codes))
    if len(codes) != 340 or len(unique) != 340:
        raise SystemExit(f"expected 340 unique table rows, found {len(codes)} rows and {len(unique)} codes")
    print(json.dumps(unique, separators=(",", ":")))


if __name__ == "__main__":
    main()
