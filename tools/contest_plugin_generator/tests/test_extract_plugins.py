from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))

import extract_plugins  # noqa: E402
import render_swift_metadata  # noqa: E402
import validate_definition  # noqa: E402

REPOSITORY = Path(__file__).resolve().parents[3]
UPSTREAM = Path(os.environ.get("CONTEST_SW_ROOT", "/Users/oliver/Documents/Projects/contest-sw"))
LEDGER = REPOSITORY / "docs/contesting/contest-acceptance-ledger.json"


class ExtractorUnitTests(unittest.TestCase):
    def write_plugin(self, root: Path, source: str, name: str = "fixture.py") -> tuple[Path, Path]:
        plugin_root = root / "not1mm" / "plugins"
        plugin_root.mkdir(parents=True)
        path = plugin_root / name
        path.write_text(source, encoding="utf-8")
        return path, plugin_root

    def test_literal_metadata_ui_mapping_and_provenance(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            path, plugin_root = self.write_plugin(Path(raw), '''
name = "Fixture"
cabrillo_name = "FIXTURE"
mode = "CW"
columns = ["Call", "PTS"]
dupe_type = 1
EXCHANGE_HINT = "Name"
def interface(self):
    self.field3.show()
    self.other_label.setText("Name")
def set_tab_next(self):
    self.tab_next = {self.callsign: self.other_1, self.other_1: self.callsign}
def set_tab_prev(self):
    self.tab_prev = {self.callsign: self.other_1, self.other_1: self.callsign}
def set_contact_vars(self):
    self.contact["Name"] = self.other_1.text().upper()
def points(self):
    return 1
''')
            record = extract_plugins.plugin_record(path, plugin_root)
            self.assertEqual(record["coverageDisposition"], "automatic")
            self.assertEqual(record["ui"]["fieldLabels"][0]["field"], "field3")
            self.assertEqual(record["ui"]["contactMappings"][0]["contactField"], "Name")
            self.assertIn("astSha256", record["behavior"]["functions"][0]["provenance"])

    def test_dynamic_and_branching_labels_are_not_promoted(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            path, plugin_root = self.write_plugin(Path(raw), '''
name = "Fixture"
cabrillo_name = "FIXTURE"
mode = "CW"
columns = ["Call"]
dupe_type = 1
def interface(self):
    if self.pref:
        self.other_label.setText(self.pref["label"])
def set_tab_next(self):
    self.tab_next = {self.callsign: self.other_1}
def set_tab_prev(self):
    self.tab_prev = {self.other_1: self.callsign}
''')
            record = extract_plugins.plugin_record(path, plugin_root)
            self.assertEqual(record["coverageDisposition"], "needs-adapter")
            self.assertEqual(record["ui"]["unresolved"][0]["reason"], "dynamic UI text")
            self.assertTrue(record["ui"]["unresolved"][0]["branchDependent"])

    def test_missing_and_dynamic_required_metadata_remain_explicit(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            path, plugin_root = self.write_plugin(Path(raw), 'name = make_name()\nmode = "CW"\n')
            record = extract_plugins.plugin_record(path, plugin_root)
            self.assertEqual(record["coverageDisposition"], "unknown")
            self.assertEqual(record["declarations"]["name"]["status"], "unresolved")
            self.assertEqual(record["declarations"]["cabrillo_name"]["status"], "missing")

    def test_later_conditional_reassignment_and_mutation_are_unresolved(self) -> None:
        mutations = [
            'if choose_phone:\n    mode = "SSB"',
            'columns.append("PTS")',
            'columns += ["PTS"]',
            'columns[0] = "Other"',
            'del columns[0]',
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as raw:
                path, plugin_root = self.write_plugin(Path(raw), f'''
name = "Fixture"
cabrillo_name = "FIXTURE"
mode = "CW"
columns = ["Call"]
dupe_type = 1
{mutation}
''')
                record = extract_plugins.plugin_record(path, plugin_root)
                changed = "mode" if "mode =" in mutation else "columns"
                self.assertEqual(record["declarations"][changed]["status"], "unresolved")
                self.assertEqual(record["coverageDisposition"], "manual")

    def test_malformed_source_is_manual_not_executed(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            path, plugin_root = self.write_plugin(Path(raw), "def broken(:\n")
            record = extract_plugins.plugin_record(path, plugin_root)
            self.assertEqual(record["coverageDisposition"], "manual")

    def test_ast_parse_never_imports_or_runs_top_level_side_effects(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            sentinel = root / "must-not-exist"
            source = f'''\nfrom definitely_missing_package import explode\nPath({str(sentinel)!r}).write_text("bad")\nraise RuntimeError("must not run")\nname = "Safe"\ncabrillo_name = "SAFE"\nmode = "CW"\ncolumns = []\ndupe_type = 4\n'''
            path, plugin_root = self.write_plugin(root, source)
            record = extract_plugins.plugin_record(path, plugin_root)
            self.assertFalse(sentinel.exists())
            self.assertEqual(record["declarations"]["name"]["value"], "Safe")

    def make_minimal_git_corpus(self, root: Path) -> tuple[Path, Path, str]:
        plugin_root = root / "not1mm" / "plugins"
        plugin_root.mkdir(parents=True)
        initializer = plugin_root / "__init__.py"
        initializer.write_bytes(b"")
        plugin = plugin_root / "fixture.py"
        plugin.write_text('name="Fixture"\ncabrillo_name="FIX"\nmode="CW"\ncolumns=[]\ndupe_type=1\n', encoding="utf-8")
        subprocess.run(["git", "init", "-q"], cwd=root, check=True)
        subprocess.run(["git", "config", "user.email", "fixture@example.invalid"], cwd=root, check=True)
        subprocess.run(["git", "config", "user.name", "Fixture"], cwd=root, check=True)
        subprocess.run(["git", "add", "not1mm"], cwd=root, check=True)
        subprocess.run(["git", "commit", "-qm", "fixture"], cwd=root, check=True)
        pin = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, check=True, capture_output=True, text=True).stdout.strip()
        ledger = {
            "upstream": {
                "repository": "fixture/corpus", "commit": pin, "pluginRoot": "not1mm/plugins",
                "pluginPythonFileCount": 2, "contestPluginCount": 1,
                "excluded": [{"path": "not1mm/plugins/__init__.py", "sha256": extract_plugins.digest(b""), "reason": "initializer"}],
            },
            "plugins": [{
                "pluginID": "fixture",
                "source": {"path": "not1mm/plugins/fixture.py", "sha256": extract_plugins.digest(plugin.read_bytes())},
                "xlogAcceptance": {"implementationStatus": "pending"},
            }],
        }
        ledger_path = root / "ledger.json"
        ledger_path.write_text(json.dumps(ledger), encoding="utf-8")
        return ledger_path, plugin, pin

    def test_dirty_included_source_at_same_git_head_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            ledger, plugin, pin = self.make_minimal_git_corpus(root)
            plugin.write_text(plugin.read_text() + "# dirty bytes\n", encoding="utf-8")
            with self.assertRaisesRegex(SystemExit, "source hash mismatch for fixture"):
                extract_plugins.build_inventory(root, ledger, pin)

    def test_dirty_excluded_source_at_same_git_head_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            ledger, _, pin = self.make_minimal_git_corpus(root)
            (root / "not1mm/plugins/__init__.py").write_text("# dirty initializer\n", encoding="utf-8")
            with self.assertRaisesRegex(SystemExit, "excluded source hash mismatch"):
                extract_plugins.build_inventory(root, ledger, pin)


class SwiftRendererTests(unittest.TestCase):
    def test_swift_string_escapes_controls_and_interpolation_like_text(self) -> None:
        value = 'quote" backslash\\ interpolation \\(name) line\nback\bform\funit\x01 snowman ☃'
        self.assertEqual(
            render_swift_metadata.swift_string(value),
            '"quote\\" backslash\\\\ interpolation \\\\(name) line\\nback\\u{8}form\\u{C}unit\\u{1} snowman ☃"',
        )

    def test_wrong_resolved_types_become_explicit_unresolved_markers(self) -> None:
        def field(value):
            return {"status": "resolved", "value": value}

        inventory = {
            "upstream": {"commit": "a" * 40},
            "plugins": [{
                "pluginID": "fixture", "source": {"sha256": "b" * 64},
                "declarations": {
                    "name": field('Name "quoted" \\(look)'),
                    "cabrillo_name": field(10),
                    "mode": field(True),
                    "dupe_type": field(True),
                    "columns": field(["Call", 2]),
                    "EXCHANGE_HINT": field(["wrong"]),
                },
            }],
        }
        rendered = render_swift_metadata.render(inventory)
        self.assertIn('.resolved("Name \\"quoted\\" \\\\(look)")', rendered)
        self.assertEqual(rendered.count("resolved value has incompatible type"), 5)
        self.assertNotIn(".resolved(True)", rendered)


@unittest.skipUnless(UPSTREAM.exists(), "pinned contest-sw checkout is unavailable")
class PinnedCorpusTests(unittest.TestCase):
    def test_all_94_reconcile_and_repeat_deterministically(self) -> None:
        first = extract_plugins.build_inventory(UPSTREAM, LEDGER, extract_plugins.REQUIRED_PIN)
        second = extract_plugins.build_inventory(UPSTREAM, LEDGER, extract_plugins.REQUIRED_PIN)
        self.assertEqual(first, second)
        self.assertEqual(len(first["plugins"]), 94)
        self.assertTrue(first["ledgerReconciliation"]["pluginIDsExact"])
        self.assertEqual(first["ledgerReconciliation"]["activePreviewCount"], 16)
        self.assertEqual(first["coverage"]["dispositions"], {
            "automatic": 94, "needs-adapter": 0, "manual": 0, "unknown": 0
        })

    def test_wrong_pin_is_rejected_before_extraction(self) -> None:
        with self.assertRaisesRegex(SystemExit, "pin mismatch"):
            extract_plugins.build_inventory(UPSTREAM, LEDGER, "0" * 40)

    def test_checked_in_inventory_and_swift_are_reproducible(self) -> None:
        inventory = extract_plugins.build_inventory(UPSTREAM, LEDGER, extract_plugins.REQUIRED_PIN)
        checked = json.loads((REPOSITORY / "docs/contesting/generated/python-plugin-inventory.json").read_text())
        self.assertEqual(
            json.dumps(inventory, ensure_ascii=False, sort_keys=True),
            json.dumps(checked, ensure_ascii=False, sort_keys=True),
        )
        swift = render_swift_metadata.render(inventory)
        self.assertEqual(swift, (REPOSITORY / "docs/contesting/generated/PythonContestDefinitions.generated.swift").read_text())


class AuthoredDefinitionTests(unittest.TestCase):
    def test_hand_authored_pilot_validates_without_extractor(self) -> None:
        path = REPOSITORY / "docs/contesting/generated/ten-ten-family.authored-definition.json"
        definition = json.loads(path.read_text())
        self.assertEqual(validate_definition.diagnostics(definition), [])
        self.assertEqual(definition["identity"]["contentDigest"], validate_definition.expected_digest(definition))

    def test_missing_and_ambiguous_definition_fields_are_rejected(self) -> None:
        definition = {"definitionSchemaVersion": "1.0.0"}
        result = validate_definition.diagnostics(definition)
        self.assertTrue(result and result[0].startswith("missing top-level fields"))

    def test_draft_validator_cannot_authorize_accepted_status(self) -> None:
        path = REPOSITORY / "docs/contesting/generated/ten-ten-family.authored-definition.json"
        definition = json.loads(path.read_text())
        definition["status"] = "accepted"
        definition["identity"]["contentDigest"] = validate_definition.expected_digest(definition)
        result = validate_definition.diagnostics(definition)
        self.assertIn("draft validator cannot authorize reviewed or accepted status", result)

    def test_malformed_nested_types_return_diagnostics_instead_of_crashing(self) -> None:
        path = REPOSITORY / "docs/contesting/generated/ten-ten-family.authored-definition.json"
        definition = json.loads(path.read_text())
        definition["policies"] = []
        result = validate_definition.diagnostics(definition)
        self.assertIn("policies must be an object", result)


if __name__ == "__main__":
    unittest.main()
