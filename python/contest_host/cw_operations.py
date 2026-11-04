"""Host side of explicitly admitted CW streams and provider outcome evidence.

Native owns the transmitter. Persisted stream data is an audit/admission fact,
never permission to resume a transmitter after restart.
"""
from copy import deepcopy
import re
import uuid

from .cw_sequence import compile_sequence


def admit(desk, method, params, require):
    state = desk.state
    require(not state.get("practice") and state["run"] and state.get("operatingMode", state["draft"].get("mode", "CW")) == "CW",
            "Early CW requires an armed, deliberate Run/CW operation")
    require(params.get("earlyStartEnabled") is True, "Early CW is off by default")
    require(params.get("inputOrigin") == "typing" or params.get("manualStart") is True,
            "Restored, pasted or programmatically selected calls cannot start early CW")
    stream_id = params.get("streamID")
    try:
        uuid.UUID(stream_id)
    except (ValueError, TypeError, AttributeError):
        require(False, "Invalid early CW stream identity")
    call = desk.callsign.text().strip().upper()
    require(re.fullmatch(r"[A-Z0-9]{1,32}", call) is not None, "Early CW requires a bounded plain callsign")
    previous = state.get("earlyCW")
    if method == "early_cw_start":
        threshold = params.get("threshold", 3)
        require(type(threshold) is int and 2 <= threshold <= 8, "Early CW threshold must be two to eight characters")
        require(params.get("manualStart") is True or len(call) >= threshold, "Call has not reached the early CW threshold")
        require(not previous or not previous.get("admitted"), "Stop the existing early CW stream before starting another")
    else:
        require(isinstance(previous, dict) and previous.get("admitted") is True and previous.get("complete") is False
                and previous.get("streamID") == stream_id and previous.get("draftID") == state["draft"]["id"]
                and previous.get("hostEpoch") == desk.cw_host_epoch
                and previous.get("nativeOwner") == params.get("cwOwnerContext"),
                "Early CW stream is retired; explicitly start again")
        require(call.startswith(previous["call"]), "Submitted characters cannot be unsent. Stop and use corrected-call recovery")
    complete = method == "early_cw_finish"
    require(not complete or re.search(r"[0-9]", call) and re.search(r"[A-Z]", call), "Complete the callsign before the exchange")
    state["earlyCW"] = {"schema": 1, "streamID": stream_id, "draftID": state["draft"]["id"],
        "revision": state["revision"] + 1, "call": call, "complete": complete, "admitted": True,
        "operationID": params["operationID"], "hostEpoch": desk.cw_host_epoch,
        "nativeOwner": deepcopy(params.get("cwOwnerContext"))}
    # Cumulative content is intentional: native admits its monotonic suffix once.
    desk.actions.append({"kind": "function_key", "key": "EARLY", "label": "Early callsign",
        "template": call, "cwSequence": compile_sequence(call, {}),
        "sessionID": state["sessionID"], "workspaceGeneration": state.get("workspaceGeneration"),
        "draftID": state["draft"]["id"], "fields": desk.values(), "stationCall": desk.station["Call"],
        "sentExchange": "", "sentSerial": "", "earlyCW": deepcopy(state["earlyCW"])})


def corrected_component(previous, current):
    """One unambiguous plain-call component; portable/multiple edits use full call."""
    pattern = re.compile(r"([A-Z0-9]*[A-Z])([0-9])([A-Z]+)\Z")
    before, after = pattern.fullmatch(previous), pattern.fullmatch(current)
    if not before or not after:
        return current
    changed = [index for index in range(1, 4) if before[index] != after[index]]
    if len(changed) != 1:
        return current
    return after[3] if changed[0] == 3 else after[1] + after[2]


def live_continuation(desk, stream, evidence):
    """A persisted queue receipt cannot grant a fresh native owner admission."""
    admission = getattr(desk, "cw_continuation_admission", None)
    owner = stream.get("nativeOwner")
    provider = {"providerID": evidence.get("providerID"), "generation": evidence.get("generation")}
    return (isinstance(admission, dict) and isinstance(owner, dict)
            and bool(owner.get("ownerID")) and type(owner.get("epoch")) is int
            and admission.get("nativeOwner") == owner
            and stream.get("hostEpoch") == getattr(desk, "cw_host_epoch", None)
            and bool(stream.get("hostEpoch"))
            and admission.get("streamID") == stream.get("streamID")
            and admission.get("draftID") == stream.get("draftID")
            and admission.get("operationID") == stream.get("operationID")
            and admission.get("providerContext") == provider
            and getattr(desk, "cw_provider_context", None) == provider)


def outcome(store, state, params, require):
    """Native receipt side channel; no semantic revision or output action.

    The originating durable output must have been claimed. Missing facts never
    become provider acceptance, and stopped/uncertain outcomes invalidate calls.
    """
    import json
    operation = params.get("outputOperationID")
    row = store.exec_sql("SELECT result FROM xlog_operation WHERE operation_id=?", (operation,))
    require(row and store.exec_sql("SELECT operation_id FROM xlog_output_claim WHERE operation_id=?", (operation,)),
            "CW outcome has no claimed original operation")
    original = json.loads(row["result"])
    require(original["sessionID"] == state["sessionID"], "CW outcome belongs to another session")
    status = params.get("outcome")
    require(status in {"accepted", "stopped", "uncertain"}, "Invalid CW provider outcome")
    previous = state.get("cwOutputEvidence", {})
    if previous.get("sourceContestRevision", -1) > original["revision"] or \
            previous.get("outputOperationID") == operation and previous.get("outcome") in {"stopped", "uncertain"} and status == "accepted":
        return {"recorded": False, "reason": "A later or uncertain terminal outcome is retained"}
    evidence = {"outputOperationID": operation, "outcome": status,
        "sourceContestRevision": original["revision"],
        "providerID": str(params.get("providerID", ""))[:128], "generation": params.get("generation"),
        "acceptanceLevel": params.get("acceptanceLevel", "unknown")}
    actions = original.get("actions", [])
    call = params.get("acceptedCall")
    matching = [a for a in actions if a.get("draftID") == state["draft"]["id"]
                and a.get("fields", {}).get("callsign") == call and "{CALL}" in a.get("template", "")
                and not a.get("partialCorrection") and not a.get("earlyCallSuppressed")]
    if status == "accepted" and evidence["acceptanceLevel"] == "provider_accepted" and matching and re.fullmatch(r"[A-Z0-9/]{3,32}", call or ""):
        evidence["acceptedCall"] = call
        evidence["draftID"] = state["draft"]["id"]
    state["cwOutputEvidence"] = evidence
    stream = state.get("earlyCW")
    if status != "accepted" and isinstance(stream, dict) and (stream.get("operationID") == operation
            or any(action.get("earlyCW", {}).get("streamID") == stream.get("streamID") for action in actions)):
        stream["admitted"] = False
    # Supplemental QTC output evidence is separate from counterparty accounting.
    qtc = state.get("qtcOperating")
    if isinstance(qtc, dict):
        for attempt in qtc.get("attempts", []):
            if attempt.get("operationID") == operation:
                attempt["outcome"] = deepcopy(evidence)
    store.save_state(state)
    return {"recorded": True, **evidence}
