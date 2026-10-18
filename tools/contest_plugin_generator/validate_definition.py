#!/opt/homebrew/bin/python3.14
"""Validate authoring envelopes and emit strict XContestCore draft JSON.

Version 1 remains a historical shape-and-digest check. Version 2 is validated
against definition_schema.json plus cross-field invariants before translation.
Neither path reviews, activates, or asserts sponsor acceptance of a definition.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any

SCHEMA_PATH = Path(__file__).with_name("definition_schema.json")
LEGACY_POLICY_KINDS = {
    "dupe": {"once-per-contest", "per-band", "per-band-mode", "none"},
    "points": {"fixed", "bounded-clauses", "unsupported-adapter"},
    "multipliers": {"none", "unique-field", "entity-prefix", "country", "zone", "unsupported-adapter"},
    "serial": {"none", "sequential", "station-resolved", "unsupported-adapter"},
    "export": {"existing-cabrillo-adif", "existing-adif-only", "unsupported-adapter"},
}


def canonical_payload(definition: dict[str, Any]) -> bytes:
    value = copy.deepcopy(definition)
    value["identity"]["contentDigest"] = "sha256:" + "0" * 64
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()


def expected_digest(definition: dict[str, Any]) -> str:
    return "sha256:" + hashlib.sha256(canonical_payload(definition)).hexdigest()


def load_json(path: Path) -> Any:
    def reject_constant(value: str) -> None:
        raise ValueError(f"nonfinite JSON number {value} is not allowed")

    def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        value: dict[str, Any] = {}
        for key, item in pairs:
            if key in value:
                raise ValueError(f"duplicate JSON object key {key!r} is not allowed")
            value[key] = item
        return value

    return json.loads(path.read_text(encoding="utf-8"), parse_constant=reject_constant,
                      object_pairs_hook=reject_duplicate_keys)


def _schema() -> dict[str, Any]:
    return load_json(SCHEMA_PATH)


def _resolve(schema: dict[str, Any], root: dict[str, Any]) -> dict[str, Any]:
    reference = schema.get("$ref")
    if not reference:
        return schema
    if not reference.startswith("#/"):
        raise ValueError(f"external schema reference is not supported: {reference}")
    value: Any = root
    for part in reference[2:].split("/"):
        value = value[part.replace("~1", "/").replace("~0", "~")]
    return value


def _type_matches(value: Any, expected: str) -> bool:
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    return False


def schema_diagnostics(value: Any, schema: dict[str, Any], root: dict[str, Any], path: str = "$") -> list[str]:
    schema = _resolve(schema, root)
    if "oneOf" in schema:
        attempts = [schema_diagnostics(value, candidate, root, path) for candidate in schema["oneOf"]]
        if sum(not attempt for attempt in attempts) != 1:
            return [f"{path} does not match exactly one allowed shape"]
        return []
    if "const" in schema and value != schema["const"]:
        return [f"{path} must equal {schema['const']!r}"]
    if "enum" in schema and value not in schema["enum"]:
        return [f"{path} has unsupported value {value!r}"]
    expected_type = schema.get("type")
    if expected_type and not _type_matches(value, expected_type):
        return [f"{path} must be {expected_type}"]

    result: list[str] = []
    if isinstance(value, dict):
        required = schema.get("required", [])
        for key in required:
            if key not in value:
                result.append(f"{path}.{key} is required")
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            for key in sorted(set(value) - set(properties)):
                result.append(f"{path}.{key} is not allowed")
        elif isinstance(schema.get("additionalProperties"), dict):
            for key in sorted(set(value) - set(properties)):
                result += schema_diagnostics(value[key], schema["additionalProperties"], root, f"{path}.{key}")
        for key, child in properties.items():
            if key in value:
                result += schema_diagnostics(value[key], child, root, f"{path}.{key}")
    elif isinstance(value, list):
        if len(value) < schema.get("minItems", 0):
            result.append(f"{path} has too few items")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            result.append(f"{path} has too many items")
        if schema.get("uniqueItems"):
            encoded = [json.dumps(item, ensure_ascii=False, separators=(",", ":"), sort_keys=True) for item in value]
            if len(encoded) != len(set(encoded)):
                result.append(f"{path} items must be unique")
        if "items" in schema:
            for index, item in enumerate(value):
                result += schema_diagnostics(item, schema["items"], root, f"{path}[{index}]")
    elif isinstance(value, str):
        if len(value) < schema.get("minLength", 0):
            result.append(f"{path} is too short")
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            result.append(f"{path} is too long")
        if "pattern" in schema and re.fullmatch(schema["pattern"], value) is None:
            result.append(f"{path} does not match the required pattern")
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            result.append(f"{path} is below the minimum")
        if "maximum" in schema and value > schema["maximum"]:
            result.append(f"{path} exceeds the maximum")
    return result


def _report_diagnostics(report: dict[str, Any], path: str) -> list[str]:
    format_ = report["format"]
    expected = {"cwRST": (3, r"[1-5][1-9]{2}"), "digitalRST": (3, r"[1-5][1-9]{2}"),
                "phoneRS": (2, r"[1-5][1-9]"), "none": (0, r"")}[format_]
    result: list[str] = []
    if report["maximumUTF8Bytes"] != expected[0]:
        result.append(f"{path}.maximumUTF8Bytes is inconsistent with {format_}")
    for key in ("defaultSent", "defaultReceived"):
        if re.fullmatch(expected[1], report[key], flags=re.ASCII) is None:
            result.append(f"{path}.{key} is inconsistent with {format_}")
    return result


def _field_map(fields: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {field["id"]: field for field in fields}


def _source_key(source: Any) -> str:
    return source if isinstance(source, str) else f"{source['kind']}:{source['fieldID']}"


def legacy_diagnostics(definition: dict[str, Any]) -> list[str]:
    result: list[str] = []
    required = {"definitionSchemaVersion", "identity", "status", "provenance", "metadata", "entry", "policies", "constraints", "goldenScenarios"}
    missing = sorted(required - definition.keys())
    if missing:
        return [f"missing top-level fields: {', '.join(missing)}"]
    if definition["definitionSchemaVersion"] != "1.0.0":
        result.append("unsupported definitionSchemaVersion")
    identity = definition["identity"]
    if not isinstance(identity, dict):
        return ["identity must be an object"]
    for key in ("id", "version", "edition", "contentDigest"):
        if not identity.get(key):
            result.append(f"missing identity.{key}")
    if identity.get("contentDigest") != expected_digest(definition):
        result.append("identity.contentDigest does not match canonical definition bytes")
    if definition["status"] not in {"draft", "source-derived-draft"}:
        result.append("draft validator cannot authorize reviewed or accepted status")
    provenance = definition["provenance"]
    if not isinstance(provenance, list):
        return result + ["provenance must be an array"]
    if not provenance:
        result.append("at least one provenance record is required")
    if any(not isinstance(item, dict) for item in provenance):
        result.append("each provenance record must be an object")
    metadata = definition["metadata"]
    if not isinstance(metadata, dict):
        return result + ["metadata must be an object"]
    for field in ("displayName", "cabrilloName", "supportedModes", "supportedBands"):
        if field not in metadata:
            result.append(f"missing metadata.{field}")
    entry = definition["entry"]
    if not isinstance(entry, dict):
        return result + ["entry must be an object"]
    for field in ("report", "exchange", "serial", "scorePolicy"):
        if field not in entry:
            result.append(f"missing entry.{field}")
    policies = definition["policies"]
    if not isinstance(policies, dict):
        return result + ["policies must be an object"]
    if "eligibility" not in policies:
        result.append("missing policies.eligibility")
    for name, allowed in LEGACY_POLICY_KINDS.items():
        policy = policies.get(name)
        if not isinstance(policy, dict):
            result.append(f"missing or invalid policies.{name}")
            continue
        kind = policy.get("kind")
        if kind not in allowed:
            result.append(f"missing or unsupported policies.{name}.kind")
        if kind == "unsupported-adapter" and not policy.get("adapterID"):
            result.append(f"policies.{name}.adapterID is required for unsupported-adapter")
    constraints = definition["constraints"]
    if not isinstance(constraints, dict):
        return result + ["constraints must be an object"]
    for field in ("category", "time", "eligibility", "unresolved"):
        if field not in constraints:
            result.append(f"missing constraints.{field}")
    if not isinstance(definition["goldenScenarios"], list):
        result.append("goldenScenarios must be an array")
    return result


def v2_semantic_diagnostics(definition: dict[str, Any]) -> list[str]:
    runtime = definition["runtime"]
    entry = runtime["entry"]
    exchange = entry["exchange"]
    sent = _field_map(exchange["sentFields"])
    received = _field_map(exchange["receivedFields"])
    result: list[str] = []

    if definition["constraints"]["runtimeUnresolved"]:
        result.append("constraints.runtimeUnresolved must be empty before runtime translation")
    if len(definition["provenance"]) != len({json.dumps(item, sort_keys=True) for item in definition["provenance"]}):
        result.append("provenance records must be unique")
    missing_provenance = [item["sha256"] for item in definition["provenance"]
                          if item["sha256"] not in runtime["sourceProvenance"]]
    if missing_provenance:
        result.append("runtime.sourceProvenance must surface every envelope provenance SHA-256")
    if any(len(value.encode()) > 128 for value in (definition["identity"]["version"], definition["identity"]["edition"], runtime["displayName"])):
        result.append("runtime identity and display fields must fit Swift UTF-8 bounds")
    if any(ord(character) < 32 or ord(character) == 127 for character in runtime["sourceProvenance"]):
        result.append("runtime.sourceProvenance cannot contain control characters")

    profiles = entry["modeProfiles"]
    profile_modes = [profile["mode"] for profile in profiles]
    if len(profile_modes) != len(set(profile_modes)):
        result.append("runtime.entry.modeProfiles modes must be unique")
    if set(profile_modes) != set(runtime["supportedModes"]):
        result.append("runtime.supportedModes must exactly match entry.modeProfiles")
    primary = profiles[0]
    for key in ("mode", "adifMode", "cabrilloQSOType", "report"):
        if entry[key] != primary[key]:
            result.append(f"runtime.entry.{key} must match the first mode profile")
    result += _report_diagnostics(entry["report"], "runtime.entry.report")
    mode_contracts = {
        ("CW", "CW", "CW"): {"cwRST", "none"},
        ("SSB", "SSB", "PH"): {"phoneRS", "none"},
        ("AM", "AM", "PH"): {"phoneRS"},
        ("FM", "FM", "PH"): {"phoneRS"},
        ("RTTY", "RTTY", "RY"): {"digitalRST", "none"},
    }
    for index, profile in enumerate(profiles):
        result += _report_diagnostics(profile["report"], f"runtime.entry.modeProfiles[{index}].report")
        allowed_reports = mode_contracts.get((profile["mode"], profile["adifMode"], profile["cabrilloQSOType"]))
        if allowed_reports is None or profile["report"]["format"] not in allowed_reports:
            result.append(f"runtime.entry.modeProfiles[{index}] is not a supported mode, ADIF, Cabrillo, and report combination")
    for direction in ("sentFields", "receivedFields"):
        ids = [field["id"] for field in exchange[direction]]
        if len(ids) != len(set(ids)):
            result.append(f"runtime.entry.exchange.{direction} field IDs must be unique")

    serial = entry["serial"]
    serial_fields = [field for field in exchange["sentFields"] if "serialNumber" in field["acceptedKinds"]]
    resolved = entry.get("stationResolvedSerial")
    station_fields = entry.get("stationFields", [])
    if resolved:
        allocated = sent.get(resolved["allocatedSerialFieldID"])
        location = sent.get(resolved["locationFieldID"])
        coherent = serial == {"requirement": "none", "allowedScopes": []} and len(serial_fields) == 1 and \
            allocated is not None and allocated["acceptedKinds"] == ["serialNumber"] and not allocated["required"] and \
            location is not None and location["acceptedKinds"] == ["subdivision"] and not location["required"] and \
            len(station_fields) == 1 and station_fields[0] == {"id": "section", "label": "Cabrillo section", "role": "cabrilloLocation", "required": True, "maximumUTF8Bytes": 3}
        if not coherent:
            result.append("runtime.entry.stationResolvedSerial is inconsistent with the finite station-resolved serial contract")
    elif serial["requirement"] == "none":
        if serial["allowedScopes"] or serial_fields:
            result.append("runtime.entry.serial none cannot declare scopes or serial fields")
    elif not serial["allowedScopes"] or len(serial_fields) != 1 or serial_fields[0]["acceptedKinds"] != ["serialNumber"] or not serial_fields[0]["required"] or station_fields:
        result.append("runtime.entry required serial must have scopes and one required sent serial field")

    compatible = (entry["scorePolicy"], runtime["multiplierPolicy"]) in {
        ("pointsOnly", "none"), ("pointsTimesMultipliers", "uniqueCallsign")
    }
    if not compatible:
        result.append("runtime entry scorePolicy and multiplierPolicy are incompatible")
    for index, clause in enumerate(runtime["scoring"]["clauses"]):
        field = received.get(clause["fieldID"])
        if field is None or field["acceptedKinds"] != ["nonnegativeInteger"] or field["maximumUTF8Bytes"] > 18:
            result.append(f"runtime.scoring.clauses[{index}].fieldID must name a bounded received nonnegativeInteger")
    eligibility = runtime["eligibilityPolicy"]
    if isinstance(eligibility, dict):
        field = sent.get(eligibility["fieldID"])
        if field is None or field["acceptedKinds"] != ["nonnegativeInteger"] or field["maximumUTF8Bytes"] > 18:
            result.append("runtime.eligibilityPolicy.fieldID must name a bounded sent nonnegativeInteger")

    projection = runtime.get("exportProjection")
    if runtime["exportPolicy"] == "unsupported" and projection is not None:
        result.append("runtime exportPolicy unsupported cannot include exportProjection")
    elif runtime["exportPolicy"] == "operatorArchive" and projection is None:
        result.append("runtime exportPolicy operatorArchive requires exportProjection")
    elif projection is not None:
        if projection["formatterVersion"] not in {entry["cabrilloFormatterVersion"]} or projection["formatterVersion"] != entry["cabrilloProjectionFormatterVersion"]:
            result.append("runtime export formatter must match both entry formatter versions")
        source_keys = [_source_key(column["source"]) for column in projection["columns"]]
        if len(source_keys) != len(set(source_keys)):
            result.append("runtime export column sources must be unique")
        required_sources = {"frequencyKHz", "mode", "date", "time", "stationCallsign", "contactedCallsign"}
        if not required_sources.issubset(source_keys):
            result.append("runtime export columns are missing required QSO coordinates")
        if any(profile["report"]["format"] != "none" for profile in profiles) and not {"sentReport", "receivedReport"}.issubset(source_keys):
            result.append("runtime export columns must include both reports")
        required_fields = {f"sentField:{field['id']}" for field in exchange["sentFields"] if field["required"]}
        required_fields |= {f"receivedField:{field['id']}" for field in exchange["receivedFields"] if field["required"]}
        if not required_fields.issubset(source_keys):
            result.append("runtime export columns must include every required exchange field")
        for key in source_keys:
            if key.startswith("sentField:") and key.split(":", 1)[1] not in sent:
                result.append(f"runtime export column references unknown {key}")
            if key.startswith("receivedField:") and key.split(":", 1)[1] not in received:
                result.append(f"runtime export column references unknown {key}")

    required_sent = {field["id"] for field in exchange["sentFields"] if field["required"]}
    required_received = {field["id"] for field in exchange["receivedFields"] if field["required"]}
    for scenario_index, scenario in enumerate(definition["goldenScenarios"]):
        if len(scenario["qsos"]) != len(scenario["expected"]["dispositions"]) or len(scenario["qsos"]) != len(scenario["expected"]["points"]):
            result.append(f"goldenScenarios[{scenario_index}] expected arrays must match QSO count")
        for qso_index, qso in enumerate(scenario["qsos"]):
            if qso["mode"] not in runtime["supportedModes"] or qso["band"] not in runtime["supportedBands"]:
                result.append(f"goldenScenarios[{scenario_index}].qsos[{qso_index}] uses an unsupported mode or band")
            if not required_sent.issubset(qso["sentFields"]):
                result.append(f"goldenScenarios[{scenario_index}].qsos[{qso_index}] omits required sent fields")
            if not required_received.issubset(qso["receivedFields"]):
                result.append(f"goldenScenarios[{scenario_index}].qsos[{qso_index}] omits required received fields")
            unknown_sent = set(qso["sentFields"]) - set(sent)
            unknown_received = set(qso["receivedFields"]) - set(received)
            if unknown_sent or unknown_received:
                result.append(f"goldenScenarios[{scenario_index}].qsos[{qso_index}] has unknown exchange fields")
    return result


def diagnostics(definition: Any) -> list[str]:
    if not isinstance(definition, dict):
        return ["$ must be object"]
    version = definition.get("definitionSchemaVersion")
    if version == "1.0.0":
        return legacy_diagnostics(definition)
    root = _schema()
    definition_schema = root["$defs"].get("runtimeV2" if version == "2.0.0" else "")
    if definition_schema is None:
        return ["unsupported definitionSchemaVersion"]
    result = schema_diagnostics(definition, definition_schema, root)
    identity = definition.get("identity")
    if isinstance(identity, dict) and set(("contentDigest",)).issubset(identity):
        if identity["contentDigest"] != expected_digest(definition):
            result.append("identity.contentDigest does not match canonical definition bytes")
    if result:
        return result
    return v2_semantic_diagnostics(definition)


def runtime_draft(definition: dict[str, Any]) -> dict[str, Any]:
    failures = diagnostics(definition)
    if failures:
        raise ValueError("\n".join(failures))
    if definition["definitionSchemaVersion"] != "2.0.0":
        raise ValueError("only definitionSchemaVersion 2.0.0 translates to a runtime draft")
    runtime = copy.deepcopy(definition["runtime"])
    eligibility = runtime["eligibilityPolicy"]
    runtime["eligibilityPolicy"] = {"unrestricted": {}} if eligibility == "unrestricted" else {
        "stationFieldIntegerGreaterThan": {"fieldID": eligibility["fieldID"], "threshold": eligibility["threshold"]}
    }
    projection = runtime.get("exportProjection")
    if projection:
        for column in projection["columns"]:
            source = column["source"]
            column["source"] = {source: {}} if isinstance(source, str) else {source["kind"]: {"_0": source["fieldID"]}}
    identity = definition["identity"]
    return {"id": identity["id"], "version": identity["version"], "edition": identity["edition"], **runtime}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("definition", type=Path)
    parser.add_argument("--write-digest", action="store_true")
    parser.add_argument("--emit-runtime-draft", type=Path)
    args = parser.parse_args()
    try:
        definition = load_json(args.definition)
    except (json.JSONDecodeError, ValueError) as cause:
        raise SystemExit(str(cause)) from cause
    if not isinstance(definition, dict):
        raise SystemExit("definition must be a JSON object")
    if args.write_digest:
        definition.setdefault("identity", {})["contentDigest"] = expected_digest(definition)
        args.definition.write_text(json.dumps(definition, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    failures = diagnostics(definition)
    if failures:
        raise SystemExit("\n".join(failures))
    if args.emit_runtime_draft:
        translated = runtime_draft(definition)
        args.emit_runtime_draft.write_text(json.dumps(translated, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"valid": True, "identity": definition["identity"], "runtimeDraftEmitted": bool(args.emit_runtime_draft)}, sort_keys=True))


if __name__ == "__main__":
    main()
