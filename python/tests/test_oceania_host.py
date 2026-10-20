"""Original source-pinned Oceania CW plugin through the production host."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Host, HostError
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures

uid = fixtures.uid


class OceaniaHostTests(unittest.TestCase):
    call = fixtures.HostTests.call
    mutate = fixtures.HostTests.mutate
    read = fixtures.HostTests.read
    tearDown = fixtures.HostTests.tearDown

    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve() / "host"
        self.host = Host(self.root)
        self.session, self.workspace, self.revision = uid(), uid(), 0
        countries = deepcopy(fixtures.CTY)
        for call in ("VK4ABC", "VK4XYZ", "VK2ABC", "ZL1ABC"):
            countries[call] = {"entity": "Australia" if call.startswith("VK") else "New Zealand",
                               "continent": "OC", "cq": 30, "itu": 55,
                               "primary_pfx": "VK" if call.startswith("VK") else "ZL"}
        self.create = {"sessionID": self.session, "workspaceGeneration": self.workspace,
                       "operationID": uid(), "expectedRevision": 0, "pluginID": "oceania_dx_cw",
                       "station": {"Call": "OM0RX"}, "frequencyHz": 14025000,
                       "settings": {}, "reference": {"id": "test-cty-v1", "countries": countries}}
        self.call("session_create", self.create)

    def log(self, call="VK4ABC", minute=0, frequency=14025000):
        qso = uid()
        self.mutate("qso_commit", qsoID=qso, timestamp=f"2026-10-20 08:{minute:02}:00",
                    frequencyHz=frequency, fields={"callsign": call, "other_2": "012"})
        return qso

    def test_original_source_layout_serial_validation_and_macros(self):
        source = VENDOR / "not1mm/plugins/oceania_dx_cw.py"
        self.assertEqual(sha256(source.read_bytes()).hexdigest(),
                         "51d3234f98c3c7ae4c5343cef512545c1a4f41e37a685426724b860def85d664")
        self.assertEqual(load_plugin("oceania_dx_cw").__file__, str(source))
        view = self.read("projection")["projection"]
        fields = {row["id"]: row for row in view["fields"]}
        self.assertEqual((fields["other_1"]["label"], fields["other_2"]["label"]), ("SentNR", "RcvNR"))
        self.assertEqual(fields["other_1"]["value"], "001")
        self.assertTrue(fields["other_1"]["readOnly"])
        self.assertEqual(view["tabNext"]["receive"], "other_1")
        self.assertEqual(view["nextField"], "other_2")
        self.assertTrue(view["allowDuplicateCommit"])
        for run in (True, False):
            self.mutate("run_state", run=run)
            action = self.mutate("function_key", key="F3")["actions"][0]
            self.assertEqual((action["template"], action["sentSerial"]), ("{RST} {SENTNR}", "001"))
        for received in ("", "ABC", "0", "-1", " 12", "１２", "9223372036854775808"):
            with self.subTest(received=received), self.assertRaises(HostError):
                self.mutate("qso_commit", fields={"callsign": "VK4ABC", "other_2": received})
        with self.assertRaises(HostError):
            self.mutate("draft_apply", fields={"other_1": "999"})
        self.assertEqual(self.read("projection")["projection"]["reservedSerial"], 1)

    def test_all_band_points_prefix_scopes_duplicates_and_geography(self):
        for index, frequency in enumerate((1825000, 3525000, 7025000, 14025000, 21025000, 28025000)):
            self.log(minute=index, frequency=frequency)
        self.log("VK4XYZ", 6)  # same prefix on 20m
        self.log("VK4ABC", 7)  # same call on 20m: retained, zero points
        self.log("K1ABC", 8)   # neither endpoint in Oceania
        score = self.read("score")["score"]
        self.assertEqual((score["qsos"], score["points"], score["prefixes"], score["total"]), (9, 42, 6, 252))
        self.mutate("draft_apply", fields={"callsign": "VK4ABC"})
        self.assertTrue(self.read("projection")["projection"]["dupe"])
        self.mutate("draft_apply", fields={"callsign": "ZL1ABC"})
        self.assertFalse(self.read("projection")["projection"]["dupe"])
        setup = self.read("setup_get")["setup"]
        setup["station"]["Call"] = "VK4ABC"
        self.mutate("setup_save", setup=setup)
        self.log("DL1ABC", 9)
        self.assertEqual(self.read("score")["score"]["points"], 44)

    def test_correction_delete_out_of_order_restart_and_cabrillo(self):
        later = self.log(minute=10)
        earlier = self.log(minute=0)
        self.log("VK4XYZ", 20)
        rows = {row["ID"]: row for row in self.read("log")["rows"]}
        self.assertEqual((rows[earlier]["Points"], rows[later]["Points"]), (1, 0))
        self.assertEqual(self.read("score")["score"]["total"], 2)
        self.mutate("qso_correct", qsoID=later, fields={"callsign": "ZL1ABC", "other_2": "123"}, reason="Correct call")
        self.assertEqual(self.read("score")["score"]["total"], 6)
        self.mutate("qso_delete", qsoID=earlier, reason="Wrong contact")
        self.assertEqual(self.read("score")["score"]["total"], 4)
        with self.assertRaises(HostError):
            self.mutate("qso_correct", qsoID=later, fields={"other_2": "0"})
        content = self.read("export")["content"]
        self.assertIn("CONTEST: OCEANIA-DX-CW\r\n", content)
        self.assertIn("CLAIMED-SCORE: 4\r\n", content)
        lines = [line.split() for line in content.splitlines() if line.startswith("QSO:")]
        self.assertEqual(len(lines), 2)
        self.assertEqual(lines[0][1:3], ["14025", "CW"])
        self.assertEqual(lines[0][5:], ["OM0RX", "599", "1", "ZL1ABC", "599", "123"])
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"]["total"], 4)
        self.assertEqual(self.read("projection")["projection"]["reservedSerial"], 4)

    def test_original_esm_run_sandp_and_replay_serial_authority(self):
        self.mutate("run_state", run=True)
        result = self.mutate("esm", field="callsign", fields={"callsign": "VK4ABC"})
        self.assertEqual([action["key"] for action in result["actions"]], ["F2", "F3"])
        self.assertEqual(result["actions"][-1]["sentSerial"], "001")
        params = {"sessionID": self.session, "operationID": uid(), "expectedRevision": self.revision,
                  "field": "other_2", "fields": {"other_2": "12"}}
        self.call("esm", params)
        replay = self.call("esm", params)
        self.assertTrue(replay["replayed"])
        self.assertEqual(self.read("log")["total"], 1)
        self.assertEqual(self.read("projection")["projection"]["reservedSerial"], 2)
        self.mutate("run_state", run=False)
        result = self.mutate("esm", field="other_2", fields={"callsign": "ZL1ABC", "other_2": "99"})
        self.assertEqual([action["key"] for action in result["actions"]], ["F3"])
        self.assertEqual(result["actions"][0]["sentSerial"], "002")
        self.assertEqual(self.read("projection")["projection"]["reservedSerial"], 3)

    def test_same_timestamp_prefix_is_counted_once(self):
        first = self.log()
        self.log("VK4XYZ")
        self.assertEqual(self.read("score")["score"]["total"], 2)
        self.mutate("qso_delete", qsoID=first)
        self.assertEqual(self.read("score")["score"]["total"], 1)


if __name__ == "__main__":
    unittest.main()
