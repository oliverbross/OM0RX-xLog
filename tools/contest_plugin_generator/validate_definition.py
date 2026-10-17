#!/opt/homebrew/bin/python3.14
"""Validate draft structure and digest; this is deliberately not an activation gate."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

ALLOWED_STATUS = {"draft", "source-derived-draft"}
POLICY_KINDS = {
    "dupe": {"once-per-contest", "per-band", "per-band-mode", "none"},
    "points": {"fixed", "bounded-clauses", "unsupported-adapter"},
    "multipliers": {"none", "unique-field", "entity-prefix", "country", "zone", "unsupported-adapter"},
    "serial": {"none", "sequential", "station-resolved", "unsupported-adapter"},
    "export": {"existing-cabrillo-adif", "existing-adif-only", "unsupported-adapter"},
}


def canonical_payload(definition: dict[str, Any]) -> bytes:
    value = json.loads(json.dumps(definition))
    value["identity"]["contentDigest"] = "sha256:" + "0" * 64
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()


def expected_digest(definition: dict[str, Any]) -> str:
    return "sha256:" + hashlib.sha256(canonical_payload(definition)).hexdigest()


def diagnostics(definition: dict[str, Any]) -> list[str]:
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
    if definition["status"] not in ALLOWED_STATUS:
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
    for name, allowed in POLICY_KINDS.items():
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("definition", type=Path)
    parser.add_argument("--write-digest", action="store_true")
    args = parser.parse_args()
    definition = json.loads(args.definition.read_text(encoding="utf-8"))
    if args.write_digest:
        definition.setdefault("identity", {})["contentDigest"] = expected_digest(definition)
        args.definition.write_text(json.dumps(definition, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    failures = diagnostics(definition)
    if failures:
        raise SystemExit("\n".join(failures))
    print(json.dumps({"valid": True, "identity": definition["identity"]}, sort_keys=True))


if __name__ == "__main__":
    main()
