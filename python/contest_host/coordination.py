"""Directed operating evidence inside the existing group authority transaction.

Messages never edit drafts, allocate serials, publish spots or grant output.
The native authority owner supplies senderStation from its admitted peer envelope.
"""
import json
import re
from datetime import datetime, timezone


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
        require(isinstance(message, dict) and set(message) == {"target", "kind", "body", "call", "frequencyHz", "mode", "laneID"}, "Exact directed-message fields required")
        require(message["kind"] in {"talk", "pass", "helper"} and message["laneID"] in {"laneA", "laneB"}, "Choose a directed kind and target lane")
        require(isinstance(message["target"], str) and message["target"] != sender and store.exec_sql("SELECT 1 AS found FROM xlog_group_peer WHERE station=?", (message["target"],)), "Choose a known other station")
        require(all(isinstance(message[key], str) and len(message[key].encode()) <= maximum and not any(ord(c)<32 for c in message[key]) for key, maximum in (("body",512),("call",32),("mode",16))), "Invalid directed-message text")
        require(message["kind"] == "talk" or re.fullmatch(r"[A-Z0-9/]{3,32}", message["call"]), "Pass/helper requires a complete callsign")
        require(type(message["frequencyHz"]) is int and 0 <= message["frequencyHz"] <= 100_000_000_000, "Invalid proposed frequency")
        store.conn.execute("INSERT INTO xlog_group_directed VALUES(?,?,?,?,?,NULL)", (params["requestID"], sender, message["target"], json.dumps(message), now))
    elif action == "acknowledge":
        require(set(params) == common | {"messageID"}, "Unexpected acknowledgement fields")
        row = store.exec_sql("SELECT target FROM xlog_group_directed WHERE id=?", (params["messageID"],))
        require(row and row["target"] == sender, "Only the addressed station can acknowledge this proposal", "wrong_recipient")
        store.conn.execute("UPDATE xlog_group_directed SET acknowledged_utc=COALESCE(acknowledged_utc,?) WHERE id=?", (now, params["messageID"]))
    else:
        require(action == "read" and set(params) == common, "Unknown coordination action")
    peers = [{"station": row["station"], **json.loads(row["payload"]), "confirmedUTC": row["confirmed_utc"]} for row in store.exec_sql_mult("SELECT * FROM xlog_group_peer ORDER BY station")]
    messages = [{"id": row["id"], "sender": row["sender"], **json.loads(row["payload"]), "createdUTC": row["created_utc"], "acknowledgedUTC": row["acknowledged_utc"]} for row in store.exec_sql_mult("SELECT * FROM xlog_group_directed WHERE sender=? OR target=? ORDER BY created_utc DESC LIMIT 100", (sender, sender))]
    return {"sessionID": state["sessionID"], "workspaceGeneration": params["workspaceGeneration"], "requestID": params["requestID"], "revision": state["revision"], "authority": identity,
            "replayed": False, "peers": peers, "directed": messages, "observedUTC": now, "senderStation": sender,
            "draftMutation": False, "outputArmed": False, "offlineSerialGuarantee": False}
