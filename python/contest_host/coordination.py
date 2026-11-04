"""Directed operating evidence inside the existing group authority transaction.

Messages never edit drafts, allocate serials, publish spots or grant output.
The native authority owner supplies senderStation from its admitted peer envelope.
"""
import json
import re
from datetime import datetime, timezone


def _utc(value):
    if not isinstance(value, str) or len(value) > 40:
        return None
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return stamp.astimezone(timezone.utc) if stamp.tzinfo else None
    except ValueError:
        return None


def _complete_pass(message, require, state, now):
    require(message.get("schema") == 2 and message.get("version") == 1, "Unsupported directed-pass version")
    require(message.get("sessionID") == state["sessionID"], "Pass belongs to another contest session", "stale_context")
    require(message.get("workspaceGeneration") == state.get("workspaceGeneration", state.get("generation")), "Pass belongs to another workspace", "stale_context")
    require(message.get("frequencyMeaning") == "rx", "Pass frequency must explicitly mean receive; split/TX remains unknown")
    frequency = message["frequencyHz"]
    require(type(frequency) is int and any(lower <= frequency <= upper for lower, upper in (
        (1800000, 2000000), (3500000, 4000000), (7000000, 7300000), (14000000, 14350000),
        (21000000, 21450000), (28000000, 29700000))), "Pass requires a usable contest-band receive frequency")
    require(message["mode"] in {"CW", "SSB", "RTTY"}, "Pass requires an explicit supported contest mode")
    observed = _utc(message.get("observedUTC"))
    require(observed is not None and observed <= _utc(now), "Pass requires an observed UTC no later than its creation")
    require(message.get("source") in {"operator", "active-lane", "spot"}, "Pass source is required")
    require(message.get("supersedesID") is None or isinstance(message["supersedesID"], str) and re.fullmatch(r"[0-9a-f-]{36}", message["supersedesID"]), "Invalid superseded pass identity")


