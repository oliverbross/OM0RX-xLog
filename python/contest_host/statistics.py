"""Not1MM-compatible statistics over the complete current-contest log."""
import math


CW_MODES = frozenset({"CW", "CW-U", "CW-L", "CW-R", "CWR"})
PHONE_MODES = frozenset({"LSB", "USB", "SSB", "FM", "AM"})
DIGITAL_MODES = frozenset({
    "FT8", "FT4", "RTTY", "PSK31", "FSK441", "MSK144", "JT65", "JT9",
    "Q65",
})
def _band(value):
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return 0.0
    return number if math.isfinite(number) and number > 0 else 0.0


def _integer(value):
    try:
        return int(value or 0)
    except (TypeError, ValueError, OverflowError):
        return 0


def calculate_statistics(rows, country_multiplier="IsMultiplier1", zone_multiplier="IsMultiplier2"):
    """Return Statistics-v3 rows; unknown modes remain visible in QSO/call totals."""
    grouped = {}
    total_calls = set()
    for row in rows:
        band = _band(row.get("Band"))
        values = grouped.setdefault(band, {
            "qsos": 0, "calls": set(), "cw": 0, "phone": 0, "digital": 0,
            "wpx": set(), "countries": 0, "zones": 0, "points": 0,
        })
        values["qsos"] += 1
        call = row.get("Call")
        if call is not None:
            values["calls"].add(call)
            total_calls.add(call)
        # Keep Not1MM's SQL CASE semantics: mode matching is exact and
        # case-sensitive; malformed or future modes remain visible only in QSO
        # and distinct-call totals.
        mode = row.get("Mode")
        if mode in CW_MODES:
            values["cw"] += 1
        elif mode in PHONE_MODES:
            values["phone"] += 1
        elif mode in DIGITAL_MODES:
            values["digital"] += 1
        # SQLite COUNT(DISTINCT WPXPrefix) includes the schema's default empty
        # string but excludes NULL. Do not normalize source values here.
        prefix = row.get("WPXPrefix")
        if prefix is not None:
            values["wpx"].add(prefix)
        values["countries"] += 1 if _integer(row.get(country_multiplier)) else 0
        values["zones"] += 1 if _integer(row.get(zone_multiplier)) else 0
        values["points"] += _integer(row.get("Points"))

    ordered = sorted(grouped, reverse=True)

    result = []
    for band in ordered:
        values = grouped[band]
        result.append({
            "band": f"{band:.1f}", "qsos": values["qsos"],
            "calls": len(values["calls"]), "cw": values["cw"],
            "phone": values["phone"], "digital": values["digital"],
            "wpx": len(values["wpx"]), "countries": values["countries"],
            "zones": values["zones"], "points": values["points"],
        })
    total = {
        "band": "TOTAL", "qsos": sum(row["qsos"] for row in result),
        "calls": len(total_calls), "cw": sum(row["cw"] for row in result),
        "phone": sum(row["phone"] for row in result),
        "digital": sum(row["digital"] for row in result),
        "wpx": sum(row["wpx"] for row in result),
        "countries": sum(row["countries"] for row in result),
        "zones": sum(row["zones"] for row in result),
        "points": sum(row["points"] for row in result),
    }
    return {"rows": result, "total": total}
