"""Production execution of the pinned Sweepstakes plugin, including its parser."""
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Host
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures
import test_wpx_host as wpx_fixtures

uid = fixtures.uid


class SweepstakesHostTests(unittest.TestCase):
    call = fixtures.HostTests.call
    mutate = fixtures.HostTests.mutate
    read = fixtures.HostTests.read
    log = fixtures.HostTests.log
    tearDown = fixtures.HostTests.tearDown
    fields = wpx_fixtures.WPXHostTests.fields

    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve() / "host"
        self.host = Host(self.root)
        self.session, self.workspace, self.revision = uid(), uid(), 0
        self.create = {"sessionID": self.session, "workspaceGeneration": self.workspace,
                       "operationID": uid(), "expectedRevision": 0,
                       "pluginID": "arrl_ss_cw", "station": {"Call": "OM0RX", "GridSquare": "JN88"},
                       "frequencyHz": 14025000, "settings": {"SentExchange": "A OM0RX 67 CT"},
                       "reference": {"id": "test-cty-v1", "countries": deepcopy(fixtures.CTY)}}
        self.call("session_create", self.create)

    def test_catalog_source_layout_and_original_parser_results(self):
        catalog = self.host.dispatch({"id": uid(), "method": "catalog", "params": {}})
        self.assertIn("arrl_ss_cw", [item["id"] for item in catalog["plugins"]])
        plugin = load_plugin("arrl_ss_cw")
        self.assertEqual(plugin.__file__, str(VENDOR / "not1mm/plugins/arrl_ss_cw.py"))
        manifest = json.loads((VENDOR.parent / "source-manifest.json").read_text())
        self.assertEqual(sha256(Path(plugin.__file__).read_bytes()).hexdigest(),
                         manifest["sha256"]["not1mm/plugins/arrl_ss_cw.py"])
        projection = self.read("projection")["projection"]
        self.assertEqual(projection["tabNext"]["receive"], "other_1")
        self.assertEqual(projection["tabPrevious"]["callsign"], "other_2")
        self.assertEqual(projection["nextField"], "other_2")
        fields = {field["id"]: field for field in projection["fields"]}
        self.assertEqual((fields["other_1"]["label"], fields["other_1"]["value"]), ("SentNR", "001"))
        self.assertTrue(all(field["visible"] for field in fields.values()))
        for minute, exchange in enumerate(("123 A K1ABC 67 CT", "123A K1ABC 67CT")):
            qso = self.log("DL1ABC", exchange, minute)
            row = next(row for row in self.read("log")["rows"] if row["ID"] == qso)
            self.assertEqual((row["NR"], row["Prec"], row["CK"], row["Sect"], row["Call"]),
                             (123, "A", 67, "CT", "K1ABC"))
            self.assertEqual((row["CountryPrefix"], row["Continent"], row["WPXPrefix"]), ("K", "NA", "K1"))
        # The original parser also permits incomplete typing and incomplete
        # heard exchanges; the adapter must not impose a new SS rule engine.
        self.mutate("draft_apply", fields={"callsign": "K", "other_2": "12A"})
        self.assertEqual(self.fields()["other_2"], "12A")
        view = self.read("projection")["projection"]
        self.assertIn("sn:12 p:A cl:K ck: sec:", view["fields"][-1]["label"])
        qso = self.log("K", "124A K1ABC 67CT", 2)
        self.assertEqual(next(row for row in self.read("log")["rows"] if row["ID"] == qso)["Call"], "K1ABC")

    def test_contest_wide_duplicate_sections_score_and_original_cabrillo(self):
        first = self.log(zone="123A 67CT")
        self.log("DL1ABC", "456 B 72 EMA", 1)
        self.mutate("draft_apply", frequencyHz=7025000,
                    fields={"callsign": "OM1ABC", "other_2": "789 Q K1ABC 80CT"})
        self.assertTrue(self.read("projection")["projection"]["dupe"])
        duplicate = self.log("OM1ABC", "789 Q K1ABC 80CT", 2, 7025000)
        rows = {row["ID"]: row for row in self.read("log")["rows"]}
        self.assertEqual((rows[first]["Points"], rows[duplicate]["Points"]), (2, 0))
        score = self.read("score")["score"]
        self.assertEqual((score["qsos"], score["points"], score["sections"], score["total"]), (3, 4, 2, 8))
        export = self.read("export")["content"]
        self.assertIn("CONTEST: ARRL-SS-CW\r\n", export)
        self.assertIn("CLAIMED-SCORE: 8\r\n", export)
        lines = [line.split() for line in export.splitlines() if line.startswith("QSO:")]
        self.assertEqual(lines[0], ["QSO:", "14025", "CW", "2026-10-19", "0800", "OM0RX",
                                    "0001", "A", "67", "CT", "K1ABC", "0123", "A", "67", "CT"])
        self.assertEqual(lines[-1][1], "7025")
        self.assertTrue(export.endswith("END-OF-LOG:\r\n"))

    def test_plugin_run_and_sandp_esm_replay_and_serial_reopen(self):
        self.mutate("draft_apply", fields={"callsign": "K1ABC", "other_2": ""})
        self.assertEqual([action["key"] for action in self.mutate("esm", field="callsign")["actions"]], ["F5"])
        self.assertEqual([action["key"] for action in self.mutate("esm", field="other_2")["actions"]], ["F9"])
        params = {"sessionID": self.session, "operationID": uid(), "expectedRevision": self.revision,
                  "field": "other_2", "fields": {"other_2": "123A 67CT"}}
        result = self.call("esm", params)
        action = result["actions"][0]
        self.assertEqual((action["key"], action["template"], action["sentSerial"], action["sentExchange"]),
                         ("F3", "{CALL} {SENTNR} {EXCHANGE}", "001", "A OM0RX 67 CT"))
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.call("esm", params)["actions"], [])
        self.assertEqual(self.read("log")["total"], 1)
        self.assertEqual(self.read("cw_context")["sentSerial"], "002")
        self.assertEqual(self.read("cw_context")["sentExchange"], "A OM0RX 67 CT")
        self.mutate("run_state", run=True)
        self.mutate("draft_apply", fields={"callsign": "DL1ABC", "other_2": "456B 72EMA"})
        self.assertEqual([action["key"] for action in self.mutate("esm", field="callsign")["actions"]], ["F2", "F3"])
        self.assertEqual([action["key"] for action in self.mutate("esm", field="other_2")["actions"]], ["F4"])
        self.assertEqual(self.fields()["other_1"], "003")
        self.assertEqual(self.read("score")["score"]["total"], 8)

    def test_corrections_deletes_rescore_without_reusing_issued_serials(self):
        first = self.log(zone="100A 67CT")
        second = self.log(zone="200A 67CT", minute=1, frequency=7025000)
        third = self.log("DL1ABC", "300B 72EMA", 2)
        self.assertEqual(self.read("score")["score"]["total"], 8)
        self.mutate("qso_correct", qsoID=first, fields={"other_1": "50", "other_2": "101 Q OM1ABC 80 WMA"})
        self.assertEqual(self.read("score")["score"]["total"], 18)
        self.mutate("qso_correct", qsoID=first, fields={"other_2": "100A K1ABC 67CT"})
        self.assertEqual(self.read("score")["score"]["total"], 8)
        self.mutate("qso_delete", qsoID=first)
        rows = {row["ID"]: row for row in self.read("log")["rows"]}
        self.assertEqual((rows[second]["Points"], rows[second]["IsMultiplier1"]), (2, 1))
        self.assertEqual(self.read("score")["score"]["total"], 8)
        self.mutate("qso_delete", qsoID=third)
        self.assertEqual(self.read("score")["score"]["total"], 2)
        self.assertEqual(self.fields()["other_1"], "004")
        store = self.host.database(self.session)
        ledger = store.exec_sql_mult("SELECT serial FROM xlog_serial ORDER BY serial")
        self.assertEqual([row["serial"] for row in ledger], [1, 2, 3, 4])
        audit = store.exec_sql("SELECT before_json FROM xlog_qso_audit WHERE qso_id=? AND kind='correct' LIMIT 1", (first,))
        self.assertEqual(json.loads(audit["before_json"])["SentNr"], 1)

    # Crash on both sides of Store.finish exercises the same real serial/receipt
    # transaction with SS exchanges (which upstream deliberately accepts partial).
    test_process_death_preserves_serial = wpx_fixtures.WPXHostTests.test_process_death_on_both_sides_of_commit_preserves_serial


if __name__ == "__main__":
    unittest.main()
