"""Bounded, ephemeral analytical copies. The live store remains the only writer."""
from datetime import datetime, UTC
import hashlib
import json
import math
import time
import uuid

MAX_CONTACTS = 50000
PAGE_SIZE = 500


def identity(store, state):
    # Draft revisions deliberately do not invalidate an analytical copy.
    audit = store.exec_sql("SELECT coalesce(max(sequence),0) AS seq FROM xlog_qso_audit")["seq"]
    count = store.exec_sql("SELECT count(*) AS n FROM DXLOG WHERE ContestNR=?", (store.current_contest,))["n"]
    source = {"audit": audit, "count": count, "plugin": state["pluginID"],
              "settings": state["settings"], "station": state["station"], "reference": state["reference"]["id"]}
    return hashlib.sha256(json.dumps(source, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def finite(value):
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError, OverflowError):
        return None


def contact(row, band_labels, score_band, cq_ww):
    country = json.loads(row["country_identity"]) if row.get("country_identity") else {}
    country = country or {}
    band = finite(row.get("Band"))
    style = str(row.get("IsRunQSO", "")).strip()
    zone = finite(row.get("ZN"))
    return {"id": row["ID"], "call": row["Call"], "utc": row["TS"],
            "band": band_labels.get(band, "Unknown"), "frequencyKHz": finite(row.get("Freq")),
            "mode": str(row.get("Mode") or "Unknown"), "operator": str(row.get("Operator") or "Unknown"),
            "style": "Run" if style == "1" else "S&P" if style == "0" else "Unknown",
            "country": str(row.get("CountryPrefix") or "Unknown"),
            "countryName": str(country.get("entity") or row.get("CountryPrefix") or "Unknown"),
            "continent": str(country.get("continent") or row.get("Continent") or "Unknown"),
            "zone": str(int(zone)) if cq_ww and zone is not None and zone.is_integer() and 1 <= zone <= 40 else "Unknown",
            "prefix": str(row.get("WPXPrefix") or "Unknown"),
            "points": finite(row.get("Points")),
            "multiplierEligible": row.get("multiplier_eligible") if cq_ww else None,
            "inCategory": score_band is None or band == score_band}


class AnalyticsCopies:
    def __init__(self):
        self.copies = {}

    def read(self, store, state, params, desk_factory, band_labels, require):
        allowed = {"sessionID", "workspaceGeneration", "action", "snapshotID", "offset", "limit"}
        require(set(params) <= allowed, "Unexpected analytics parameters")
        action = params.get("action")
        require(action in {"prepare", "page", "check", "release"}, "Unknown analytics read")
        self.copies = {key: value for key, value in self.copies.items() if value["expires"] > time.monotonic()}
        if action == "prepare":
            require(set(params) == {"sessionID", "workspaceGeneration", "action"}, "Invalid analytics snapshot request")
            store.conn.execute("BEGIN")
            try:
                state = store.state(params["sessionID"])
                token = identity(store, state)
                desk = desk_factory(state)
                score = desk.score()
                score_band = desk.database.score_band
                rows = store.exec_sql_mult(
                    "SELECT d.rowid AS source_order,d.ID,d.Call,d.TS,d.Band,d.Freq,d.Mode,d.Operator,d.IsRunQSO,"
                    "d.CountryPrefix,d.Continent,d.ZN,d.WPXPrefix,d.Points,i.country AS country_identity "
                    "FROM DXLOG AS d LEFT JOIN xlog_qso_identity AS i ON i.id=d.ID "
                    "WHERE d.ContestNR=? ORDER BY d.TS,d.rowid LIMIT ?", (store.current_contest, MAX_CONTACTS + 1))
                require(len(rows) <= MAX_CONTACTS, "Analytics supports up to 50,000 contacts in one contest.")
                metadata = {"sessionID": params["sessionID"], "workspaceGeneration": params["workspaceGeneration"],
                            "revision": state["revision"], "identity": token, "pluginID": state["pluginID"],
                            "name": state.get("name") or desk.contest.name,
                            "stationCall": state["station"]["Call"], "settings": state["settings"],
                            "referenceID": state["reference"]["id"], "sourceRevision": state.get("sourceRevision", ""),
                            "score": score, "dupeType": desk.contest.dupe_type,
                            "cqWW": state["pluginID"] in {"cq_ww_ssb", "cq_ww_cw"},
                            "capturedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z")}
            finally:
                store.conn.rollback()
            # No live SQLite read lock is held while serializing the copied rows.
            # Match Store.cq_ww_multiplier_filter's original row-order eligibility,
            # including zero-point domestic QSOs. Do not infer credit from flags.
            seen = set()
            for row in sorted(rows, key=lambda row: row["source_order"]):
                duplicate_key = (row["Call"], row["Band"])
                row["multiplier_eligible"] = bool(row["CountryPrefix"]) and duplicate_key not in seen
                seen.add(duplicate_key)
            normalized = [contact(row, band_labels, score_band, metadata["cqWW"]) for row in rows]
            key = str(uuid.uuid4())
            while len(self.copies) >= 2:
                del self.copies[next(iter(self.copies))]
            self.copies[key] = {"meta": metadata, "rows": normalized, "expires": time.monotonic() + 900}
            return {**metadata, "snapshotID": key, "total": len(rows)}
        key = params.get("snapshotID")
        value = self.copies.get(key) if isinstance(key, str) else None
        required = {"sessionID", "workspaceGeneration", "action", "snapshotID"}
        require(set(params) == required | ({"offset", "limit"} if action == "page" else set()),
                "Invalid analytics read parameters")
        require(value is not None, "Analytics snapshot expired. Refresh analytics.", "stale_snapshot")
        require(value["meta"]["sessionID"] == params["sessionID"]
                and value["meta"]["workspaceGeneration"] == params["workspaceGeneration"], "Analytics session changed", "stale_context")
        if action == "release":
            del self.copies[key]
            return {"released": True}
        if action == "check":
            value["expires"] = time.monotonic() + 900
            return {"current": identity(store, state) == value["meta"]["identity"], "identity": value["meta"]["identity"]}
        offset, limit = params.get("offset"), params.get("limit")
        require(type(offset) is int and 0 <= offset <= len(value["rows"])
                and type(limit) is int and 1 <= limit <= PAGE_SIZE, "Invalid analytics page")
        value["expires"] = time.monotonic() + 900
        return {"snapshotID": key, "identity": value["meta"]["identity"], "offset": offset,
                "total": len(value["rows"]), "rows": value["rows"][offset:offset + limit]}
