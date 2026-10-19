"""Exercise the registered original WPX plugin through the production host."""
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Host, HostError
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures

CTY, uid = fixtures.CTY, fixtures.uid


class WPXHostTests(unittest.TestCase):
    call = fixtures.HostTests.call
    mutate = fixtures.HostTests.mutate
    read = fixtures.HostTests.read
    log = fixtures.HostTests.log
    tearDown = fixtures.HostTests.tearDown

    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve() / "host"
        self.host = Host(self.root)
        self.session, self.workspace, self.revision = uid(), uid(), 0
        self.create = {"sessionID": self.session, "workspaceGeneration": self.workspace,
                       "operationID": uid(), "expectedRevision": 0,
                       "pluginID": "cq_wpx_cw", "station": {"Call": "OM0RX", "GridSquare": "JN88"},
                       "frequencyHz": 14025000, "settings": {"SentExchange": "CONFIGURED"},
                       "reference": {"id": "test-cty-v1", "countries": deepcopy(CTY)}}
        self.call("session_create", self.create)

    def fields(self):
        return {field["id"]: field["value"] for field in self.read("projection")["projection"]["fields"]}

    def test_catalog_original_plugin_fields_focus_and_partial_validation(self):
        catalog = self.host.dispatch({"id": uid(), "method": "catalog", "params": {}})
        self.assertEqual([item["id"] for item in catalog["plugins"]], ["cq_ww_cw", "cq_wpx_cw", "arrl_ss_cw"])
        self.assertEqual(load_plugin("cq_wpx_cw").__file__, str(VENDOR / "not1mm/plugins/cq_wpx_cw.py"))
        view = self.read("session_open")["projection"]
        self.assertEqual(view["pluginID"], "cq_wpx_cw")
        self.assertEqual(view["tabNext"]["receive"], "other_1")
        self.assertEqual(view["nextField"], "other_2")
        fields = {field["id"]: field for field in view["fields"]}
        self.assertEqual((fields["other_1"]["label"], fields["other_2"]["label"]), ("SentNR", "RcvNR"))
        self.assertTrue(fields["other_1"]["visible"])
        self.assertEqual(fields["other_1"]["value"], "001")
        self.mutate("draft_apply", fields={"callsign": "K", "other_2": ""})
        self.assertEqual(self.fields()["callsign"], "K")
        self.mutate("focus", field="other_2")
        self.assertEqual(self.read("projection")["projection"]["focus"], "other_2")
        for received in ("", "ABC", "0", "-1", "9223372036854775808"):
            with self.assertRaises(HostError):
                self.mutate("qso_commit", fields={"callsign": "K1ABC", "other_2": received})
        self.assertEqual(self.read("log")["total"], 0)

    def test_two_contacts_duplicate_prefix_score_and_cabrillo(self):
        self.log(zone="123")
        self.log("DL1ABC", "456", 1)
        score = self.read("score")["score"]
        self.assertEqual((score["qsos"], score["points"], score["multipliers"], score["total"]), (2, 4, 2, 8))
        self.mutate("draft_apply", fields={"callsign": "K1ABC", "other_2": "789"})
        self.assertTrue(self.read("projection")["projection"]["dupe"])
        self.log(zone="789", minute=2)
        self.assertEqual(self.read("score")["score"]["total"], 8)
        contacts = list(reversed(self.read("log")["rows"]))
        self.assertEqual([(row["SentNr"], row["NR"], row["Points"]) for row in contacts], [(1, 123, 3), (2, 456, 1), (3, 789, 0)])
        content = self.read("export")["content"]
        self.assertIn("CONTEST: CQ-WPX-CW\r\n", content)
        self.assertIn("CLAIMED-SCORE: 8\r\n", content)
        lines = [line.split() for line in content.splitlines() if line.startswith("QSO:")]
        self.assertEqual([(line[1], line[7], line[10]) for line in lines], [("14025", "1", "123"), ("14025", "2", "456"), ("14025", "3", "789")])
        self.assertTrue(content.endswith("END-OF-LOG:\r\n"))

    def test_serial_replay_reopen_configured_exchange_and_correction_audit(self):
        self.mutate("draft_apply", fields={"callsign": "K1ABC", "other_2": "100"})
        intent = self.mutate("function_key", key="F3")["actions"][0]
        self.assertEqual((intent["template"], intent["sentSerial"], intent["sentExchange"]),
                         ("{RST} {SENTNR}", "001", "CONFIGURED"))
        sent_serial = next(field for field in self.read("projection")["projection"]["fields"]
                           if field["id"] == "other_1")
        self.assertTrue(sent_serial["readOnly"])
        with self.assertRaisesRegex(HostError, "reserved by the contest host") as changed:
            self.mutate("draft_apply", fields={"other_1": "002"})
        self.assertEqual(changed.exception.code, "serial_conflict")
        params = {"sessionID": self.session, "operationID": uid(), "expectedRevision": self.revision,
                  "qsoID": uid(), "timestamp": "2026-10-19 08:00:00"}
        saved = self.call("qso_commit", params)
        self.assertEqual(self.fields()["other_1"], "002")
        self.host.close()
        self.host = Host(self.root)
        self.assertTrue(self.call("qso_commit", params)["replayed"])
        self.assertEqual(self.fields()["other_1"], "002")
        self.assertEqual(self.call("session_create", self.create)["projection"]["pluginID"], "cq_wpx_cw")
        self.assertEqual(self.read("sessions")["sessions"][0]["pluginID"], "cq_wpx_cw")
        context = self.read("cw_context")
        self.assertEqual((context["sentSerial"], context["sentExchange"]), ("002", "CONFIGURED"))
        self.mutate("qso_correct", qsoID=params["qsoID"], fields={"other_1": "50", "other_2": "200"})
        self.assertEqual(self.read("log")["rows"][0]["SentNr"], 50)
        ledger = self.host.database(self.session).exec_sql_mult("SELECT serial FROM xlog_serial ORDER BY serial")
        self.assertEqual([row["serial"] for row in ledger], [1, 2])
        self.mutate("qso_delete", qsoID=params["qsoID"])
        self.assertEqual(self.fields()["other_1"], "002")
        self.log(zone="300", minute=1)
        self.assertEqual(self.fields()["other_1"], "003")
        self.assertEqual(saved["projection"]["score"]["qsos"], 1)

    def test_plugin_esm_numeric_exchange_and_repeat_safe_intents(self):
        self.mutate("draft_apply", fields={"callsign": "K1ABC", "other_2": ""})
        call = self.mutate("esm", field="callsign")
        self.assertEqual([action["key"] for action in call["actions"]], ["F5"])
        invalid = self.mutate("esm", field="other_2", fields={"other_2": "ABC"})
        self.assertEqual([action["key"] for action in invalid["actions"]], ["F9"])
        params = {"sessionID": self.session, "operationID": uid(), "expectedRevision": self.revision,
                  "field": "other_2", "fields": {"other_2": "100"}}
        result = self.call("esm", params)
        self.assertEqual([(action["key"], action["sentSerial"]) for action in result["actions"]], [("F3", "001")])
        self.assertEqual(self.call("esm", params)["actions"], [])
        self.assertEqual(self.fields()["other_1"], "002")
        self.mutate("run_state", run=True)
        self.mutate("draft_apply", fields={"callsign": "DL1ABC", "other_2": "101"})
        self.assertEqual([action["key"] for action in self.mutate("esm", field="callsign")["actions"]], ["F2", "F3"])
        done = self.mutate("esm", field="other_2")
        self.assertEqual([action["key"] for action in done["actions"]], ["F4"])
        self.assertEqual(done["projection"]["score"]["total"], 8)

    def test_correction_delete_rescore_duplicate_and_keep_current_serial(self):
        first = self.log(zone="100")
        second = self.log(zone="200", minute=1)
        self.mutate("qso_correct", qsoID=first, fields={"callsign": "DL1ABC", "other_2": "300"})
        self.assertEqual(self.read("score")["score"]["total"], 8)
        self.mutate("qso_correct", qsoID=first, fields={"callsign": "K1ABC", "other_2": "100"})
        self.assertEqual(self.read("score")["score"]["points"], 3)
        self.mutate("qso_delete", qsoID=first)
        rows = self.read("log")["rows"]
        self.assertEqual([(row["ID"], row["Points"]) for row in rows], [(second, 3)])
        self.assertEqual(self.fields()["other_1"], "003")
        audit = self.host.database(self.session).exec_sql("SELECT before_json FROM xlog_qso_audit WHERE qso_id=? AND kind='correct' LIMIT 1", (first,))
        self.assertEqual(json.loads(audit["before_json"])["SentNr"], 1)

    def test_failed_commit_rolls_back_serial_and_setup_cannot_change_plugin(self):
        self.log(zone="100")
        with self.assertRaises(HostError):
            self.log(zone="200")
        self.assertEqual(self.fields()["other_1"], "002")
        self.assertEqual(self.host.database(self.session).exec_sql("SELECT count(*) AS n FROM xlog_serial")["n"], 2)
        setup = self.read("setup_get")["setup"]
        setup["settings"]["SentExchange"] = "OTHER"
        self.mutate("setup_save", setup=setup)
        self.assertEqual(self.fields()["other_1"], "002")
        setup["pluginID"] = "cq_ww_cw"
        with self.assertRaises(HostError):
            self.mutate("setup_save", setup=setup)

    def test_original_plugin_low_band_points_and_prefix_once_across_bands(self):
        self.log(zone="1234567")
        self.log(zone="200", minute=1, frequency=7025000)
        score = self.read("score")["score"]
        self.assertEqual((score["qsos"], score["points"], score["prefixes"], score["total"]), (2, 9, 1, 9))

    def test_process_death_on_both_sides_of_commit_preserves_serial(self):
        for stage, minute in (("before", 10), ("after", 11)):
            params = {"sessionID": self.session, "operationID": uid(), "expectedRevision": self.revision,
                      "qsoID": uid(), "timestamp": f"2026-10-19 08:{minute}:00",
                      "fields": {"callsign": "K1ABC", "other_2": "100"}}
            program = "\n".join([
                "import json, os, sys",
                "from contest_host.host import Host",
                "from contest_host.store import Store",
                "original = Store.finish",
                "def interrupted(self, success):",
                f"    if success and {stage!r} == 'before': os._exit(71)",
                "    original(self, success)",
                "    if success: os._exit(72)",
                "Store.finish = interrupted",
                "Host(sys.argv[1]).dispatch(json.loads(sys.stdin.read()))",
            ])
            child = subprocess.run([sys.executable, "-c", program, str(self.root)],
                                   input=json.dumps({"id": uid(), "method": "qso_commit", "params": params}).encode(),
                                   capture_output=True)
            self.assertEqual(child.returncode, 71 if stage == "before" else 72, child.stderr)
            result = self.call("qso_commit", params)
            self.assertEqual(result["replayed"], stage == "after")
        rows = self.host.database(self.session).exec_sql_mult("SELECT serial FROM xlog_serial ORDER BY serial")
        self.assertEqual([row["serial"] for row in rows], [1, 2, 3])
        self.assertEqual(self.fields()["other_1"], "003")


if __name__ == "__main__":
    unittest.main()
