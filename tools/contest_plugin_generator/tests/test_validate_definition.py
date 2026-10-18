from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))

import validate_definition  # noqa: E402

REPOSITORY = Path(__file__).resolve().parents[3]
FIXTURES = REPOSITORY / "Tests" / "XContestCoreTests" / "SourceFixtures"


class DefinitionAuthoringBridgeTests(unittest.TestCase):
    def load(self, name: str) -> dict:
        return validate_definition.load_json(FIXTURES / name)

    def mutated(self, definition: dict, mutate) -> dict:
        value = copy.deepcopy(definition)
        mutate(value)
        value["identity"]["contentDigest"] = validate_definition.expected_digest(value)
        return value

    def test_historical_v1_digest_and_bytes_remain_valid(self) -> None:
        path = REPOSITORY / "docs" / "contesting" / "generated" / "ten-ten-family.authored-definition.json"
        value = validate_definition.load_json(path)
        self.assertEqual(value["identity"]["contentDigest"],
                         "sha256:b075fcf1737b76b5b08e822e3a345be16f6b965ccab74af54936a00ad5b64cc8")
        self.assertEqual(validate_definition.diagnostics(value), [])
        with self.assertRaisesRegex(ValueError, "only definitionSchemaVersion 2.0.0"):
            validate_definition.runtime_draft(value)

    def test_checked_v2_examples_translate_exactly_to_swift_drafts(self) -> None:
        pairs = [
            ("ten-ten-winter-phone.authoring-v2.json", "ten-ten-winter-phone.runtime-draft.json"),
            ("custom-two-band-sprint.authoring-v2.json", "custom-two-band-sprint.runtime-draft.json"),
        ]
        for authored, expected in pairs:
            with self.subTest(authored=authored):
                value = self.load(authored)
                self.assertEqual(validate_definition.diagnostics(value), [])
                self.assertEqual(validate_definition.runtime_draft(value), self.load(expected))
                self.assertTrue(value["constraints"]["acceptanceUnresolved"])

    def test_unknown_nested_keys_and_adapter_requests_are_rejected(self) -> None:
        source = self.load("custom-two-band-sprint.authoring-v2.json")
        unknown = self.mutated(source, lambda value: value["runtime"]["scoring"]["clauses"][0].update({"when": "future"}))
        self.assertIn("$.runtime.scoring.clauses[0].when is not allowed", validate_definition.diagnostics(unknown))
        adapter = self.mutated(source, lambda value: value["runtime"].update({"adapterID": "python:points"}))
        self.assertIn("$.runtime.adapterID is not allowed", validate_definition.diagnostics(adapter))

    def test_runtime_unresolved_modes_reports_and_scoring_fields_are_rejected(self) -> None:
        source = self.load("custom-two-band-sprint.authoring-v2.json")
        unresolved = self.mutated(source, lambda value: value["constraints"]["runtimeUnresolved"].append("point mapping"))
        self.assertIn("constraints.runtimeUnresolved must be empty before runtime translation",
                      validate_definition.diagnostics(unresolved))
        mode = self.mutated(source, lambda value: value["runtime"]["supportedModes"].append("SSB"))
        self.assertIn("runtime.supportedModes must exactly match entry.modeProfiles", validate_definition.diagnostics(mode))
        report = self.mutated(source, lambda value: value["runtime"]["entry"]["modeProfiles"][0]["report"].update({"defaultSent": "59"}))
        self.assertTrue(any("defaultSent is inconsistent with cwRST" in item for item in validate_definition.diagnostics(report)))
        mismatched = self.mutated(source, lambda value: (
            value["runtime"]["entry"].update({
                "adifMode": "SSB",
                "cabrilloQSOType": "PH",
                "report": {"format": "phoneRS", "defaultSent": "59", "defaultReceived": "59", "maximumUTF8Bytes": 2},
            }),
            value["runtime"]["entry"]["modeProfiles"][0].update({
                "adifMode": "SSB",
                "cabrilloQSOType": "PH",
                "report": {"format": "phoneRS", "defaultSent": "59", "defaultReceived": "59", "maximumUTF8Bytes": 2},
            }),
        ))
        self.assertTrue(any("not a supported mode, ADIF, Cabrillo, and report combination" in item
                            for item in validate_definition.diagnostics(mismatched)))
        unsupported_mode = self.mutated(source, lambda value: value["runtime"]["supportedModes"].append("FT8"))
        self.assertTrue(any("unsupported value 'FT8'" in item
                            for item in validate_definition.diagnostics(unsupported_mode)))
        unsupported_band = self.mutated(source, lambda value: value["runtime"]["supportedBands"].append("12m"))
        self.assertTrue(any("unsupported value '12m'" in item
                            for item in validate_definition.diagnostics(unsupported_band)))
        field = self.mutated(source, lambda value: value["runtime"]["scoring"]["clauses"][0].update({"fieldID": "missing"}))
        self.assertTrue(any("fieldID must name a bounded received nonnegativeInteger" in item for item in validate_definition.diagnostics(field)))

    def test_boolean_integer_and_nonfinite_json_are_rejected(self) -> None:
        source = self.load("custom-two-band-sprint.authoring-v2.json")
        boolean = self.mutated(source, lambda value: value["runtime"]["scoring"].update({"defaultPoints": True}))
        self.assertIn("$.runtime.scoring.defaultPoints must be integer", validate_definition.diagnostics(boolean))
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "nonfinite.json"
            path.write_text('{"value": NaN}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "nonfinite JSON number NaN"):
                validate_definition.load_json(path)
            duplicate = Path(folder) / "duplicate.json"
            duplicate.write_text('{"runtime":{"scoring":1,"scoring":2}}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "duplicate JSON object key 'scoring'"):
                validate_definition.load_json(duplicate)


if __name__ == "__main__":
    unittest.main()
