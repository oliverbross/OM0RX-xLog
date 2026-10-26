"""Read-only whole-log queries and identity-bound operator notes.

The existing Host owns transactions, revisions, scoring and operation receipts.
"""
from datetime import UTC, datetime
import json
import re


SORTS = {
    "utc": "d.TS", "call": "d.Call COLLATE NOCASE", "frequency": "CAST(d.Freq AS REAL)",
    "sentSerial": "CAST(d.SentNr AS INTEGER)", "receivedSerial": "CAST(d.NR AS INTEGER)",
    "points": "CAST(d.Points AS REAL)", "mode": "d.Mode COLLATE NOCASE",
}


def log_query(store, state, params, require, duplicate_projection):
    """One bounded page from the entire contest, with a stable identity tie-breaker."""
    offset, limit = params.get("offset", 0), params.get("limit", 50)
    require(type(offset) is int and offset >= 0 and type(limit) is int and 1 <= limit <= 100, "Invalid page")
    expected = params.get("expectedRevision")
    require(expected is None or type(expected) is int and expected == state["revision"],
            "Contest changed before the next log page", "stale_revision")
    column, direction = params.get("sort", "utc"), params.get("direction", "descending")
    require(column in SORTS and direction in {"ascending", "descending"}, "Unsupported log ordering")
    query = params.get("query", "")
    require(isinstance(query, str) and len(query.encode("utf-8")) <= 128, "Invalid log query")
    predicate, values = "d.ContestNR=?", [store.current_contest]
    if query:
        # Escape LIKE metacharacters: this is a literal callsign contains query.
        predicate += " AND d.Call LIKE ? ESCAPE '\\'"
        values.append("%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
    order = SORTS[column] + (" ASC" if direction == "ascending" else " DESC") + ",d.ID ASC"
    if "sort" not in params and "direction" not in params:
        # Preserve the accepted legacy latest-contact/same-second ordering;
        # explicit whole-log ordering uses the identity tie-breaker above.
        order = "d.TS DESC,d.rowid DESC"
    total = store.exec_sql(f"SELECT count(*) AS n FROM DXLOG d WHERE {predicate}", values)["n"]
    # A focused QSO keeps an inspected selection reachable as new rows arrive.
    focus = params.get("focusQsoID")
    if focus is not None:
        require(isinstance(focus, str) and len(focus) <= 128, "Invalid focused QSO")
        ranked = store.exec_sql(
            f"SELECT position FROM (SELECT d.ID,row_number() OVER (ORDER BY {order})-1 AS position "
            f"FROM DXLOG d WHERE {predicate}) WHERE ID=?", (*values, focus))
        require(bool(ranked), "Selected contact no longer matches this query", "not_found")
        offset = ranked["position"] // limit * limit
    rows = store.exec_sql_mult(
        "SELECT d.*,i.raw_fields,i.country AS country_identity,coalesce((SELECT max(a.revision) "
        "FROM xlog_qso_audit a WHERE a.qso_id=d.ID),0) AS change_revision" + duplicate_projection + " "
        "FROM DXLOG d LEFT JOIN xlog_qso_identity i ON i.id=d.ID "
        f"WHERE {predicate} ORDER BY {order} LIMIT ? OFFSET ?", (*values, limit, offset))
    for row in rows:
        row["raw_fields"] = json.loads(row["raw_fields"]) if row["raw_fields"] else {}
        row["country_identity"] = json.loads(row["country_identity"]) if row["country_identity"] else None
    return {"sessionID": state["sessionID"], "revision": state["revision"], "offset": offset,
            "limit": limit, "total": total, "rows": rows, "sort": column, "direction": direction, "query": query}


def save_note(store, state, params, require):
    note_id, target = params.get("noteID"), params.get("target")
    require(isinstance(note_id, str) and re.fullmatch(r"[0-9a-f-]{36}", note_id) is not None, "Invalid note identity")
    require(isinstance(target, dict) and set(target) in ({"draftID"}, {"qsoID"}), "Choose one stable note target")
    body = params.get("text")
    require(isinstance(body, str) and 0 < len(body.strip()) and len(body.encode("utf-8")) <= 4096,
            "A note must contain 1–4096 UTF-8 bytes")
    draft_id, qso_id = target.get("draftID"), target.get("qsoID")
    if draft_id:
        bound = store.exec_sql("SELECT qso_id FROM xlog_draft_contact WHERE draft_id=?", (draft_id,))
        if bound:
            qso_id = bound["qso_id"]
        else:
            require(draft_id == state["draft"]["id"], "This draft is no longer available; choose the QSO explicitly", "stale_draft")
    else:
        require(bool(store.exec_sql("SELECT ID FROM DXLOG WHERE ID=? AND ContestNR=?", (qso_id, store.current_contest))),
                "Note contact is not in this contest", "not_found")
    require(not store.exec_sql("SELECT id FROM xlog_note WHERE id=?", (note_id,)), "Note identity already exists", "note_conflict")
    store.conn.execute("INSERT INTO xlog_note VALUES(?,?,?,?,?,?)",
                       (note_id, draft_id, qso_id, body, datetime.now(UTC).isoformat(), state["revision"] + 1))


def read_notes(store, state, params, require):
    limit, offset = params.get("limit", 50), params.get("offset", 0)
    require(type(limit) is int and 1 <= limit <= 100 and type(offset) is int and offset >= 0, "Invalid notes page")
    return {"sessionID": state["sessionID"], "workspaceGeneration": state["workspaceGeneration"],
            "revision": state["revision"], "total": store.exec_sql("SELECT count(*) AS n FROM xlog_note")["n"],
            "rows": store.exec_sql_mult("SELECT n.*,d.Call AS callsign,d.TS AS workedAt FROM xlog_note n "
                                       "LEFT JOIN DXLOG d ON d.ID=n.qso_id ORDER BY n.revision DESC,n.id ASC LIMIT ? OFFSET ?", (limit, offset))}