def coordinate(store, state, params, require, identity):
    common = {"sessionID", "workspaceGeneration", "requestID", "senderStation", "action"}
    sender, action = params.get("senderStation"), params.get("action")
    require(isinstance(sender, str) and re.fullmatch(r"[A-Za-z0-9_./-]{1,32}", sender), "Exact native station identity required")
    now = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
    if action == "presence":
        require(set(params) == common | {"presence"}, "Unexpected presence fields")
        item = params["presence"]
        require(isinstance(item, dict) and set(item) == {"bootID", "sequence", "operator", "role", "band", "mode", "laneID", "cursor", "queue", "context"}, "Exact station presence required")
        require(isinstance(item["bootID"], str) and re.fullmatch(r"[0-9a-f-]{36}", item["bootID"]), "Invalid peer generation")
        require(all(type(item[key]) is int and 0 <= item[key] <= 2**53-1 for key in ("sequence", "cursor", "queue")), "Invalid peer counters")
        require(all(isinstance(item[key], str) and len(item[key].encode()) <= 128 and not any(ord(c)<32 for c in item[key]) for key in ("operator", "role", "band", "mode", "laneID", "context")), "Invalid peer description")
        require(item["laneID"] in {"laneA", "laneB", "unknown"}, "Invalid peer lane")
        old = store.exec_sql("SELECT payload FROM xlog_group_peer WHERE station=?", (sender,))
        if old:
            previous = json.loads(old["payload"])
            if previous["bootID"] == item["bootID"]:
                require(item["sequence"] > previous["sequence"], "Out-of-order peer presence", "stale_peer")
            else:
                retired = store.exec_sql("SELECT 1 AS found FROM xlog_group_retired WHERE station=? AND boot=?", (sender, item["bootID"]))
                require(not retired, "Retired peer generation", "stale_peer")
                store.conn.execute("INSERT OR IGNORE INTO xlog_group_retired VALUES(?,?)", (sender, previous["bootID"]))
        store.conn.execute("INSERT INTO xlog_group_peer VALUES(?,?,?) ON CONFLICT(station) DO UPDATE SET payload=excluded.payload,confirmed_utc=excluded.confirmed_utc", (sender, json.dumps(item), now))
        require(store.exec_sql("SELECT COUNT(*) AS n FROM xlog_group_peer")["n"] <= 64, "Group station limit reached")
    elif action == "send":
        require(set(params) == common | {"message"}, "Unexpected directed-message fields")
        message = params["message"]
        basic = {"target", "kind", "body", "call", "frequencyHz", "mode", "laneID"}
        supplemental = {"schema", "version", "sessionID", "workspaceGeneration", "frequencyMeaning", "observedUTC", "source", "supersedesID"}
        require(isinstance(message, dict) and set(message) in (basic, basic | supplemental), "Exact directed-message fields required")
        require(message["kind"] in {"talk", "pass", "helper"} and message["laneID"] in {"laneA", "laneB"}, "Choose a directed kind and target lane")
        require(isinstance(message["target"], str) and message["target"] != sender and store.exec_sql("SELECT 1 AS found FROM xlog_group_peer WHERE station=?", (message["target"],)), "Choose a known other station")
        require(all(isinstance(message[key], str) and len(message[key].encode()) <= maximum and not any(ord(c)<32 for c in message[key]) for key, maximum in (("body",512),("call",32),("mode",16))), "Invalid directed-message text")
        require(message["kind"] == "talk" or re.fullmatch(r"[A-Z0-9/]{3,32}", message["call"]), "Pass/helper requires a complete callsign")
        require(type(message["frequencyHz"]) is int and 0 <= message["frequencyHz"] <= 100_000_000_000, "Invalid proposed frequency")
        if set(message) == basic | supplemental:
            _complete_pass(message, require, {**state, "workspaceGeneration": params["workspaceGeneration"]}, now)
            if message["supersedesID"] is not None:
                previous = store.exec_sql("SELECT sender,target FROM xlog_group_directed WHERE id=?", (message["supersedesID"],))
                require(previous and previous["sender"] == sender and previous["target"] == message["target"], "Only the original sender can supersede its pass to the same recipient")
        store.conn.execute("INSERT INTO xlog_group_directed VALUES(?,?,?,?,?,NULL)", (params["requestID"], sender, message["target"], json.dumps(message), now))
    elif action == "acknowledge":
        require(set(params) == common | {"messageID"}, "Unexpected acknowledgement fields")
        row = store.exec_sql("SELECT target FROM xlog_group_directed WHERE id=?", (params["messageID"],))
        require(row and row["target"] == sender, "Only the addressed station can acknowledge this proposal", "wrong_recipient")
        store.conn.execute("UPDATE xlog_group_directed SET acknowledged_utc=COALESCE(acknowledged_utc,?) WHERE id=?", (now, params["messageID"]))
    elif action in {"decline", "recipient_action"}:
        extras = {"messageID", "messageVersion"} | ({"event", "operationID", "context", "detail"} if action == "recipient_action" else set())
        require(set(params) == common | extras, "Unexpected recipient-action fields")
        row = store.exec_sql("SELECT target,payload FROM xlog_group_directed WHERE id=?", (params["messageID"],))
        require(row and row["target"] == sender, "Only the addressed station can act on this proposal", "wrong_recipient")
        message = json.loads(row["payload"])
        require(params["messageVersion"] == message.get("version", 0), "Directed proposal version changed", "stale_context")
        require(not store.exec_sql("SELECT 1 AS found FROM xlog_group_directed WHERE json_extract(payload,'$.supersedesID')=?", (params["messageID"],)), "This proposal was superseded", "stale_context")
        history = message.setdefault("recipientActions", [])
        require(isinstance(history, list) and len(history) < 100, "Directed-action history is full or unsupported")
        if action == "decline":
            history.append({"event": "declined", "operationID": params["requestID"], "atUTC": now})
        else:
            require(message.get("schema") == 2 and message.get("kind") in {"pass", "helper"}, "Legacy/incomplete proposal cannot be loaded or tuned")
            require(params["event"] in {"load_requested", "loaded", "tune_requested", "tune_accepted", "failed", "uncertain"}, "Invalid recipient-action outcome")
            require(isinstance(params["operationID"], str) and re.fullmatch(r"[0-9a-f-]{36}", params["operationID"]), "Invalid recipient operation identity")
            require(isinstance(params["context"], dict) and len(json.dumps(params["context"]).encode()) <= 4096, "Invalid recipient action context")
            require(isinstance(params["detail"], str) and len(params["detail"].encode()) <= 512, "Invalid recipient action detail")
            previous = [item for item in history if item["operationID"] == params["operationID"]]
            if params["event"] in {"load_requested", "tune_requested"}:
                require(not previous, "This recipient operation was already attempted; do not repeat its effect", "operation_attempted")
                require(not any(item["event"] == "declined" for item in history), "This proposal was declined")
            else:
                require(previous and previous[0]["event"] in {"load_requested", "tune_requested"} and previous[0].get("context") == params["context"], "Recipient outcome lacks its original immutable operation context")
                require(len(previous) == 1, "Recipient operation already has an outcome", "operation_attempted")
                require(params["event"] != "loaded" or previous[0]["event"] == "load_requested", "Load outcome belongs to another action")
                require(not params["event"].startswith("tune_") or previous[0]["event"] == "tune_requested", "Tune outcome belongs to another action")
            history.append({"event": params["event"], "operationID": params["operationID"], "context": params["context"], "detail": params["detail"], "atUTC": now})
        store.conn.execute("UPDATE xlog_group_directed SET payload=? WHERE id=?", (json.dumps(message), params["messageID"]))
    else:
        require(action == "read" and set(params) == common, "Unknown coordination action")
    peers = [{"station": row["station"], **json.loads(row["payload"]), "confirmedUTC": row["confirmed_utc"]} for row in store.exec_sql_mult("SELECT * FROM xlog_group_peer ORDER BY station")]
    messages = [{"id": row["id"], "sender": row["sender"], **json.loads(row["payload"]), "createdUTC": row["created_utc"], "acknowledgedUTC": row["acknowledged_utc"],
                 "superseded": bool(store.exec_sql("SELECT 1 AS found FROM xlog_group_directed WHERE json_extract(payload,'$.supersedesID')=?", (row["id"],)))} for row in store.exec_sql_mult("SELECT * FROM xlog_group_directed WHERE sender=? OR target=? ORDER BY created_utc DESC LIMIT 100", (sender, sender))]
    return {"sessionID": state["sessionID"], "workspaceGeneration": params["workspaceGeneration"], "requestID": params["requestID"], "revision": state["revision"], "authority": identity,
            "replayed": False, "peers": peers, "directed": messages, "observedUTC": now, "senderStation": sender,
            "draftMutation": False, "outputArmed": False, "offlineSerialGuarantee": False}
