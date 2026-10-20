#!/usr/bin/env python3
"""Convert explicitly reviewed pinned plugin records to strict authored v2 drafts.

The inventory remains evidence, not executable input.  This converter accepts
only exact source hashes and literal declaration values listed in the reviewed
mapping file, then applies one of two finite mappings already represented by
the immutable Swift v1 factories.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any

import validate_definition

HERE = Path(__file__).resolve().parent
DEFAULT_INVENTORY = HERE.parent.parent / "docs/contesting/generated/python-plugin-inventory.json"
DEFAULT_MAPPINGS = HERE / "reviewed_pinned_mappings.json"
DEFAULT_OUTPUT = HERE.parent.parent / "Tests/XContestCoreTests/SourceFixtures/PinnedPluginDefinitions"
DEFAULT_ARCHIVE_AUTHORING_OUTPUT = HERE.parent.parent / "Tests/XContestCoreTests/SourceFixtures/PackagedContestDefinitions"
DEFAULT_RUNTIME_CATALOG_OUTPUT = HERE.parent.parent / "Sources/XContestCore/Resources/ContestDefinitions"
DEFAULT_COVERAGE = HERE.parent.parent / "docs/contesting/pinned-plugin-conversion-coverage.json"
SAFE_PLUGIN_ID = re.compile(r"[a-z0-9_]+", flags=re.ASCII)
SAFE_SOURCE_PATH = re.compile(r"not1mm/plugins/[a-z0-9_]+\.py", flags=re.ASCII)


def _report(format_: str) -> dict[str, Any]:
    values = {"none": ("", 0), "cwRST": ("599", 3), "phoneRS": ("59", 2)}
    default, bound = values[format_]
    return {"format": format_, "defaultSent": default, "defaultReceived": default,
            "maximumUTF8Bytes": bound}


def _field(id_: str, label: str, kinds: list[str], bound: int, adif: str | None = None) -> dict[str, Any]:
    value: dict[str, Any] = {"id": id_, "label": label, "acceptedKinds": kinds,
                             "maximumUTF8Bytes": bound, "required": True}
    if adif is not None:
        value["adifField"] = adif
    return value


def _exchange(sent: list[dict[str, Any]], received: list[dict[str, Any]]) -> dict[str, Any]:
    return {"sent": "structured", "received": "structured", "sentDefault": "stationFields",
            "adifFields": "exchangeStrings", "sentFields": sent, "receivedFields": received}


def _ten_ten_runtime(variant: str) -> dict[str, Any]:
    phone = variant in {"winterPhone", "summerPhone"}
    display = {"winterPhone": "10-10 Winter Phone QSO Party", "springCW": "10-10 Spring CW QSO Party",
               "summerPhone": "10-10 Summer Phone QSO Party", "fallCW": "10-10 Fall CW QSO Party"}[variant]
    report = _report("phoneRS" if phone else "cwRST")
    modes = ["SSB", "AM", "FM"] if phone else ["CW"]
    profiles = [{"mode": mode, "adifMode": mode, "cabrilloQSOType": "PH" if phone else "CW",
                 "report": copy.deepcopy(report)} for mode in modes]
    received = [_field("name", "Name", ["operatorName"], 32, "NAME"),
                _field("member-number", "10-10 Number (0 for non-member)", ["nonnegativeInteger"], 8),
                _field("qth", "QTH", ["locationText"], 32)]
    sent = copy.deepcopy(received)
    sent[0]["adifField"] = "MY_NAME"
    common = ("10-10 QSO Party Handbook https://www.ten-ten.org/qso-party-handbook/ SHA-256 "
              "5959521401da9a8758f55c83bed72a374e7e20341ced4180000378b906cf7b7b; October 2025 official newsletter "
              "https://www.ten-ten.org/wp-content/uploads/2025/01/2025n4-OnLine.pdf SHA-256 "
              "aaa5560aa58b831513b0b3efcf66403e17d2c79b7ebd348322d80f7552326d1f; retrieved 2026-10-18")
    provenance = common + (("; current rules https://www.ten-ten.org/qso-party-rules SHA-256 "
                            "54ccb256e0e42d2cf3edaf8d4f419e50f64beba425859bf899dfd766455dc091; 2026 schedule "
                            "https://www.ten-ten.org/qso-party-schedule/ SHA-256 "
                            "47b07443c4abc10c43de2ea0efcacec6dfd2d85176838c6e0ef96293ffbca2da") if phone else
                           "; CW variants are source-compatible definitions and are not asserted to be scheduled in 2026")
    return {"displayName": display, "cabrilloName": "10-10", "supportedBands": ["10m"],
            "supportedModes": modes,
            "entry": {"version": 2, "mode": profiles[0]["mode"], "adifMode": profiles[0]["adifMode"],
                      "cabrilloQSOType": profiles[0]["cabrilloQSOType"], "report": report,
                      "cabrilloFormatterVersion": "ten-ten-declarative-pilot-1",
                      "cabrilloProjectionFormatterVersion": "ten-ten-declarative-pilot-1",
                      "modeProfiles": profiles, "exchange": _exchange(sent, received),
                      "serial": {"requirement": "none", "allowedScopes": []}, "scorePolicy": "pointsOnly"},
            "sourceProvenance": provenance, "dupePolicy": "oncePerContest", "multiplierPolicy": "none",
            "scoring": {"defaultPoints": 1, "clauses": [{"fieldID": "member-number", "comparison": "greaterThan",
                                                           "threshold": 0, "points": 2}]},
            "eligibilityPolicy": "unrestricted", "exportPolicy": "unsupported", "stationEntityRequired": False}


def _cw_unique_runtime(variant: str) -> dict[str, Any]:
    details = {
        "cwt": ("cwops-cwt", "CWops Test (CWT) Preview", "CW-OPS", "https://cwops.org/cwops-tests/",
                "d98a97401dee2cf8106efb1756b78875ce900024715b3bebb19ef2919c646056",
                "12010bc2f8a4822e45444c996f82993aea952916405de8449a3ca6fe68c9de64",
                "inactive: event windows, categories, conditional exchange, reporting, export"),
        "cwOpen": ("cwops-open", "CW Open Preview", "CW-OPEN", "https://cwops.org/cwops-tests/cw-open/",
                   "b73265ece8bc6e6d6e874a108ddf7ec1e2808c3d9fbdffd3b7380cd30629685a",
                   "e162c7e11759cd97322e2d60257f05e47312d997751c2fb2db2b5751872b3a8e",
                   "inactive: sessions, categories, combined score, duplicate retention, export"),
        "icwcMST": ("icwc-mst", "ICWC Medium Speed Test Preview", "ICWC-MST",
                    "https://internationalcwcouncil.org/mst-contest/",
                    "c594f23f513853a42c0644fb8243e5d24700b7a381a2611bc2dd44b862fef289",
                    "4fcf5971b539a3f7634fea21a752d1a5915d8d11f08c14d0a608a62d57ffb8ca",
                    "inactive: event windows, categories, regional frequency limits, 7030 kHz QRP running constraint, export")}[variant]
    id_, display, cabrillo, url, official_sha, plugin_sha, inactive = details
    if variant == "cwt":
        sent = [_field("name", "Name", ["operatorName"], 32, "MY_NAME"),
                _field("member-or-location", "Member number, CWA, state, province, or DX prefix",
                       ["nonnegativeInteger", "locationText"], 32)]
        received = copy.deepcopy(sent); received[0]["adifField"] = "NAME"
        serial = {"requirement": "none", "allowedScopes": []}
    else:
        serial_sent = _field("serial", "Serial", ["serialNumber"], 8, "STX")
        name_sent = _field("name", "Name", ["operatorName"], 32, "MY_NAME")
        serial_received = _field("serial", "Serial", ["serialNumber"], 8, "SRX")
        name_received = _field("name", "Name", ["operatorName"], 32, "NAME")
        sent = [serial_sent, name_sent] if variant == "cwOpen" else [name_sent, serial_sent]
        received = [serial_received, name_received] if variant == "cwOpen" else [name_received, serial_received]
        serial = {"requirement": "requiredForCommit", "allowedScopes": ["session"]}
    report = _report("none")
    source_file = {"cwt": "cwt.py", "cwOpen": "cwo.py", "icwcMST": "icwc_mst.py"}[variant]
    provenance = f"Official {url} SHA-256 {official_sha}; pinned contest-sw 7c8b499 {source_file} SHA-256 {plugin_sha}; {inactive}"
    return {"displayName": display, "cabrilloName": cabrillo,
            "supportedBands": ["160m", "80m", "40m", "20m", "15m", "10m"], "supportedModes": ["CW"],
            "entry": {"version": 2, "mode": "CW", "adifMode": "CW", "cabrilloQSOType": "CW", "report": report,
                      "cabrilloFormatterVersion": "cw-unique-call-preview-1",
                      "cabrilloProjectionFormatterVersion": "cw-unique-call-preview-1",
                      "modeProfiles": [{"mode": "CW", "adifMode": "CW", "cabrilloQSOType": "CW", "report": copy.deepcopy(report)}],
                      "exchange": _exchange(sent, received), "serial": serial, "scorePolicy": "pointsTimesMultipliers"},
            "sourceProvenance": provenance, "dupePolicy": "perBand", "multiplierPolicy": "uniqueCallsign",
            "scoring": {"defaultPoints": 1, "clauses": []}, "eligibilityPolicy": "unrestricted",
            "exportPolicy": "unsupported", "stationEntityRequired": False, "_id": id_}


def _provenance(mapping: dict[str, Any], runtime: dict[str, Any]) -> list[dict[str, str]]:
    if mapping["family"] == "ten-ten":
        records = [
            {"kind": "official-rules", "locator": "https://www.ten-ten.org/qso-party-handbook/", "revision": "retrieved-2026-10-18", "sha256": "5959521401da9a8758f55c83bed72a374e7e20341ced4180000378b906cf7b7b"},
            {"kind": "official-rules", "locator": "https://www.ten-ten.org/wp-content/uploads/2025/01/2025n4-OnLine.pdf", "revision": "october-2025", "sha256": "aaa5560aa58b831513b0b3efcf66403e17d2c79b7ebd348322d80f7552326d1f"},
        ]
        if mapping["variant"] in {"winterPhone", "summerPhone"}:
            records += [
                {"kind": "official-rules", "locator": "https://www.ten-ten.org/qso-party-rules", "revision": "retrieved-2026-10-18", "sha256": "54ccb256e0e42d2cf3edaf8d4f419e50f64beba425859bf899dfd766455dc091"},
                {"kind": "official-rules", "locator": "https://www.ten-ten.org/qso-party-schedule/", "revision": "2026-retrieved-2026-10-18", "sha256": "47b07443c4abc10c43de2ea0efcacec6dfd2d85176838c6e0ef96293ffbca2da"},
            ]
        return records
    text = runtime["sourceProvenance"]
    official_url = text.split("Official ", 1)[1].split(" SHA-256 ", 1)[0]
    official_sha = text.split(" SHA-256 ", 1)[1].split(";", 1)[0]
    return [{"kind": "official-rules", "locator": official_url, "revision": "retrieved-2026-10-18", "sha256": official_sha},
            {"kind": "python-comparator", "locator": mapping["sourcePath"], "revision": "contest-sw-7c8b499", "sha256": mapping["sourceSHA256"]}]


def _column(source: str | dict[str, str], width: int, alignment: str = "left") -> dict[str, Any]:
    return {"source": source, "width": width, "alignment": alignment, "required": True}


def _archive_columns(mapping: dict[str, Any]) -> list[dict[str, Any]]:
    leading = [_column("frequencyKHz", 5, "right"), _column("mode", 2), _column("date", 10),
               _column("time", 4), _column("stationCallsign", 13)]
    contact = _column("contactedCallsign", 13)
    field = lambda direction, id_: {"kind": f"{direction}Field", "fieldID": id_}
    if mapping["family"] == "ten-ten":
        return leading + [_column("sentReport", 3), _column(field("sent", "name"), 10),
                          _column(field("sent", "member-number"), 8, "right"),
                          _column(field("sent", "qth"), 20), contact, _column("receivedReport", 3),
                          _column(field("received", "name"), 10),
                          _column(field("received", "member-number"), 8, "right"),
                          _column(field("received", "qth"), 20)]
    if mapping["variant"] == "cwt":
        return leading + [_column(field("sent", "name"), 10),
                          _column(field("sent", "member-or-location"), 20), contact,
                          _column(field("received", "name"), 10),
                          _column(field("received", "member-or-location"), 20)]
    order = ["serial", "name"] if mapping["variant"] == "cwOpen" else ["name", "serial"]
    width = {"serial": 4, "name": 10}
    alignment = {"serial": "right", "name": "left"}
    return leading + [_column(field("sent", item), width[item], alignment[item]) for item in order] + [contact] + \
        [_column(field("received", item), width[item], alignment[item]) for item in order]


def archive_outputs(outputs: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Promote only the seven reviewed compatibility drafts to the existing archive policy."""
    result: dict[str, dict[str, Any]] = {}
    for plugin_id, item in outputs.items():
        authored = copy.deepcopy(item["authoring"])
        mapping = item["mapping"]
        runtime = authored["runtime"]
        formatter = "ten-ten-archive-1" if mapping["family"] == "ten-ten" else "cw-unique-call-archive-1"
        authored["identity"]["version"] = "2.0.0-declarative-archive"
        if mapping["family"] == "ten-ten":
            runtime["displayName"] += " Operator Archive"
        else:
            runtime["displayName"] = runtime["displayName"].replace(" Preview", " Archive Preview")
        runtime["entry"]["cabrilloFormatterVersion"] = formatter
        runtime["entry"]["cabrilloProjectionFormatterVersion"] = formatter
        runtime["sourceProvenance"] += "; operator archive only, not sponsor submission"
        runtime["exportPolicy"] = "operatorArchive"
        runtime["exportProjection"] = {"formatterVersion": formatter, "purpose": "operatorArchive",
                                       "duplicateRecords": "retainAll", "columns": _archive_columns(mapping)}
        runtime["operatorPolicy"] = {
            "version": 1, "policy": "simulated-run-sp-v1", "output": "simulation-only",
            "signalProfiles": [{"mode": mode, "signal": "cw" if mode == "CW" else "phone"}
                               for mode in sorted(runtime["supportedModes"])],
        }
        authored["constraints"]["acceptanceUnresolved"] = [
            "Operator archive and simulation policy only; sponsor/category/schedule review and catalog activation remain unresolved."
        ]
        authored["identity"]["contentDigest"] = validate_definition.expected_digest(authored)
        failures = validate_definition.diagnostics(authored)
        if failures:
            raise ValueError(f"{plugin_id} archive: " + "; ".join(failures))
        result[plugin_id] = {"authoring": authored, "runtime": validate_definition.runtime_draft(authored),
                             "mapping": mapping}
    return result


