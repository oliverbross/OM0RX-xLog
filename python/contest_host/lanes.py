"""Two persisted entry contexts around the existing single log/serial authority.

The selected context aliases legacy Desk keys. Checkpointing copies those keys
back into its lane before saving; a lane switch never allocates a serial, changes
the other entry, or grants station/output authority.
"""
from copy import deepcopy
import json
import re

LANE_IDS = ("laneA", "laneB")
ENTRY_METHODS = {"draft_apply", "digital_select", "digital_ingest", "focus", "run_state", "esm", "function_key", "qso_commit", "lane_context", "lane_select"}
CONTEXT_KEYS = ("draft", "run", "focus", "esmCallSent", "operatingMode")


def snapshot(state):
    return {key: deepcopy(state.get(key, "" if key == "esmCallSent" else None)) for key in CONTEXT_KEYS}


def checkpoint(state):
    saved = state.get("laneState")
    if saved:
        selected = saved["selectedLaneID"]
        saved["lanes"][selected].update(snapshot(state))


def _restore(state, lane):
    for key in CONTEXT_KEYS:
        if lane.get(key) is None:
            state.pop(key, None)
        else:
            state[key] = deepcopy(lane[key])


def select(state, params, require, *, mandatory=False):
    saved = state.get("laneState")
    lane_id = params.get("laneID")
    if not saved:
        require(lane_id in {None, "laneA"}, "This session has no second lane", "stale_lane")
        return "laneA"
    require(isinstance(saved, dict) and saved.get("version") == 1 and saved.get("mode") in {"SO1V", "SO2V", "SO2R"}
            and isinstance(saved.get("lanes"), dict) and saved.get("selectedLaneID") in saved["lanes"],
            "Saved lane context is unreadable; preserve it before recovery", "lane_recovery_required")
    if mandatory and saved["mode"] != "SO1V":
        require(lane_id in LANE_IDS, "Choose an explicit operating lane", "lane_required")
    if lane_id is not None and saved["mode"] != "SO1V":
        require(params.get("workspaceGeneration") == state.get("workspaceGeneration"), "Lane workspace changed", "stale_context")
    lane_id = lane_id or saved["keyboardLaneID"]
    require(lane_id in saved["lanes"] and (saved["mode"] != "SO1V" or lane_id == "laneA"), "Operating lane is unavailable", "stale_lane")
    lane = saved["lanes"][lane_id]
    if mandatory and saved["mode"] != "SO1V" or "bindingVersion" in params:
        require(type(params.get("bindingVersion")) is int and params["bindingVersion"] == lane["bindingVersion"],
                "Lane binding changed; review the target again", "stale_binding")
    checkpoint(state)
    saved["selectedLaneID"] = lane_id
    _restore(state, lane)
    return lane_id


def validate_binding(value, require):
    if value is None:
        return None
    require(isinstance(value, dict) and set(value) == {"radioID", "receiverID", "vfo", "sliceID", "generation"}, "Exact lane binding required")
    require(value["radioID"] in {"radio1", "radio2"}, "Choose an explicit radio slot")
    for key in ("receiverID", "vfo", "sliceID"):
        require(key == "sliceID" and value[key] is None or isinstance(value[key], str) and 0 < len(value[key].encode()) <= 128, "Invalid receiver/VFO/slice identity")
    require(any(value[key] is not None for key in ("receiverID", "vfo", "sliceID")), "A lane requires an exact receiver, VFO or slice")
    generation = value["generation"]
    require(isinstance(generation, str) and 0 < len(generation.encode()) <= 128 or type(generation) is int and generation >= 0,
            "A lane requires the current connection generation")
    return deepcopy(value)


