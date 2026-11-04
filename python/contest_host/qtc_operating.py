"""Additive QTC desk/output metadata, independent of schema-1 accounting."""
from copy import deepcopy
from collections import Counter
from datetime import datetime, UTC
import hashlib
import json
import re


def operating(state):
    value = state.get("qtcOperating", {"schema": 1, "workspace": {}, "attempts": [], "observations": {}})
    if not isinstance(value, dict) or value.get("schema") != 1 or not isinstance(value.get("workspace"), dict) \
            or not isinstance(value.get("attempts"), list) or len(value["attempts"]) > 5000 \
            or not isinstance(value.get("observations"), dict):
        raise ValueError("Saved QTC operating metadata is unreadable; preserve it before recovery")
    return deepcopy(value)


def editor_token(edit):
    if edit.get("editID"):
        return "id:" + edit["editID"]
    return "legacy:" + hashlib.sha256(json.dumps(edit, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def mutate(desk, params, require):
    from .wae import PLUGINS, batches
    state, action = desk.state, params["action"]
    require(state["pluginID"] in PLUGINS, "Select a WAE definition before using the QTC desk")
    data = operating(state)
    if action == "qtc_workspace":
        workspace = params.get("workspace")
        require(isinstance(workspace, dict) and len(json.dumps(workspace)) <= 16384, "QTC editor exceeds its bound")
        allowed = {"direction", "counterpart", "number", "timestamp", "rows", "selectedBatchID", "selectedIndex", "selectedField", "pendingEdit"}
        require(set(workspace) <= allowed, "Unsupported QTC editor data")
        require(workspace.get("direction", "receive") in {"send", "receive"}, "Choose a QTC editor direction")
        require(isinstance(workspace.get("counterpart", ""), str) and len(workspace.get("counterpart", "")) <= 32,
                "Invalid QTC editor counterpart")
        require(type(workspace.get("number", 1)) is int and 0 <= workspace.get("number", 1) <= 99999, "Invalid unfinished QTC number")
        require(isinstance(workspace.get("timestamp", ""), str) and len(workspace.get("timestamp", "")) <= 32, "Invalid QTC editor timestamp")
        require(isinstance(workspace.get("selectedBatchID", ""), str) and len(workspace.get("selectedBatchID", "")) <= 64
            and type(workspace.get("selectedIndex", 0)) is int and 0 <= workspace.get("selectedIndex", 0) < 10,
            "Invalid QTC editor cursor")
        require(workspace.get("selectedField", "all") in {"header", "all", "time", "callsign", "serial", "final"}, "Invalid QTC editor field")
        rows = workspace.get("rows", [])
        require(isinstance(rows, list) and len(rows) <= 10 and all(isinstance(row, dict) and set(row) <= {"time", "callsign", "serial"}
            and all(isinstance(value, str) and len(value) <= 32 and not any(ord(c) < 32 for c in value) for value in row.values()) for row in rows),
            "Invalid unfinished QTC rows")
        edit = workspace.get("pendingEdit")
        require(edit is None or isinstance(edit, dict) and {"batchID", "index", "row"} <= set(edit) <= {"batchID", "index", "row", "editID"}
            and isinstance(edit["batchID"], str) and len(edit["batchID"]) <= 64 and type(edit["index"]) is int and 0 <= edit["index"] < 10
            and ("editID" not in edit or isinstance(edit["editID"], str) and re.fullmatch(r"[0-9a-fA-F-]{36}", edit["editID"]) is not None)
            and isinstance(edit["row"], dict) and set(edit["row"]) == {"time", "callsign", "serial"}
            and all(isinstance(value, str) and len(value) <= 32 and not any(ord(c) < 32 for c in value) for value in edit["row"].values()), "Invalid unfinished pending QTC edit")
        data["workspace"] = deepcopy(workspace)
        if edit and editor_token(edit) in data.get("clearedEditors", []):
            data["workspace"]["pendingEdit"] = None
    elif action == "qtc_observe":
        call = params.get("counterpart", "").strip().upper()
        require(re.fullmatch(r"[A-Z0-9/]{3,32}", call) is not None, "Enter a QTC counterpart")
        status = params.get("status")
        require(status in {"unknown", "available", "later", "unavailable"}, "Choose a local QTC observation")
        note = params.get("note", "")
        require(isinstance(note, str) and len(note) <= 256, "QTC observation note exceeds its bound")
        when = params.get("observedUTC", datetime.now(UTC).isoformat())
        try:
            parsed = datetime.fromisoformat(when.replace("Z", "+00:00"))
            require(parsed.utcoffset() is not None and parsed.utcoffset().total_seconds() == 0, "Use UTC for QTC observations")
        except (ValueError, TypeError, AttributeError):
            require(False, "Invalid QTC observation UTC")
        require(len(data["observations"]) < 2000 or call in data["observations"], "QTC observation capacity reached")
        data["observations"][call] = {"status": status, "observedUTC": when, "note": note}
    elif action == "qtc_complete":
        batch = next((row for row in batches(state) if row["id"] == params.get("batchID")), None)
        require(batch is not None and batch["status"] == "open" and all(item["status"] == "confirmed" for item in batch["items"]),
                "Acknowledge every QTC item explicitly before completing the series")
        data.setdefault("completedSeries", {})[batch["id"]] = {"operationID": params["operationID"], "completedUTC": datetime.now(UTC).isoformat()}
    elif action == "qtc_output_result":
        attempt = next((row for row in data["attempts"] if row["operationID"] == params.get("outputOperationID")), None)
        require(attempt is not None, "QTC output attempt no longer exists")
        require(desk.database.exec_sql("SELECT operation_id FROM xlog_output_claim WHERE operation_id=?", (attempt["operationID"],)),
                "QTC output was not claimed by an output owner")
        require(params.get("outcome") in {"owner_returned", "uncertain", "stopped"}, "Invalid QTC output outcome")
        attempt["outcome"] = {"outcome": params["outcome"], "acceptanceLevel": "native_route_report",
            "basis": "Owner route response; RF and counterparty acknowledgement unverified"}
    elif action == "qtc_output":
        require(not state.get("practice"), "Practice has native output disabled")
        batch = next((row for row in batches(state) if row["id"] == params.get("batchID")), None)
        require(batch is not None and batch["status"] == "open", "Resume the existing QTC series before output")
        index, field = params.get("index", 0), params.get("qtcField", params.get("fields", "all"))
        require(type(index) is int and 0 <= index < len(batch["items"]), "Select a QTC item")
        require(field in {"header", "all", "time", "callsign", "serial", "final"}, "Choose a QTC output field")
        item = batch["items"][index]
        if batch["direction"] == "receive":
            payload = "QSL" if field == "final" else "AGN " + {"header": "QTC NR", "all": "QTC", "time": "TIME", "callsign": "CALL", "serial": "NR"}[field]
        else:
            payload = (f"QTC {batch['number']}/{batch['count']}" if field == "header" else
                       "QSL?" if field == "final" else
                       " ".join(item[key] for key in ("time", "callsign", "serial")) if field == "all" else item[field])
        require(len(data["attempts"]) < 5000, "QTC output attempt capacity reached")
        mode = batch.get("mode", state["pluginID"][4:].upper())
        require(mode == state.get("operatingMode", mode), "QTC mode differs from the current output context")
        context = {"sessionID": state["sessionID"], "workspaceGeneration": state.get("workspaceGeneration"),
                   "sourceRevision": state["sourceRevision"],
                   "draftID": state["draft"]["id"], "qtc": {"schema": 1, "batchID": batch["id"], "index": index, "field": field,
                       "snapshotSHA256": hashlib.sha256(json.dumps(batch, sort_keys=True, separators=(",", ":")).encode()).hexdigest()}}
        if "bridgeGeneration" in params:
            generation = params["bridgeGeneration"]
            require(isinstance(generation, str) and re.fullmatch(r"[0-9a-fA-F-]{36}", generation) is not None, "Invalid QTC digital output generation")
            context["qtc"]["bridgeGeneration"] = generation
        if "voiceTarget" in params:
            target = params["voiceTarget"]
            require(isinstance(target, dict) and target.get("schemaVersion") == 1 and len(json.dumps(target)) <= 8192, "Invalid QTC voice target snapshot")
            context["qtc"]["voiceTarget"] = deepcopy(target)
        if "cwProviderContext" in params:
            target = params["cwProviderContext"]
            require(isinstance(target, dict) and set(target) == {"providerID", "generation"} and len(json.dumps(target)) <= 1024, "Invalid QTC CW provider binding")
            context["qtc"]["cwProviderContext"] = deepcopy(target)
        digest = hashlib.sha256(payload.encode()).hexdigest()
        if mode == "SSB" and field == "final":
            payload = "[qsl]"  # A real managed fragment must exist before PTT.
            digest = hashlib.sha256(payload.encode()).hexdigest()
        output = {"kind": "function_key" if mode == "CW" else "voice_keyer" if mode == "SSB" else "fldigi", "key": "QTC", "label": "QTC " + field,
                  "template": payload, "payload": payload, "payloadUTF8Bytes": len(payload.encode()), "payloadSHA256": digest,
                  "signal": "cw" if mode == "CW" else "phone" if mode == "SSB" else "digital", "mode": mode,
                  "stationCall": state["station"]["Call"], "fields": {}, "sentExchange": "", "sentSerial": "", **context}
        if mode == "CW":
            # Historical QTC values are literal, with original times/serials.
            output["cwSequence"] = {"schema": 1, "segments": [{"kind": "text", "text": payload}]}
        else:
            output.update(nlBefore=True, rxAfter=True)
        desk.actions.append(output)
        from .lanes import attribution
        data["attempts"].append({"operationID": params["operationID"], **context["qtc"], "payload": payload,
            "payloadSHA256": digest, "requestedUTC": datetime.now(UTC).isoformat(), "mode": mode,
            "frequencyHz": state["draft"]["frequencyHz"],
            "frequencyBasis": "captured-entry-frequency",
            "laneContext": attribution(state), "state": "prepared", "outcome": None})
    else:
        require(False, "Unsupported QTC operating action")
    state["qtcOperating"] = data
    return data


def opportunities(desk, calls):
    from .wae import available, batches, eligibility, european, identity
    data, journal = operating(desk.state), batches(desk.state)
    direction = "receive" if european(identity(desk.state, desk.station["Call"]), desk.station["Call"]) else "send"
    # Eligibility/reservations are shared across counterparts. Scan the log once
    # per bounded projection, then exclude the counterpart's own source rows.
    bidirectional = desk.state["pluginID"] == "wae_rtty"
    sources = available(desk, "") if direction == "send" or bidirectional else []
    sources_by_call = Counter(item["callsign"] for item in sources)
    result = {}
    for call in calls:
        reserved = sum(len(batch["items"]) for batch in journal if batch["counterpart"] == call)
        confirmed = sum(item["status"] == "confirmed" for batch in journal if batch["counterpart"] == call for item in batch["items"])
        observation = data["observations"].get(call, {"status": "unknown"})
        remaining = max(0, 10 - reserved)
        capabilities = {}
        for candidate in ("send", "receive"):
            reason = eligibility(desk.state, call, candidate)
            source_count = len(sources) - sources_by_call[call] if candidate == "send" and reason is None else None
            capabilities[candidate] = {
                "eligibility": "unknown" if reason and reason.startswith("Resolve") else "ineligible" if reason else "eligible",
                "reason": reason, "availableSources": source_count,
                "opportunity": reason is None and remaining > 0 and observation["status"] != "unavailable"
                               and (candidate == "receive" or source_count > 0)}
        primary = capabilities[direction]
        reason, source_count = primary["reason"], primary["availableSources"]
        result[call] = {"eligibility": "unknown" if reason and reason.startswith("Resolve") else "ineligible" if reason else "eligible",
            "reason": reason, "direction": direction, "remaining": remaining, "confirmed": confirmed,
            "reserved": reserved, "availableSources": source_count, "observation": observation,
            "opportunity": any(value["opportunity"] for value in capabilities.values()),
            # Additive schema-1 capability extension; the shared quota stays above.
            "capabilities": capabilities}
    return result
