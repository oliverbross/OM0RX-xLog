"""Finite practice-copy payloads; no contacts, drafts, leases or serials travel here."""
from copy import deepcopy
import re


def practice_setup(source):
    """Retain operator UI/message choices without credentials or enabled services."""
    setup = {key: deepcopy(source[key]) for key in (
        "name", "operator", "pluginID", "station", "settings", "preferences", "network", "macros")}
    setup["name"] = ("Practice: " + str(source["name"]))[:128]
    setup["preferences"] = {key: value for key, value in setup["preferences"].items()
                            if not re.search(r"password|secret|token|username|credential|voiceProfilePath|soundDevice|rtcURL", key, re.I)}
    setup["preferences"].update(rtcEnabled=False, autoCQ=False)
    setup["network"] = {key: False for key in (
        "n1mmEnabled", "n1mmRadio", "n1mmContact", "n1mmLookup", "n1mmScore", "multiEnabled", "multiMaster")}
    return setup


def practice_creation(source, target):
    """Build only new_state inputs, preserving historical scoring/reference policy.

    Caller validates source identity/revision, distinct target ID and workspace,
    passes scoring_revision separately to new_state, then attaches metadata/setup.
    All serial reservations belong to the new database and new draft identity.
    """
    setup = practice_setup(source.get("setup") or {
        "name": source["name"], "operator": source["operator"], "pluginID": source["pluginID"],
        "station": source["station"], "settings": source["settings"],
        "preferences": {}, "network": {}, "macros": []})
    params = {key: deepcopy(target[key]) for key in (
        "sessionID", "workspaceGeneration", "operationID", "expectedRevision")}
    params.update({key: deepcopy(source[key]) for key in (
        "pluginID", "operator", "station", "settings", "reference")})
    params.update(name=setup["name"], frequencyHz=source["draft"]["frequencyHz"],
                  mode=source.get("operatingMode"))
    metadata = {"sourceSessionID": source["sessionID"], "sourceRevision": source["revision"],
                "nativeOutputDisabled": True, "publicPostingDisabled": True}
    return params, setup, metadata, source.get("scoringRevision")


def is_practice(state):
    """The host-owned marker is authoritative, never a user preference."""
    return isinstance(state.get("practice"), dict)


def enforce_practice_setup(state, setup):
    """Setup edits cannot reactivate services in an existing Practice session."""
    if not is_practice(state):
        return setup
    safe = practice_setup(setup)
    safe["name"] = setup["name"] if setup["name"].startswith("Practice: ") else safe["name"]
    return safe