def configure(state, params, require, make_second_lane):
    mode = params.get("mode")
    require(mode in {"SO1V", "SO2V", "SO2R"}, "Choose SO1V, SO2V or SO2R")
    bindings = params.get("bindings")
    require(isinstance(bindings, dict) and set(bindings) == set(LANE_IDS), "Both lane bindings must be reviewed explicitly")
    bindings = {key: validate_binding(value, require) for key, value in bindings.items()}
    first, second = bindings.values()
    if first and second and mode != "SO1V":
        require((first["radioID"] != second["radioID"]) == (mode == "SO2R"), "SO2R needs two radios; SO2V needs two receivers on one radio")
        require(tuple(first[key] for key in ("radioID", "receiverID", "vfo", "sliceID")) !=
                tuple(second[key] for key in ("radioID", "receiverID", "vfo", "sliceID")),
                "Two lanes require distinct receiver/VFO/slice identities")
    checkpoint(state)
    saved = state.setdefault("laneState", {"version": 1, "mode": "SO1V", "keyboardLaneID": "laneA", "selectedLaneID": "laneA", "lanes": {
        "laneA": {**snapshot(state), "binding": None, "bindingVersion": 0, "cqContext": {}, "esmContext": {}}}})
    if mode != "SO1V" and "laneB" not in saved["lanes"]:
        saved["lanes"]["laneB"] = {**make_second_lane(), "binding": None, "bindingVersion": 0, "cqContext": {}, "esmContext": {}}
    for lane_id, lane in saved["lanes"].items():
        if lane["binding"] != bindings[lane_id]:
            lane["binding"] = bindings[lane_id]
            lane["bindingVersion"] += 1
    saved["mode"] = mode
    target = params.get("keyboardLaneID", saved["keyboardLaneID"] if mode != "SO1V" else "laneA")
    require(target in saved["lanes"] and (mode != "SO1V" or target == "laneA"), "Invalid keyboard lane")
    saved["keyboardLaneID"] = target
    saved["selectedLaneID"] = target
    _restore(state, saved["lanes"][target])


def context(state, params, require):
    saved = state.get("laneState")
    require(saved is not None, "Configure operating lanes first")
    lane = saved["lanes"][saved["selectedLaneID"]]
    for key in ("cqContext", "esmContext"):
        if key in params:
            value = params[key]
            require(isinstance(value, dict) and len(value) <= 16 and len(json.dumps(value, allow_nan=False).encode()) <= 2048,
                    "Bounded lane context required")
            if key == "cqContext" and "rememberedCQFrequencyHz" in value:
                frequency = value["rememberedCQFrequencyHz"]
                require(frequency is None or type(frequency) is int and 100_000 <= frequency <= 100_000_000_000,
                        "Remembered CQ frequency must be integer Hz or unknown")
            lane[key] = deepcopy(value)


def metadata(state, current):
    saved = state.get("laneState")
    if not saved:
        return {}
    selected = saved["selectedLaneID"]
    rows = []
    for lane_id, lane in saved["lanes"].items():
        if saved["mode"] == "SO1V" and lane_id != "laneA":
            continue
        row = {"laneID": lane_id, "bindingVersion": lane["bindingVersion"], "binding": deepcopy(lane["binding"]),
               "draftID": lane["draft"]["id"], "frequencyHz": lane["draft"]["frequencyHz"],
               "receiveFrequencyHz": lane["draft"].get("receiveFrequencyHz"), "reservedSerial": lane["draft"].get("serial"),
               "mode": lane.get("operatingMode") or state.get("settings", {}).get("ModeCategory", "CW"),
               "run": lane["run"], "focus": lane["focus"], "esmCallSent": lane.get("esmCallSent", ""),
               "cqContext": deepcopy(lane["cqContext"]), "esmContext": deepcopy(lane["esmContext"]),
               "fields": [{**descriptor, "value": lane["draft"]["fields"].get(descriptor["id"], "")} for descriptor in current["fields"]]}
        if lane_id == selected:
            row.update({key: deepcopy(current[key]) for key in ("draftID", "fields", "frequencyHz", "mode", "run", "focus", "reservedSerial")})
            row["receiveFrequencyHz"] = state["draft"].get("receiveFrequencyHz")
        rows.append(row)
    return {"selectedLaneID": selected, "bindingVersion": saved["lanes"][selected]["bindingVersion"],
            "operatingLanes": {"version": 1, "mode": saved["mode"], "keyboardLaneID": saved["keyboardLaneID"], "lanes": rows}}


