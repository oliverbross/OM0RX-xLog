import copy
import os
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
ROOT = TOOLS.parents[1]
UPSTREAM_ENV = os.environ.get("CONTEST_SW_ROOT")
sys.path.insert(0, str(TOOLS))

import convert_pinned_plugins  # noqa: E402
import validate_definition  # noqa: E402


class PinnedPluginConversionTests(unittest.TestCase):
    def setUp(self) -> None:
        if not UPSTREAM_ENV:
            self.fail("CONTEST_SW_ROOT is required for decisive pinned-source converter tests")
        self.upstream = Path(UPSTREAM_ENV)
        self.inventory = validate_definition.load_json(ROOT / "docs/contesting/generated/python-plugin-inventory.json")
        self.mappings = validate_definition.load_json(TOOLS / "reviewed_pinned_mappings.json")

    def test_reviewed_seven_translate_to_valid_v2_and_complete_coverage(self) -> None:
        outputs, coverage = convert_pinned_plugins.convert(self.inventory, self.mappings, self.upstream)
        self.assertEqual(set(outputs), {"10_10_fall_cw", "10_10_spring_cw", "10_10_summer_phone",
                                        "10_10_winter_phone", "cwo", "cwt", "icwc_mst"})
        self.assertEqual(coverage["summary"], {"inventoryPlugins": 94, "converted": 7, "mappingUnavailable": 87})
        self.assertEqual(len(coverage["plugins"]), 94)
        self.assertEqual(len({item["pluginID"] for item in coverage["plugins"]}), 94)
        for result in outputs.values():
            self.assertEqual(validate_definition.diagnostics(result["authoring"]), [])
            self.assertEqual(validate_definition.runtime_draft(result["authoring"]), result["runtime"])
            self.assertNotIn("operatorPolicy", result["runtime"])
        unsupported = [item for item in coverage["plugins"] if item["status"] == "converter-mapping-unavailable"]
        self.assertEqual(len(unsupported), 87)
        self.assertTrue(all(len(item["mappingReviewNeeded"]) == 3 for item in unsupported))
        ten_ten = next(item for item in coverage["plugins"] if item["pluginID"] == "10_10_winter_phone")
        self.assertFalse(ten_ten["converterSourceProvenance"]["includedInRuntimeSourceProvenance"])

    def test_source_hash_and_literal_declaration_guards_fail_closed(self) -> None:
        wrong_hash = copy.deepcopy(self.inventory)
        next(item for item in wrong_hash["plugins"] if item["pluginID"] == "cwt")["source"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "source guard failed for cwt"):
            convert_pinned_plugins.convert(wrong_hash, self.mappings, self.upstream)
        wrong_literal = copy.deepcopy(self.inventory)
        next(item for item in wrong_literal["plugins"] if item["pluginID"] == "cwt")["declarations"]["dupe_type"]["value"] = 1
        with self.assertRaisesRegex(ValueError, "literal declaration guard failed for cwt"):
            convert_pinned_plugins.convert(wrong_literal, self.mappings, self.upstream)

    def test_mapping_contract_rejects_unknown_keys_and_unreviewed_variants(self) -> None:
        unknown = copy.deepcopy(self.mappings)
        unknown["mappings"][0]["adapterID"] = "python"
        with self.assertRaisesRegex(ValueError, "unknown or missing keys"):
            convert_pinned_plugins.convert(self.inventory, unknown, self.upstream)
        unsupported = copy.deepcopy(self.mappings)
        unsupported["mappings"][0]["variant"] = "futureContest"
        with self.assertRaisesRegex(ValueError, "unsupported reviewed family/variant"):
            convert_pinned_plugins.convert(self.inventory, unsupported, self.upstream)

        malformed = copy.deepcopy(self.mappings)
        malformed["upstreamCommit"] = True
        with self.assertRaisesRegex(ValueError, "lowercase 40-hex"):
            convert_pinned_plugins.convert(self.inventory, malformed, self.upstream)

        duplicate = copy.deepcopy(self.mappings)
        duplicate["mappings"].append(copy.deepcopy(duplicate["mappings"][0]))
        with self.assertRaisesRegex(ValueError, "duplicate reviewed mapping"):
            convert_pinned_plugins.convert(self.inventory, duplicate, self.upstream)

        unsafe = copy.deepcopy(self.mappings)
        unsafe["mappings"][0]["pluginID"] = "../escape"
        with self.assertRaisesRegex(ValueError, "unsafe for an output filename"):
            convert_pinned_plugins.convert(self.inventory, unsafe, self.upstream)

    def test_duplicate_inventory_ids_and_actual_source_tampering_fail_closed(self) -> None:
        duplicate = copy.deepcopy(self.inventory)
        duplicate["plugins"].append(copy.deepcopy(duplicate["plugins"][0]))
        with self.assertRaisesRegex(ValueError, "duplicate pluginIDs"):
            convert_pinned_plugins.convert(duplicate, self.mappings, self.upstream)
        with tempfile.TemporaryDirectory() as directory:
            fake = Path(directory)
            for mapping in self.mappings["mappings"]:
                target = fake / mapping["sourcePath"]
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes((self.upstream / mapping["sourcePath"]).read_bytes())
            target = fake / self.mappings["mappings"][0]["sourcePath"]
            target.write_bytes(target.read_bytes() + b"\n# tampered\n")
            with mock.patch.object(convert_pinned_plugins.subprocess, "run") as run:
                run.return_value.returncode = 0
                run.return_value.stdout = self.mappings["upstreamCommit"] + "\n"
                with self.assertRaisesRegex(ValueError, "actual pinned source hash failed"):
                    convert_pinned_plugins.convert(self.inventory, self.mappings, fake)
        with mock.patch.object(convert_pinned_plugins.subprocess, "run") as run:
            run.return_value.returncode = 0
            run.return_value.stdout = "0" * 40 + "\n"
            with self.assertRaisesRegex(ValueError, "upstream revision does not match"):
                convert_pinned_plugins.convert(self.inventory, self.mappings, self.upstream)

    def test_checked_in_outputs_regenerate_byte_for_byte(self) -> None:
        outputs, coverage = convert_pinned_plugins.convert(self.inventory, self.mappings, self.upstream)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            generated, generated_coverage = root / "definitions", root / "coverage.json"
            convert_pinned_plugins.write_outputs(outputs, coverage, generated, generated_coverage)
            checked = ROOT / "Tests/XContestCoreTests/SourceFixtures/PinnedPluginDefinitions"
            self.assertEqual(sorted(path.name for path in generated.iterdir()), sorted(path.name for path in checked.iterdir()))
            for path in generated.iterdir():
                self.assertEqual(path.read_bytes(), (checked / path.name).read_bytes(), path.name)
            self.assertEqual(generated_coverage.read_bytes(),
                             (ROOT / "docs/contesting/pinned-plugin-conversion-coverage.json").read_bytes())
            archive = convert_pinned_plugins.archive_outputs(outputs)
            generated_authoring, generated_catalog = root / "archive-authoring", root / "catalog"
            convert_pinned_plugins.write_archive_outputs(archive, generated_authoring, generated_catalog)
            checked_authoring = ROOT / "Tests/XContestCoreTests/SourceFixtures/PackagedContestDefinitions"
            checked_catalog = ROOT / "Sources/XContestCore/Resources/ContestDefinitions"
            for generated_root, checked_root in ((generated_authoring, checked_authoring),
                                                  (generated_catalog, checked_catalog)):
                self.assertEqual(sorted(path.name for path in generated_root.iterdir()),
                                 sorted(path.name for path in checked_root.iterdir()))
                for path in generated_root.iterdir():
                    self.assertEqual(path.read_bytes(), (checked_root / path.name).read_bytes(), path.name)


if __name__ == "__main__":
    unittest.main()
