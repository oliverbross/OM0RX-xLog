"""Bounded read-only views over the existing activated history and contest log."""
from copy import deepcopy
from datetime import UTC, datetime
import re
import sqlite3
import uuid

from .plugins import PLUGIN_REGISTRY


# The registry declares eligible roles; these map them to existing source columns.
ROLES = {"call": ("Partial call", "Call", "Call"),
         "name": ("Name", "Name", "Name"),
         "state": ("State / province / country", "State", "Sect"),
         "locator": ("Locator", "Loc1", "NR")}
SCOPE = {"sessionID", "workspaceGeneration", "expectedRevision", "draftID", "requestID"}


def _query(value, require):
    require(isinstance(value, str) and len(value) <= 64 and
            not any(ord(char) < 32 or ord(char) == 127 for char in value), "Invalid assistance query")
    return value.strip().upper()


def _pattern(query, contains=False):
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return ("%" if contains else "") + escaped + "%"


def _validate_scope(state, params, require):
    workspace = state.get("workspaceGeneration") or str(uuid.uuid5(uuid.UUID(state["sessionID"]), "xlog-not1mm-workspace"))
    require(params.get("sessionID") == state["sessionID"] and params.get("workspaceGeneration") == workspace,
            "Assistance workspace changed", "stale_context")
    require(type(params.get("expectedRevision")) is int and params["expectedRevision"] == state["revision"]
            and params.get("draftID") == state["draft"]["id"], "Assistance draft or log changed", "stale_context")
    try:
        require(str(uuid.UUID(params.get("requestID", ""))) == params["requestID"], "Invalid assistance request identity")
    except (ValueError, TypeError, AttributeError):
        require(False, "Invalid assistance request identity")
    return {key: params[key] for key in SCOPE}


def read_assistance(store, state, method, params, desk_factory, require):
    """Each page has a revision fence, SQL work budget, and one read snapshot."""
    require(method in {"assistance_reverse", "assistance_dupesheet"}, "Unsupported assistance method")
    extra = {"query", "offset", "limit"}
    if method == "assistance_reverse":
        extra |= {"fieldID", "matchMode", "source"}
    require(set(params) == SCOPE | extra, "Unexpected assistance fields")
    offset, limit = params.get("offset"), params.get("limit")
    require(type(offset) is int and 0 <= offset <= 10_000_000 and type(limit) is int and 1 <= limit <= 100,
            "Invalid assistance page")
    query = _query(params.get("query"), require)
    store.conn.execute("BEGIN")
    budget = [0]
    def interrupt():
        budget[0] += 1
        return int(budget[0] > 10_000)  # At most ten million SQLite VM instructions per page.
    store.conn.set_progress_handler(interrupt, 1000)
    try:
        current = store.state(state["sessionID"])
        context = _validate_scope(current, params, require)
        evaluated = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")
        base = {**context, "evaluatedAtUTC": evaluated, "query": query, "offset": offset, "limit": limit}
        result = (_reverse(store, current, params, query, require) if method == "assistance_reverse" else
                  _dupesheet(store, current, params, query, evaluated, desk_factory))
        # Pinned upstream query helpers swallow OperationalError; an interrupted
        # plugin check must never be presented as a clear duplicate result.
        require(budget[0] <= 10_000, "This lookup exceeded its work budget. Narrow the query and try again.", "assistance_query_budget")
        return {**base, **result}
    except sqlite3.OperationalError as error:
        if "interrupted" in str(error).lower():
            require(False, "This lookup exceeded its work budget. Narrow the query and try again.", "assistance_query_budget")
        raise
    finally:
        store.conn.set_progress_handler(None, 0)
        store.conn.rollback()


