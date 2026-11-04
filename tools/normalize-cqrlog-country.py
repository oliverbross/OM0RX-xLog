#!/usr/bin/env python3
"""Reproducible, explicitly scoped OK1RR data derivative; no CQRLOG code reused.

Usage: python3 tools/normalize-cqrlog-country.py SOURCE_CHECKOUT OUTPUT_JSON
The source checkout must be the pinned revision below. All six country
components are hashed together. Unrepresentable source rows are enumerated,
never silently discarded or advertised as full CQRLOG parser parity.
"""
import datetime
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

REVISION = "4adb0e70bf29faefc3b203bc355796cd0c6201fe"
COMPONENTS = ("Country.tab", "CallResolution.tbl", "AreaOK1RR.tbl", "CountryDel.tab", "Exceptions.tab", "Ambiguous.tbl")


def iso_date(value, end=False):
    if not value:
        return None
    day = datetime.datetime.strptime(value, "%Y/%m/%d").date()
    return f"{day.isoformat()}T{'23:59:59' if end else '00:00:00'}Z"


def coordinate(value, axis):
    if not value:
        return None
    assert re.fullmatch(r"[0-9]+(?:\.[0-9]+)?[NS]" if axis == "lat" else r"[0-9]+(?:\.[0-9]+)?[EW]", value), value
    result = float(value[:-1]) * (-1 if value[-1] in "SW" else 1)
    assert abs(result) <= (90 if axis == "lat" else 180), value
    return result


def main():
    checkout, output = map(Path, sys.argv[1:])
    actual = subprocess.check_output(["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True).strip()
    assert actual == REVISION, f"source revision {actual} differs from {REVISION}"
    root = checkout / "data/dxcc"
    components = {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in COMPONENTS}
    records, excluded = [], []
    # This derivative represents patterns faithfully with a finite grammar,
    # keeps real date windows (open means open), and reports tied conflicts.
    grammar = re.compile(r"(?:[A-Z0-9/#?%]|\[[A-Z0-9\-]+\])+")
    for component in COMPONENTS[:4]:
        for line_number, line in enumerate((root / component).read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            fields = line.split("|")
            try:
                assert len(fields) == 11, f"expected 11 columns; found {len(fields)}"
                marks, name, continent, utc, lat, lon, itu, cq, adif, flag, window_text = fields
                assert continent in ("AF", "AN", "AS", "EU", "NA", "OC", "SA"), "unsupported continent"
                assert flag in ("", "R", "D"), f"unsupported status {flag}"
                windows = window_text.split() or [""]
                for window in windows:
                    temporal, separator, entity = window.partition("=")
                    entity = int(entity if separator else adif)
                    assert 0 <= entity <= 1000, "invalid ADIF"
                    assert temporal != "!", "explicit never-valid record"
                    start, end = None, None
                    if temporal not in ("", "*"):
                        assert temporal.count("-") == 1, f"unsupported window {temporal}"
                        before, after = temporal.split("-")
                        start, end = iso_date(before), iso_date(after, True)
                        assert not start or not end or start <= end, "inverted date window"
                    country = {"name": name.upper(), "adif": entity, "continent": continent,
                               "cqZone": int(cq or 0), "ituZone": int(itu or 0)}
                    assert 0 <= country["cqZone"] <= 40 and 0 <= country["ituZone"] <= 90, "invalid zones"
                    for axis, raw in (("latitude", lat), ("longitude", lon)):
                        value = coordinate(raw, "lat" if axis == "latitude" else "lon")
                        if value is not None:
                            country[axis] = value
                    for mark in marks.split():
                        exact = mark.startswith("=")
                        pattern = mark[1:] if exact else mark
                        if not grammar.fullmatch(pattern):
                            excluded.append({"component": component, "line": line_number, "pattern": mark,
                                             "reason": "unsupported source pattern (non-callsign designator or grammar)"})
                            continue
                        assert len(pattern) <= 128, "pattern too long"
                        records.append({"pattern": pattern, "exact": exact, "deleted": flag == "D",
                                        "country": country, "start": start, "end": end,
                                        "component": component, "line": line_number})
            except (AssertionError, ValueError) as error:
                excluded.append({"component": component, "line": line_number, "reason": str(error)})
    # Stable serialization; duplicates identical in meaning carry one source row.
    records.sort(key=lambda r: (r["pattern"], r["start"] or "", r["end"] or "", r["component"], r["line"]))
    pack = {"schemaVersion": 1, "provider": "Martin OK1RR / CQRLOG country data",
            "sourceURL": f"https://github.com/ok2cqr/cqrlog-cnty-files/tree/{REVISION}/data/dxcc",
            "sourceRevision": REVISION, "sourceVersion": None, "normalizerVersion": "xlog-ok1rr-1",
            "attribution": "Country data by Martin OK1RR, redistributed by CQRLOG; data has no separate upstream licence text. Independently normalized by OM0RX-xLog; CQRLOG parser code not incorporated.",
            "conflictPolicy": "reportAmbiguous", "components": components,
            "coverage": ["current-and-deleted", "date-valid-exact", "finite-wildcard-area-patterns",
                         "ignored-modifiers", "declared-ambiguous-prefixes", "us-digit-district", "argentine-letter-area"],
            "excluded": excluded, "records": records,
            "ignoredModifiers": sorted(set((root / "Exceptions.tab").read_text().split())),
            "ambiguousPrefixes": sorted(set((root / "Ambiguous.tbl").read_text().split()))}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(pack, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({"records": len(records), "excluded": len(excluded), "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                      "sourceRevision": REVISION, "components": components,
                      "exclusionReasons": dict(Counter(item["reason"] for item in excluded))}))


if __name__ == "__main__":
    main()