def write_archive_outputs(outputs: dict[str, dict[str, Any]], authoring_output: Path,
                          catalog_output: Path, preserved_catalog: Path | None = None) -> None:
    authoring_output.mkdir(parents=True, exist_ok=True)
    catalog_output.mkdir(parents=True, exist_ok=True)
    entries = []
    for plugin_id, item in sorted(outputs.items()):
        authoring_output.joinpath(f"{plugin_id}.authoring-v2.json").write_bytes(_bytes(item["authoring"]))
        runtime_bytes = _bytes(item["runtime"])
        filename = f"{plugin_id}.runtime-draft.json"
        catalog_output.joinpath(filename).write_bytes(runtime_bytes)
        digest_draft = copy.deepcopy(item["runtime"])
        digest_draft["supportedBands"] = sorted(digest_draft["supportedBands"])
        digest_draft["supportedModes"] = sorted(digest_draft["supportedModes"])
        canonical = json.dumps(digest_draft, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
        revision = hashlib.sha256(canonical).hexdigest()
        entries.append({"file": filename, "sha256": hashlib.sha256(runtime_bytes).hexdigest(),
                        "identity": {"id": item["runtime"]["id"], "version": item["runtime"]["version"],
                                     "edition": item["runtime"]["edition"], "sourceRevision": revision}})
    generated_files = {entry["file"] for entry in entries}
    if preserved_catalog is not None:
        preserved_manifest = validate_definition.load_json(preserved_catalog / "manifest.json")
        if set(preserved_manifest) != {"schemaVersion", "definitions"} \
                or preserved_manifest["schemaVersion"] != 1 \
                or not isinstance(preserved_manifest["definitions"], list):
            raise ValueError("preserved runtime catalog manifest is malformed")
        for entry in preserved_manifest["definitions"]:
            filename = entry.get("file") if isinstance(entry, dict) else None
            if filename in generated_files:
                continue
            if not isinstance(filename, str) or Path(filename).name != filename \
                    or not filename.endswith(".runtime-draft.json"):
                raise ValueError("preserved runtime catalog manifest has an unsafe file")
            source = preserved_catalog / filename
            runtime_bytes = source.read_bytes()
            if hashlib.sha256(runtime_bytes).hexdigest() != entry.get("sha256"):
                raise ValueError(f"preserved runtime catalog hash mismatch for {filename}")
            if source != catalog_output / filename:
                catalog_output.joinpath(filename).write_bytes(runtime_bytes)
            entries.append(copy.deepcopy(entry))
    entries.sort(key=lambda entry: entry["file"])
    manifest = {"schemaVersion": 1, "definitions": entries}
    catalog_output.joinpath("manifest.json").write_bytes(_bytes(manifest))


def _validate_mapping_document(document: dict[str, Any]) -> None:
    if not isinstance(document, dict):
        raise ValueError("reviewed mapping document must be an object")
    if set(document) != {"mappingSchemaVersion", "upstreamCommit", "mappings"}:
        raise ValueError("reviewed mapping document has unknown or missing keys")
    if document["mappingSchemaVersion"] != "1.0.0" or not isinstance(document["mappings"], list):
        raise ValueError("unsupported reviewed mapping document")
    commit = document["upstreamCommit"]
    if not isinstance(commit, str) or len(commit) != 40 or any(character not in "0123456789abcdef" for character in commit):
        raise ValueError("reviewed mapping upstreamCommit must be a lowercase 40-hex Git commit")
    if not 1 <= len(document["mappings"]) <= 94:
        raise ValueError("reviewed mappings must contain 1...94 records")
    required = {"pluginID", "sourcePath", "sourceSHA256", "family", "variant", "expectedDeclarations", "goldenScenario"}
    declaration_keys = {"name", "mode", "cabrillo_name", "dupe_type", "EXCHANGE_HINT"}
    supported = {"ten-ten": {"winterPhone", "springCW", "summerPhone", "fallCW"},
                 "cw-unique-call": {"cwt", "cwOpen", "icwcMST"}}
    seen: set[str] = set()
    for mapping in document["mappings"]:
        if not isinstance(mapping, dict) or set(mapping) != required:
            raise ValueError("reviewed mapping record has unknown or missing keys")
        if not isinstance(mapping["pluginID"], str) or SAFE_PLUGIN_ID.fullmatch(mapping["pluginID"]) is None:
            raise ValueError("reviewed mapping pluginID is unsafe for an output filename")
        if not isinstance(mapping["sourcePath"], str) or SAFE_SOURCE_PATH.fullmatch(mapping["sourcePath"]) is None:
            raise ValueError(f"unsafe reviewed source path for {mapping['pluginID']}")
        if mapping["pluginID"] in seen:
            raise ValueError(f"duplicate reviewed mapping {mapping['pluginID']}")
        seen.add(mapping["pluginID"])
        if not isinstance(mapping["family"], str) or not isinstance(mapping["variant"], str):
            raise ValueError(f"reviewed family/variant must be strings for {mapping['pluginID']}")
        if mapping["family"] not in supported or mapping["variant"] not in supported[mapping["family"]]:
            raise ValueError(f"unsupported reviewed family/variant for {mapping['pluginID']}")
        declarations = mapping["expectedDeclarations"]
        if not isinstance(declarations, dict) or set(declarations) != declaration_keys:
            raise ValueError(f"reviewed declaration guard is incomplete for {mapping['pluginID']}")
        if (any(not isinstance(declarations[key], str) for key in declaration_keys - {"dupe_type"}) or
                not isinstance(declarations["dupe_type"], int) or isinstance(declarations["dupe_type"], bool)):
            raise ValueError(f"reviewed declaration guard has invalid types for {mapping['pluginID']}")
        if not isinstance(mapping["goldenScenario"], dict):
            raise ValueError(f"reviewed golden scenario must be an object for {mapping['pluginID']}")
        sha = mapping["sourceSHA256"]
        if not isinstance(sha, str) or len(sha) != 64 or any(character not in "0123456789abcdef" for character in sha):
            raise ValueError(f"invalid source SHA-256 for {mapping['pluginID']}")


def _verify_upstream(upstream: Path, mapping_document: dict[str, Any]) -> None:
    if not upstream.is_dir():
        raise ValueError(f"required pinned upstream is missing: {upstream}")
    result = subprocess.run(["git", "-C", str(upstream), "rev-parse", "HEAD"], check=False,
                            capture_output=True, text=True)
    if result.returncode != 0 or result.stdout.strip() != mapping_document["upstreamCommit"]:
        raise ValueError("upstream revision does not match reviewed mappings")
    root = upstream.resolve()
    for mapping in mapping_document["mappings"]:
        path = (root / mapping["sourcePath"]).resolve()
        if root not in path.parents or not path.is_file():
            raise ValueError(f"pinned source is missing or escapes upstream root for {mapping['pluginID']}")
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != mapping["sourceSHA256"]:
            raise ValueError(f"actual pinned source hash failed for {mapping['pluginID']}")


def convert(inventory: dict[str, Any], mapping_document: dict[str, Any], upstream: Path) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    _validate_mapping_document(mapping_document)
    _verify_upstream(upstream, mapping_document)
    if inventory["upstream"]["commit"] != mapping_document["upstreamCommit"]:
        raise ValueError("inventory upstream commit does not match reviewed mappings")
    inventory_ids = [item.get("pluginID") for item in inventory["plugins"]]
    if len(inventory_ids) != len(set(inventory_ids)):
        raise ValueError("inventory contains duplicate pluginIDs")
    if any(not isinstance(id_, str) or not 1 <= len(id_.encode()) <= 128 or
           any(ord(character) < 32 or ord(character) == 127 for character in id_) for id_ in inventory_ids):
        raise ValueError("inventory contains an invalid pluginID")
    plugins = {item["pluginID"]: item for item in inventory["plugins"]}
    outputs: dict[str, dict[str, Any]] = {}
    converted_ids: set[str] = set()
    for mapping in mapping_document["mappings"]:
        plugin = plugins.get(mapping["pluginID"])
        if plugin is None:
            raise ValueError(f"missing pinned plugin {mapping['pluginID']}")
        if (plugin["source"].get("path") != mapping["sourcePath"] or
                plugin["source"].get("sha256") != mapping["sourceSHA256"]):
            raise ValueError(f"source guard failed for {mapping['pluginID']}")
        actual = {key: plugin["declarations"].get(key, {}).get("value") for key in mapping["expectedDeclarations"]}
        if actual != mapping["expectedDeclarations"]:
            raise ValueError(f"literal declaration guard failed for {mapping['pluginID']}")
        runtime = _ten_ten_runtime(mapping["variant"]) if mapping["family"] == "ten-ten" else _cw_unique_runtime(mapping["variant"])
        runtime_id = runtime.pop("_id", f"ten-ten-{mapping['variant']}")
        identity = {"id": runtime_id,
                    "version": "1.0.0-declarative-pilot" if mapping["family"] == "ten-ten" else "1.0.0-declarative-preview",
                    "edition": ("2025-rules-2026-schedule" if mapping["variant"] in {"winterPhone", "summerPhone"}
                                else "2025-newsletter-unscheduled") if mapping["family"] == "ten-ten" else "official-rules-2026-10-18",
                    "contentDigest": "sha256:" + "0" * 64}
        authored = {"definitionSchemaVersion": "2.0.0", "identity": identity, "status": "source-derived-draft",
                    "provenance": _provenance(mapping, runtime), "runtime": runtime,
                    "constraints": {"runtimeUnresolved": [], "acceptanceUnresolved": [
                        "Historical compatibility draft only; sponsor/category/schedule review and catalog activation remain unresolved.",
                        "operatorPolicy is intentionally absent because the immutable v1 Swift factory has no operator policy."]},
                    "goldenScenarios": [copy.deepcopy(mapping["goldenScenario"])]}
        authored["identity"]["contentDigest"] = validate_definition.expected_digest(authored)
        failures = validate_definition.diagnostics(authored)
        if failures:
            raise ValueError(f"{mapping['pluginID']}: " + "; ".join(failures))
        outputs[mapping["pluginID"]] = {"authoring": authored, "runtime": validate_definition.runtime_draft(authored), "mapping": mapping}
        converted_ids.add(mapping["pluginID"])
    coverage_plugins = []
    for plugin in sorted(inventory["plugins"], key=lambda item: item["pluginID"]):
        if plugin["pluginID"] in converted_ids:
            result = outputs[plugin["pluginID"]]
            coverage_plugins.append({"pluginID": plugin["pluginID"], "status": "converted-historical-compatibility-draft",
                                     "definitionID": result["runtime"]["id"], "source": plugin["source"],
                                     "converterSourceProvenance": {"upstreamCommit": mapping_document["upstreamCommit"],
                                                                   "path": result["mapping"]["sourcePath"],
                                                                   "sha256": result["mapping"]["sourceSHA256"],
                                                                   "includedInRuntimeSourceProvenance": result["mapping"]["family"] != "ten-ten"},
                                     "limitations": ["Immutable v1 compatibility target; operatorPolicy is absent.",
                                                     "No sponsor approval, category completeness, schedule approval, or catalog activation is implied."]})
        else:
            coverage_plugins.append({"pluginID": plugin["pluginID"], "status": "converter-mapping-unavailable",
                                     "source": plugin["source"], "mappingReviewNeeded": [
                                         "For this converter, exchange fields do not yet have a reviewed finite mapping.",
                                         "For this converter, scoring, multiplier, and duplicate authority has not been reconciled to the selected XContestCore policies.",
                                         "For this converter, serial, export, schedule, category, and eligibility constraints still need runtime-completeness review."]})
    coverage = {"schemaVersion": "1.0.0", "inventoryUpstream": inventory["upstream"],
                "mappingSchemaVersion": mapping_document["mappingSchemaVersion"],
                "summary": {"inventoryPlugins": len(coverage_plugins), "converted": len(converted_ids),
                            "mappingUnavailable": len(coverage_plugins) - len(converted_ids)}, "plugins": coverage_plugins}
    return outputs, coverage


def _bytes(value: Any) -> bytes:
    return (json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n").encode()


def write_outputs(outputs: dict[str, dict[str, Any]], coverage: dict[str, Any], output: Path, coverage_path: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    for plugin_id, result in sorted(outputs.items()):
        output.joinpath(f"{plugin_id}.authoring-v2.json").write_bytes(_bytes(result["authoring"]))
        output.joinpath(f"{plugin_id}.runtime-draft.json").write_bytes(_bytes(result["runtime"]))
    coverage_path.write_bytes(_bytes(coverage))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inventory", type=Path, default=DEFAULT_INVENTORY)
    parser.add_argument("--mappings", type=Path, default=DEFAULT_MAPPINGS)
    parser.add_argument("--upstream", type=Path,
                        default=Path(os.environ["CONTEST_SW_ROOT"]) if "CONTEST_SW_ROOT" in os.environ else None,
                        required="CONTEST_SW_ROOT" not in os.environ)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--coverage", type=Path, default=DEFAULT_COVERAGE)
    parser.add_argument("--archive-authoring-output", type=Path, default=DEFAULT_ARCHIVE_AUTHORING_OUTPUT)
    parser.add_argument("--runtime-catalog-output", type=Path, default=DEFAULT_RUNTIME_CATALOG_OUTPUT)
    args = parser.parse_args()
    inventory = validate_definition.load_json(args.inventory)
    mappings = validate_definition.load_json(args.mappings)
    outputs, coverage = convert(inventory, mappings, args.upstream)
    write_outputs(outputs, coverage, args.output, args.coverage)
    write_archive_outputs(archive_outputs(outputs), args.archive_authoring_output, args.runtime_catalog_output,
                          args.runtime_catalog_output)
    print(json.dumps(coverage["summary"], sort_keys=True))


if __name__ == "__main__":
    main()
