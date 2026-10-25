"""Small read-only recorder audit projection; never handles audio or scoring."""
from datetime import datetime, UTC
import json


def changes(store, state, params, require):
    require(set(params) == {"sessionID", "afterSequence", "limit"}, "Invalid recorder audit request")
    after, limit = params["afterSequence"], params["limit"]
    require(type(after) is int and 0 <= after <= 2**53 - 1, "Invalid recorder cursor")
    require(type(limit) is int and 1 <= limit <= 200, "Invalid recorder page size")
    # A single bounded statement holds no read transaction during playback/export.
    rows = store.exec_sql_mult(
        "SELECT a.sequence,a.revision,a.operation_id,a.qso_id,a.kind,a.before_json,a.after_json,"
        "o.payload FROM xlog_qso_audit a LEFT JOIN xlog_operation o ON o.operation_id=a.operation_id "
        "WHERE a.sequence>? ORDER BY a.sequence LIMIT ?", (after, limit + 1))
    events = []
    replica = bool(store.replica())
    for row in rows[:limit]:
        before = json.loads(row["before_json"]) if row["before_json"] else None
        current = json.loads(row["after_json"]) if row["after_json"] else None
        image = current or before or {}
        try:
            utc_ms = int(datetime.strptime(image.get("TS", ""), "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC).timestamp() * 1000)
        except (ValueError, OverflowError):
            utc_ms = None
        payload = json.loads(row["payload"]) if row["payload"] else {}
        # Replicated/imported/remote contacts must not inherit this Mac's audio.
        local = not replica and payload.get("method") in {"qso_commit", "digital_ingest", "qso_correct", "qso_delete"}
        labels = lambda value: None if value is None else {key: value.get(key) for key in
                    ("Call", "TS", "Freq", "Band", "Mode", "Operator", "StationName")}
        events.append({"sequence": row["sequence"], "revision": row["revision"],
                       "operationID": row["operation_id"], "qsoID": row["qso_id"],
                       "kind": row["kind"], "before": labels(before), "after": labels(current),
                       "utcMs": utc_ms, "local": local})
    return {"engine": "not1mm-python", "sessionID": state["sessionID"],
            "events": events, "hasMore": len(rows) > limit,
            "afterSequence": events[-1]["sequence"] if events else after}
