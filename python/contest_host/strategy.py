"""Contest-local planning records; callers own the existing SQLite transaction.

Delivery is a durable claim, not a station action. The caller commits the claim
before displaying one grouped, nonmodal notification. Records/history are never
purged: bounded capacity rejects further additions instead of discarding work.
"""
from copy import deepcopy
from datetime import datetime, timezone
import re
from .plugins import RTTY_MODES

VERSION = 1
MAX_ITEMS = 500
MAX_HISTORY = 256
MOVE_STATES = {"Watch", "Planned", "Requested", "Waiting", "Abandoned"}


def utc(value=None):
    if value is None:
        value = datetime.now(timezone.utc).isoformat()
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)", value):
        raise ValueError("Use a complete UTC date and time ending in Z")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _data(state, require):
    value = state.get("strategy", {"version": VERSION, "skeds": [], "moves": []})
    require(isinstance(value, dict) and type(value.get("version")) is int and value.get("version") == VERSION
            and isinstance(value.get("skeds"), list) and isinstance(value.get("moves"), list),
            "Saved strategy data is unreadable; preserve it before recovery", "strategy_recovery_required")
    require(len(value["skeds"]) + len(value["moves"]) <= MAX_ITEMS,
            "Saved strategy data exceeds capacity", "strategy_recovery_required")
    identities = set()
    for item in value["skeds"] + value["moves"]:
        require(isinstance(item, dict) and isinstance(item.get("id"), str)
                and isinstance(item.get("history"), list) and len(item["history"]) <= MAX_HISTORY,
                "Saved strategy item is unreadable; preserve it before recovery", "strategy_recovery_required")
        require(bool(item["id"]) and len(item["id"]) <= 128 and item["id"] not in identities,
                "Saved strategy identity is unreadable", "strategy_recovery_required")
        identities.add(item["id"])
        move = item in value["moves"]
        _fields(item, require, move=move)
        require(isinstance(item.get("createdUTC"), str) and isinstance(item.get("updatedUTC"), str),
                "Saved strategy timestamps are unreadable", "strategy_recovery_required")
        _time(item["createdUTC"], require)
        _time(item["updatedUTC"], require)
        valid_statuses = MOVE_STATES | {"Worked"} if move else {"active", "dismissed", "completed", "cancelled"}
        require(isinstance(item.get("status"), str) and item["status"] in valid_statuses,
                "Saved strategy status is unreadable", "strategy_recovery_required")
        if not move:
            require(type(item.get("schedule")) is int and item["schedule"] > 0
                    and (item.get("deliveredSchedule") is None or type(item["deliveredSchedule"]) is int
                         and 0 < item["deliveredSchedule"] <= item["schedule"]),
                    "Saved reminder schedule is unreadable", "strategy_recovery_required")
        for event in item["history"]:
            require(isinstance(event, dict) and isinstance(event.get("action"), str)
                    and isinstance(event.get("atUTC"), str), "Saved strategy history is unreadable", "strategy_recovery_required")
            _time(event["atUTC"], require)
    return deepcopy(value)


def _text(value, maximum, require):
    require(isinstance(value, str) and len(value.encode("utf-8")) <= maximum
            and not any(ord(char) < 32 and char not in "\n\t" for char in value), "Invalid strategy text")
    return value.strip()


def _time(value, require):
    try:
        return utc(value)
    except (TypeError, ValueError):
        require(False, "Use a complete UTC date and time ending in Z")


def _history(item, action, at, require, **detail):
    require(len(item["history"]) < MAX_HISTORY,
            "This item's history is full; retain it and create a new item", "strategy_capacity")
    item["updatedUTC"] = at
    item["history"].append({"action": action, "atUTC": at, **detail})


def _fields(values, require, *, move=False):
    call = _text(values.get("callsign", ""), 32, require).upper()
    require(not call or re.fullmatch(r"[A-Z0-9/]{3,32}", call) is not None, "Invalid reminder callsign")
    body = _text(values.get("text", ""), 512, require)
    require(bool(call or body), "A callsign or reminder text is required")
    frequency = values.get("frequencyHz")
    require(frequency is None or type(frequency) is int and 100_000 <= frequency <= 100_000_000_000,
            "Frequency must be integer Hz")
    mode = _text(values.get("mode", ""), 16, require).upper()
    require(not mode or mode in {"CW", "SSB", "USB", "LSB", "AM", "FM", *RTTY_MODES}, "Invalid reminder mode")
    radio = values.get("radioID")
    require(radio is None or isinstance(radio, str) and radio in {"radio1", "radio2"}, "Choose Radio 1 or Radio 2 explicitly")
    result = {"callsign": call, "text": body, "frequencyHz": frequency, "mode": mode,
              "radioID": radio, "note": _text(values.get("note", ""), 4096, require),
              "source": _text(values.get("source", ""), 512, require)}
    if move:
        result["band"] = _text(values.get("band", ""), 16, require)
        require(bool(call and mode and result["band"]), "A planned move needs call, band and mode")
        result["skedID"] = values.get("skedID")
        require(result["skedID"] is None or isinstance(result["skedID"], str), "Invalid linked sked")
    else:
        require(isinstance(values.get("dueUTC"), str), "A complete UTC due time is required")
        result["dueUTC"] = _time(values.get("dueUTC"), require)
    return result