def _reverse(store, state, params, query, require):
    field, source, mode = params.get("fieldID"), params.get("source"), params.get("matchMode")
    require(source in {"history", "log"} and mode in {"prefix", "contains"}, "Invalid reverse search source or match mode")
    roles = ("call", *PLUGIN_REGISTRY[state["pluginID"]].reverse_history_fields)
    fields = [{"id": role, "label": ROLES[role][0]} for role in roles]
    active = store.callhistory_status() if source == "history" else None
    result = {"fieldID": field, "source": source, "matchMode": mode, "fields": fields,
              "dataset": active, "rows": [], "nextOffset": None, "unsupportedReason": None}
    if field not in roles:
        result["unsupportedReason"] = ("Rolling serials are not stable identities and cannot be searched as call history."
                                       if field == "serial" else "This plugin has not declared that exchange role stable for reverse lookup.")
        return result
    if len(query) < 2:
        result["unsupportedReason"] = "Enter at least two characters for a reverse lookup."
        return result
    if source == "history" and not active:
        result["unsupportedReason"] = "No call-history dataset is activated for this contest."
        return result
    column = ROLES[field][1 if source == "history" else 2]
    table = "CALLHISTORY" if source == "history" else "DXLOG"
    where = f"upper({column}) LIKE ? ESCAPE '\\'"
    values = [_pattern(query, mode == "contains")]
    if source == "log":
        where += " AND ContestNR=?"
        values.append(store.current_contest)
    rows = store.conn.execute(f"SELECT rowid AS source_row,* FROM {table} WHERE {where} ORDER BY upper(Call),rowid LIMIT ? OFFSET ?",
                              (*values, params["limit"] + 1, params["offset"])).fetchall()
    result["nextOffset"] = params["offset"] + params["limit"] if len(rows) > params["limit"] else None
    for row in rows[:params["limit"]]:
        call = str(row.get("Call") or "").upper()
        if not re.fullmatch(r"[A-Z0-9/]{2,32}", call):
            continue
        compared = [{"id": role, "label": ROLES[role][0],
                     "value": str(row.get(ROLES[role][1 if source == "history" else 2]) or "")} for role in roles]
        result["rows"].append({"candidateID": f"{source}:{row['source_row']}", "callsign": call,
                               "sourceLabel": "Activated call history" if source == "history" else "Current contest log",
                               "sourceDate": str(row.get("LastUpdateNote") or "") if source == "history" else str(row.get("TS") or ""),
                               "comparedFields": compared})
    return result


def _dupesheet(store, state, params, query, evaluated, desk_factory):
    values = (store.current_contest, _pattern(query, True))
    where = "ContestNR=? AND upper(Call) LIKE ? ESCAPE '\\'"
    total = store.conn.execute(f"SELECT count(DISTINCT Call) AS total FROM DXLOG WHERE {where}", values).fetchone()["total"]
    rows = store.conn.execute(f"SELECT Call,max(TS) AS lastWorkedUTC,count(*) AS contactCount FROM DXLOG WHERE {where} "
                              "GROUP BY Call ORDER BY upper(Call),Call LIMIT ? OFFSET ?",
                              (*values, params["limit"], params["offset"])).fetchall()
    desk = desk_factory(deepcopy(state))
    frequency = state["draft"]["frequencyHz"]
    band = desk.band(frequency)
    mode = state.get("operatingMode", state["settings"]["ModeCategory"])
    if mode == "SSB":
        mode = "LSB" if frequency < 10_000_000 else "USB"
    output = []
    for row in rows:
        call = str(row["Call"] or "")
        valid = re.fullmatch(r"[A-Z0-9/]{2,32}", call) is not None
        duplicate = bool(desk.is_dupe(call, band, evaluated, mode)) if valid and desk.contest.dupe_type != 4 else None
        output.append({"callsign": call, "lastWorkedUTC": row["lastWorkedUTC"], "contactCount": row["contactCount"], "isDupe": duplicate})
    plugin = PLUGIN_REGISTRY[state["pluginID"]]
    description = plugin.duplicate_description or {1: "Worked in this contest.", 3: "Worked on this band and mode.",
                    4: "Duplicate checking disabled.", 5: "This contest's specific duplicate rule."}.get(desk.contest.dupe_type, "Worked on this band.")
    return {"rows": output, "totalCalls": total,
            "nextOffset": params["offset"] + params["limit"] if params["offset"] + len(rows) < total else None,
            "scopeDescription": description, "frequencyHz": frequency, "mode": mode,
            "roverLocation": desk.RoverLocation}
