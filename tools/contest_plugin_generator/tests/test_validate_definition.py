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
            ("sst-geographic-sample.authoring-v2.json", "sst-geographic-sample.runtime-draft.json"),
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

    def test_geographic_multiplier_contract_is_bounded_and_coherent(self) -> None:
        source = self.load("sst-geographic-sample.authoring-v2.json")
        self.assertEqual(validate_definition.diagnostics(source), [])
        authority = self.load("sst-geography-authority.json")
        authored_contacts = [(qso["band"], qso["callsign"], qso["receivedFields"]["name"],
                              qso["receivedFields"]["location"])
                             for qso in source["goldenScenarios"][0]["qsos"]]
        authority_contacts = [(qso["band"], qso["callsign"], qso["name"], qso["location"])
                              for qso in authority["officialSample"]["contacts"]]
        self.assertEqual(authored_contacts, authority_contacts)
        self.assertEqual(source["goldenScenarios"][0]["expected"]["totalPoints"],
                         authority["officialSample"]["expected"]["qsoPoints"])
        self.assertEqual(source["goldenScenarios"][0]["expected"]["multiplierCount"],
                         authority["officialSample"]["expected"]["totalMultipliers"])
        self.assertEqual(source["goldenScenarios"][0]["expected"]["claimedScore"],
                         authority["officialSample"]["expected"]["claimedScore"])
        missing = self.mutated(source, lambda value: value["runtime"].pop("geographicMultiplier"))
        self.assertIn("runtime entry scorePolicy, multiplierPolicy, and geographicMultiplier are incompatible",
                      validate_definition.diagnostics(missing))
        duplicate = self.mutated(source, lambda value: (
            value["runtime"]["geographicMultiplier"]["subdivisions"].append(
                copy.deepcopy(value["runtime"]["geographicMultiplier"]["subdivisions"][0])),
            value["runtime"]["geographicMultiplier"]["subdivisions"][-1].update({"authority": "other-authority"}),
        ))
        self.assertIn("runtime.geographicMultiplier subdivision entityADIF values must be unique",
                      validate_definition.diagnostics(duplicate))
        unknown = self.mutated(source, lambda value: value["runtime"]["geographicMultiplier"].update({"adapterID": "python:mults"}))
        self.assertIn("$.runtime.geographicMultiplier.adapterID is not allowed",
                      validate_definition.diagnostics(unknown))
        bad_authority = self.mutated(source, lambda value: value["runtime"]["geographicMultiplier"]["entityFallback"].update(
            {"authority": "dxcc|entity"}))
        self.assertTrue(any("entityFallback.authority does not match" in item
                            for item in validate_definition.diagnostics(bad_authority)))
        short_field = self.mutated(source, lambda value: value["runtime"]["entry"]["exchange"]["receivedFields"][1].update(
            {"maximumUTF8Bytes": 1}))
        self.assertIn("runtime.geographicMultiplier location values must fit the received field byte bound",
                      validate_definition.diagnostics(short_field))
        missing_reference = self.mutated(source, lambda value: value["goldenScenarios"][0].pop("referenceDataVersion"))
        self.assertTrue(any("referenceDataVersion must be trimmed and fit 1...160 UTF-8 bytes" in item
                            for item in validate_definition.diagnostics(missing_reference)))
        valid_unicode = self.mutated(source, lambda value: value["goldenScenarios"][0].update(
            {"referenceDataVersion": "é" * 80}))
        self.assertEqual(validate_definition.diagnostics(valid_unicode), [])
        oversized_unicode = self.mutated(source, lambda value: value["goldenScenarios"][0].update(
            {"referenceDataVersion": "é" * 81}))
        self.assertTrue(any("referenceDataVersion must be trimmed and fit 1...160 UTF-8 bytes" in item
                            for item in validate_definition.diagnostics(oversized_unicode)))
        invalid_golden = self.mutated(source, lambda value: value["goldenScenarios"][0]["expected"]["dispositions"].__setitem__(0, "invalid"))
        self.assertTrue(any("has unsupported value 'invalid'" in item
                            for item in validate_definition.diagnostics(invalid_golden)))
        missing_entity = self.mutated(source, lambda value: value["goldenScenarios"][0]["qsos"][0].pop("entity"))
        self.assertTrue(any("omits required geographic entity" in item
                            for item in validate_definition.diagnostics(missing_entity)))
        contradictory = self.mutated(source, lambda value: value["goldenScenarios"][0]["qsos"][0]["receivedFields"].update({"location": "DX"}))
        self.assertTrue(any("location contradicts geographic entity" in item
                            for item in validate_definition.diagnostics(contradictory)))

    def test_operator_policy_station_location_and_aliases_match_swift_contract(self) -> None:
        archive = validate_definition.load_json(
            FIXTURES / "PackagedContestDefinitions" / "cwt.authoring-v2.json")
        self.assertEqual(validate_definition.diagnostics(archive), [])
        self.assertIn("operatorPolicy", validate_definition.runtime_draft(archive))
        wrong_signal = self.mutated(
            archive, lambda value: value["runtime"]["operatorPolicy"]["signalProfiles"][0].update(
                {"signal": "phone"}))
        self.assertIn("runtime.operatorPolicy contains an unsupported mode or signal mapping",
                      validate_definition.diagnostics(wrong_signal))

        geographic = self.load("sst-geographic-sample.authoring-v2.json")
        valid = self.mutated(geographic, lambda value: (
            value["runtime"]["geographicMultiplier"].update({"stationLocationFieldID": "location"}),
            value["runtime"].update({"stationEntityRequired": True}),
            value["runtime"]["geographicMultiplier"]["subdivisions"][0].update({"aliases": {"ZZ": "MA"}}),
        ))
        self.assertEqual(validate_definition.diagnostics(valid), [])
        unknown_target = self.mutated(valid, lambda value: value["runtime"]["geographicMultiplier"]
                                      ["subdivisions"][0]["aliases"].update({"XY": "XX"}))
        self.assertTrue(any("aliases targets an unknown value" in item
                            for item in validate_definition.diagnostics(unknown_target)))
        missing_station_entity = self.mutated(valid, lambda value: value["runtime"].update(
            {"stationEntityRequired": False}))
        self.assertIn("runtime.geographicMultiplier.stationLocationFieldID requires stationEntityRequired",
                      validate_definition.diagnostics(missing_station_entity))

    def test_adif_targets_are_unique_and_directional(self) -> None:
        source = self.load("custom-two-band-sprint.authoring-v2.json")
        sent_fields = source["runtime"]["entry"]["exchange"]["sentFields"]
        received_fields = source["runtime"]["entry"]["exchange"]["receivedFields"]
        wrong_sent = self.mutated(source, lambda value: value["runtime"]["entry"]["exchange"]
                                  ["sentFields"][0].update({"adifField": "NAME"}))
        self.assertIn("runtime.entry.exchange.sentFields contains a received-side ADIF target",
                      validate_definition.diagnostics(wrong_sent))
        wrong_received = self.mutated(source, lambda value: value["runtime"]["entry"]["exchange"]
                                      ["receivedFields"][0].update({"adifField": "MY_NAME"}))
        self.assertIn("runtime.entry.exchange.receivedFields contains a sent-side ADIF target",
                      validate_definition.diagnostics(wrong_received))
        if len(sent_fields) > 1:
            duplicate_sent = self.mutated(source, lambda value: value["runtime"]["entry"]["exchange"]
                                          ["sentFields"][1].update({"adifField": sent_fields[0]["adifField"]}))
            self.assertIn("runtime.entry.exchange.sentFields ADIF targets must be unique",
                          validate_definition.diagnostics(duplicate_sent))
        if len(received_fields) > 1:
            duplicate_received = self.mutated(source, lambda value: value["runtime"]["entry"]["exchange"]
                                              ["receivedFields"][1].update(
                                                  {"adifField": received_fields[0]["adifField"]}))
            self.assertIn("runtime.entry.exchange.receivedFields ADIF targets must be unique",
                          validate_definition.diagnostics(duplicate_received))


if __name__ == "__main__":
    unittest.main()
