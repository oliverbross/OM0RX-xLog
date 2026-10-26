"""Read-only family dimensions over plugin-owned rows, checked against its totals.

These describe the pinned show_mults queries; they never assign scoring flags or
re-score a contact. An unreconciled dimension stays unavailable.
"""
from dataclasses import dataclass
from .plugins import NO_MULTIPLIER_PLUGINS


@dataclass(frozen=True)
class Dimension:
    id: str
    label: str
    field: str
    scope: str
    total: str
    criterion: str = "all"


PREFIX = Dimension("prefix", "WPX prefixes", "WPXPrefix", "contest", "prefixes")
SECTION = Dimension("section", "ARRL/RAC sections", "Sect", "contest", "sections")
SPC = Dimension("spc", "State / province / country", "Sect", "band", "sections", "not-dx")
CALL = Dimension("call", "Unique calls", "Call", "contest", "uniqueCalls")
COUNTRY = Dimension("country", "Countries", "CountryPrefix", "band", "countries", "cq")
ZONE = Dimension("zone", "CQ zones", "ZN", "band", "zones", "cq")
STATE = Dimension("state", "States / VE areas", "Exchange1", "band", "states", "cq-state")

FAMILIES = {
    **{key: (PREFIX,) for key in ("cq_wpx_cw", "cq_wpx_ssb", "cq_wpx_rtty")},
    **{key: (SECTION,) for key in ("arrl_ss_cw", "arrl_ss_phone")},
    **{key: (SPC,) for key in ("naqp_cw", "naqp_ssb", "naqp_rtty", "phone_weekly_test", "k1usn_sst")},
    **{key: (CALL,) for key in ("cwt", "cwo", "icwc_mst", "weekly_rtty")},
    "cq_ww_rtty": (COUNTRY, ZONE, STATE),
    "iaru_hf": (Dimension("ituZone", "ITU zones", "ZN", "band/mode", "zones", "itu"),
                Dimension("hq", "IARU headquarters", "ZN", "band/mode", "headquarters", "hq")),
}


def dimensions(state):
    plugin = state["pluginID"]
    if plugin in {"arrl_dx_cw", "arrl_dx_ssb"}:
        country = state["reference"]["countries"].get(state["station"]["Call"], {}).get("primary_pfx")
        return ((Dimension("country", "DX countries", "CountryPrefix", "band", "countries", "three-points"),)
                if country in {"K", "VE"} else
                (Dimension("state", "US states / VE provinces", "NR", "band", "states", "three-points"),))
    return FAMILIES.get(plugin, ())


def project(rows, state, score, band_labels):
    """Return bounded worked ledgers and immutable per-contact support keys."""
    views, support = [], {row["ID"]: [] for row in rows}
    definitions = dimensions(state)
    if not definitions:
        return views, support, False
    cq_seen = set()
    cq_eligible = set()
    for row in sorted(rows, key=lambda row: row.get("source_order", 0)) if any(d.criterion.startswith("cq") for d in definitions) else ():
        key = (row["Call"], row["Band"])
        if row.get("CountryPrefix") and key not in cq_seen:
            cq_eligible.add(row["ID"])
        cq_seen.add(key)
    for dimension in definitions:
        groups = {}
        for row in rows:
            raw = row.get(dimension.field)
            value = str(raw if raw is not None else "").strip()
            if not value:
                continue
            condition = dimension.criterion
            if condition == "not-dx" and value == "DX" or condition == "three-points" and row["Points"] != 3:
                continue
            if condition in {"cq", "cq-state"} and row["ID"] not in cq_eligible:
                continue
            if condition == "cq-state" and value == "DX":
                continue
            if condition == "itu" and not isinstance(raw, int) or condition == "hq" and isinstance(raw, int):
                continue
            band = band_labels.get(row["Band"], str(row["Band"]))
            scope = "Contest" if dimension.scope == "contest" else band
            if dimension.scope == "band/mode":
                scope += " / " + str(row["Mode"])
            key = (value, scope)
            groups.setdefault(key, []).append(row["ID"])
        expected = score.get(dimension.total)
        reconciled = expected is not None and len(groups) == expected
        view = {"id": dimension.id, "label": dimension.label, "scope": dimension.scope,
                "status": "supported" if reconciled else "not-implemented", "total": expected or 0,
                "reason": "Worked identities; open-ended or entrant-dependent needed lists are not inferred."
                if reconciled else "Worked identities do not reconcile with the plugin total; view unavailable.",
                "rows": [{"value": value, "scope": scope, "qsos": len(ids)}
                         for (value, scope), ids in sorted(groups.items())] if reconciled and len(groups) <= 3000 else []}
        if reconciled and len(groups) > 3000:
            view.update(status="not-implemented", reason="Worked ledger exceeds the 3,000-identity view limit; plugin total retained.")
        views.append(view)
        if reconciled:
            for (value, scope), ids in groups.items():
                for qso_id in ids:
                    support[qso_id].append(f"{dimension.label} {value} · {scope}")
    available = bool(views) and all(view["status"] == "supported" for view in views)
    return views, support if available else {row["ID"]: [] for row in rows}, available


def view_status(state):
    ids = {dimension.id for dimension in dimensions(state)}
    if state["pluginID"] in {"cq_ww_cw", "cq_ww_ssb", "cq_ww_rtty"}:
        return {"countries": "supported", "zones": "supported"}
    if state["pluginID"] in NO_MULTIPLIER_PLUGINS:
        return {"countries": "not-applicable", "zones": "not-applicable"}
    known = bool(ids)
    return {"countries": "not-implemented" if "country" in ids or not known else "not-applicable",
            "zones": "not-implemented" if "ituZone" in ids or not known else "not-applicable"}