def attribution(state):
    saved = state.get("laneState")
    if not saved:
        return None
    lane_id = saved["selectedLaneID"]
    lane = saved["lanes"][lane_id]
    receive = state["draft"].get("receiveFrequencyHz")
    transmit = state["draft"]["frequencyHz"]
    return {"laneID": lane_id, "loggingLaneID": lane_id, "draftID": state["draft"]["id"], "workspaceGeneration": state.get("workspaceGeneration"),
            "bindingVersion": lane["bindingVersion"], "binding": deepcopy(lane["binding"]),
            "bindingEvidence": "operator_intent", "physicalRadioEvidence": "unverified", "frequencyEvidence": "entry_context",
            "splitEvidence": "operator_entry" if receive is not None else "unknown", "split": receive != transmit if receive is not None else None,
            "receiveFrequencyHz": receive, "transmitFrequencyHz": transmit}


def augment_adif(payload, rows, attributions, require, digital_events=None, serial_grid_contest=None):
    """Add known logging-lane and explicit RX facts to the pinned writer output.

    Walk length-framed tags so a literal <EOR> inside an operator comment cannot
    be confused with a record boundary. The caller uses the writer's exact row
    ordering and checks record count before associating any metadata.
    """
    digital_events=digital_events or {}
    if not attributions and not digital_events and not serial_grid_contest:
        return payload
    content = payload.decode("utf-8")
    boundaries, position, fields_in_record = [], 0, []
    while match := re.search(r"<([^<>]+)>", content[position:]):
        start = position + match.start()
        position += match.end()
        tag = match.group(1).split(":")
        if len(tag) > 1 and tag[1].isdigit():
            position += int(tag[1])
            fields_in_record.append((tag[0].upper(),start,position))
        elif tag[0].upper() == "EOR":
            boundaries.append((start,fields_in_record));fields_in_record=[]
    require(len(boundaries) == len(rows), "ADIF record count differs from the authoritative log", "export_failed")
    for (offset, existing), row in reversed(list(zip(boundaries, rows))):
        known = attributions.get(row["ID"])
        fields = {"APP_XLOG_LOGGING_LANE": known["loggingLaneID"]} if known else {}
        if serial_grid_contest:
            # These pinned writers omit the received grid and use a display
            # label/empty contest ID. Export the existing row's actual facts.
            fields.update(CONTEST_ID=serial_grid_contest, GRIDSQUARE=row["Exchange1"], MY_GRIDSQUARE=row["MiscText"])
        if known and known.get("receiveFrequencyHz") is not None:
            receive = float(row.get("QSXFreq") or 0) / 1000
            if receive > 0:
                fields["FREQ_RX"] = f"{receive:.6f}"
        packet=digital_events.get(row["ID"])
        if packet:
            # ADIF mode/submode and actual sent serial are immutable external
            # evidence. Received corrections remain the authoritative row's.
            fields.update({key:packet[key] for key in ("MODE","SUBMODE","STX","STX_STRING","STATION_CALLSIGN","MY_GRIDSQUARE","APP_XLOG_EXTERNAL_INSTANCE") if packet.get(key)})
            # Operator and RX frequency are editable contact facts. Keep the
            # original packet below, but do not let it undo an explicit edit.
            if "OPERATOR" in packet:
                if row.get("Operator"):
                    fields["OPERATOR"] = str(row["Operator"])
            if "FREQ_RX" in packet:
                receive = float(row.get("QSXFreq") or 0) / 1000
                if receive > 0:
                    fields["FREQ_RX"] = f"{receive:.6f}"
                else:
                    fields.pop("FREQ_RX", None)
            fields["APP_XLOG_EXTERNAL_ADIF"]=json.dumps(packet,ensure_ascii=False,separators=(",",":"))
        replaced = set(fields)
        if packet:
            # An intentional clear must also remove a pre-existing output tag.
            replaced.update(key for key in ("OPERATOR", "FREQ_RX") if key in packet)
        addition = "".join(f"<{key}:{len(str(value))}>{value}\r\n" for key, value in fields.items())
        content = content[:offset] + addition + content[offset:]
        for key,start,end in reversed(existing):
            if key in replaced:
                content=content[:start]+content[end:]
    return content.encode("utf-8")