def mutate(state, params, require, *, now_utc=None):
    """Apply a strategy action atomically; the host supplies scope/revision fences."""
    data = _data(state, require)
    at = _time(now_utc if now_utc is not None else params.get("nowUTC"), require)
    action = params.get("action")
    require(isinstance(action, str), "Strategy action is required")
    notifications = []
    if action == "claim_due":
        # Claim all due items once, return one batch. No output/focus/tuning path.
        for item in sorted(data["skeds"], key=lambda row: (row["dueUTC"], row["id"])):
            if item["status"] == "active" and item["dueUTC"] <= at and item.get("deliveredSchedule") != item["schedule"]:
                item["deliveredSchedule"] = item["schedule"]
                item["deliveredUTC"] = at
                notifications.append(deepcopy(item))
    else:
        move = action.startswith("move_")
        collection = data["moves" if move else "skeds"]
        identity = _text(params.get("itemID", ""), 128, require)
        require(bool(identity), "A stable strategy item ID is required")
        item = next((row for row in collection if row["id"] == identity), None)
        if action in {"sked_add", "move_add"}:
            require(item is None and not any(row["id"] == identity for row in data["skeds"] + data["moves"]),
                    "Strategy item already exists", "strategy_conflict")
            require(len(data["skeds"]) + len(data["moves"]) < MAX_ITEMS,
                    "Strategy item capacity reached; existing history is retained", "strategy_capacity")
            fields = _fields(params, require, move=move)
            item = {"id": identity, **fields, "createdUTC": at, "updatedUTC": at, "history": []}
            if move:
                status = params.get("status", "Watch")
                require(isinstance(status, str) and status in MOVE_STATES, "Worked requires a committed QSO")
                item.update(status=status, workedQSOID=None)
            else:
                item.update(status="active", schedule=1, deliveredSchedule=None, deliveredUTC=None)
            collection.append(item)
            _history(item, action, at, require, status=item["status"])
        else:
            require(item is not None, "Strategy item does not exist", "not_found")
            if action in {"sked_edit", "move_edit"}:
                require(item["status"] not in {"completed", "cancelled", "Worked", "Abandoned"}, "This item is closed")
                fields = _fields({**item, **params}, require, move=move)
                if not move and fields["dueUTC"] != item["dueUTC"]:
                    item["schedule"] += 1
                    item["deliveredUTC"] = None
                item.update(fields)
                _history(item, action, at, require)
            elif action == "sked_snooze":
                require(item["status"] in {"active", "dismissed"}, "This reminder is closed")
                require(isinstance(params.get("dueUTC"), str), "A complete UTC due time is required")
                due = _time(params.get("dueUTC"), require)
                require(due > at, "Snooze time must be later than now")
                item.update(status="active", dueUTC=due, schedule=item["schedule"] + 1, deliveredUTC=None)
                _history(item, action, at, require, dueUTC=due)
            elif action in {"sked_dismiss", "sked_complete", "sked_cancel"}:
                require(item["status"] in {"active", "dismissed"}, "This reminder is already closed")
                item["status"] = {"sked_dismiss": "dismissed", "sked_complete": "completed", "sked_cancel": "cancelled"}[action]
                _history(item, action, at, require, status=item["status"])
            elif action == "move_state":
                status = params.get("status")
                require(isinstance(status, str) and status in MOVE_STATES, "Worked requires a committed QSO")
                require(item["status"] != "Worked", "A committed move cannot be manually relabelled")
                item["status"] = status
                _history(item, action, at, require, status=status)
            else:
                require(False, "Unknown strategy action")
        if move and item.get("skedID") is not None:
            require(any(row["id"] == item["skedID"] for row in data["skeds"]), "Linked sked does not exist")
    state["strategy"] = data
    return {**projection(state, now_utc=at), "notifications": notifications}


def projection(state, *, now_utc=None):
    def require(condition, message, code="invalid_request"):
        if not condition:
            raise ValueError(message)
    data = _data(state, require)
    at = utc(now_utc)
    return {**data, "dueCount": sum(row["status"] == "active" and row["dueUTC"] <= at for row in data["skeds"])}


def reconcile_worked(state, rows, band_labels=None, *, now_utc=None):
    """Only the host passes committed DXLOG rows; renderer proposals cannot call this.

    Retain established evidence if a QSO is later corrected/deleted, but show the
    move as Waiting until matching committed evidence exists again.
    """
    data = state.get("strategy")
    if not data:
        return
    at = utc(now_utc)
    def mode(value):
        return "SSB" if value in {"USB", "LSB", "PH", "SSB"} else "RTTY" if value in RTTY_MODES else value
    committed = {}
    for row in rows:
        band = (band_labels or {}).get(row.get("Band"), str(row.get("Band", "")))
        committed.setdefault((str(row.get("Call", "")).upper(), band, mode(row.get("Mode"))), row.get("ID"))
    for item in data["moves"]:
        if item["status"] == "Abandoned":
            continue
        qso = committed.get((item["callsign"], item["band"], mode(item["mode"])))
        if qso and (item["status"] != "Worked" or item.get("workedQSOID") != qso):
            # Reconciliation must never break an actual contact commit at capacity.
            item.update(status="Worked", workedQSOID=qso, updatedUTC=at)
        elif not qso and item["status"] == "Worked":
            item.update(status="Waiting", workedQSOID=None, updatedUTC=at)
