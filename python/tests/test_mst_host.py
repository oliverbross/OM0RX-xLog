"""Actual pinned ICWC plugin through durable host operations, never translated rules."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Host, HostError
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures

uid = fixtures.uid


class MSTHostTests(unittest.TestCase):
    call = fixtures.HostTests.call
    mutate = fixtures.HostTests.mutate
    read = fixtures.HostTests.read
    tearDown = fixtures.HostTests.tearDown

    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve() / "host"
        self.host = Host(self.root)
        self.session, self.workspace, self.revision = uid(), uid(), 0
        self.create = {"sessionID": self.session, "workspaceGeneration": self.workspace,
                       "operationID": uid(), "expectedRevision": 0, "pluginID": "icwc_mst",
                       "station": {"Call": "OM0RX"}, "frequencyHz": 14025000,
                       "settings": {"SentExchange": "OLIVER"},
                       "reference": {"id": "test-cty-v1", "countries": deepcopy(fixtures.CTY)}}
        self.call("session_create", self.create)

    def fields(self):
        return {row["id"]: row for row in self.read("projection")["projection"]["fields"]}

    def log(self, call="K1ABC", exchange="BOB 12", minute=0, frequency=14025000):
        qso = uid()
        self.mutate("qso_commit", qsoID=qso, timestamp=f"2026-10-20 08:{minute:02}:00", frequencyHz=frequency,
                    fields={"callsign": call, "other_2": exchange})
        return qso

    def test_original_bytes_layout_tabs_history_and_partial_drafts(self):
        path = VENDOR / "not1mm/plugins/icwc_mst.py"
        self.assertEqual(sha256(path.read_bytes()).hexdigest(), "4fcf5971b539a3f7634fea21a752d1a5915d8d11f08c14d0a608a62d57ffb8ca")
        self.assertEqual(load_plugin("icwc_mst").__file__, str(path))
        view = self.read("session_open")["projection"]
        self.assertEqual(view["pluginName"], "ICWC Medium Speed Test")
        self.assertEqual(view["reservedSerial"], 1)
        self.assertEqual(view["nextField"], "other_2")
        self.assertEqual(view["tabNext"], {"callsign": "other_1", "other_1": "other_2", "other_2": "callsign"})
        self.assertEqual(view["tabPrevious"], {"callsign": "other_2", "other_1": "callsign", "other_2": "other_1"})
        fields = self.fields()
        self.assertFalse(fields["sent"]["visible"])
        self.assertFalse(fields["receive"]["visible"])
        self.assertEqual((fields["other_1"]["label"], fields["other_2"]["label"]), ("Sent S/N", "Name + S/N"))
        self.assertEqual(fields["other_1"]["value"], "001")
        self.assertTrue(fields["other_1"]["readOnly"])
        store = self.host.database(self.session)
        store.conn.execute("INSERT INTO callhistory(Call,Name,UserText) VALUES(?,?,?)", ("K1ABC", "BOB", "Copied name"))
        store.conn.commit()
        self.mutate("draft_apply", fields={"callsign": "K1ABC", "other_2": ""})
        self.assertEqual(self.fields()["other_2"]["value"], "BOB")
        self.assertIn("Copied name", self.read("projection")["projection"]["history"])
        self.mutate("focus", field="other_2")
        self.assertEqual(self.read("projection")["projection"]["focus"], "other_2")
        self.assertEqual(self.read("log")["total"], 0)

    def test_invalid_exchanges_and_sent_names_reject_atomically(self):
        for exchange in ("", "BOB", "12", "BOB 0", "BOB -1", "BOB ABC", "BOB  12", " BOB 12", "BOB 12 ", "BOB 12 EXTRA", "BOB 9223372036854775808"):
            with self.subTest(exchange=exchange), self.assertRaises(HostError):
                self.mutate("qso_commit", fields={"callsign": "K1ABC", "other_2": exchange})
        self.assertEqual(self.read("log")["total"], 0)
        self.assertEqual(self.fields()["other_1"]["value"], "001")
        for name in ("", "OLIVER 12", "123", 123):
            params = deepcopy(self.create)
            params.update(sessionID=uid(), operationID=uid(), settings={"SentExchange": name})
            with self.subTest(name=name), self.assertRaises(HostError):
                self.call("session_create", params)
        with self.assertRaisesRegex(HostError, "reserved"):
            self.mutate("draft_apply", fields={"other_1": "002"})

    def test_scoring_dupes_bands_correction_delete_export_and_reopen(self):
        first = self.log()
        duplicate = self.log(minute=1)
        self.log(minute=2, frequency=7025000)
        self.log("DL1ABC", "HANS 7", minute=3)
        score = self.read("score")["score"]
        self.assertEqual((score["qsos"], score["points"], score["uniqueCalls"], score["total"]), (4, 3, 2, 6))
        self.assertEqual(self.read("projection")["projection"]["reservedSerial"], 5)
        self.mutate("qso_correct", qsoID=first, fields={"other_2": "ROB 99", "other_1": "11"}, reason="Correct copy")
        row = next(row for row in self.read("log")["rows"] if row["ID"] == first)
        self.assertEqual((row["Name"], row["NR"], row["SentNr"]), ("ROB", 99, 11))
        self.mutate("qso_delete", qsoID=first, reason="Wrong contact")
        row = next(row for row in self.read("log")["rows"] if row["ID"] == duplicate)
        self.assertEqual(row["Points"], 1)
        self.assertEqual(self.read("score")["score"]["total"], 6)
        content = self.read("export")["content"]
        self.assertIn("CONTEST: ICWC-MST\r\n", content)
        self.assertIn("CLAIMED-SCORE: 6\r\n", content)
        lines = [line.split() for line in content.splitlines() if line.startswith("QSO:")]
        self.assertEqual(len(lines), 3)
        self.assertEqual(lines[0][6:11], ["OLIVER", "2", "K1ABC", "BOB", "12"])
        self.assertTrue(content.endswith("END-OF-LOG:\r\n"))
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"]["total"], 6)
        self.assertEqual(self.fields()["other_1"]["value"], "005")

    def test_macro_esm_partial_failure_receipt_replay_and_serial(self):
        self.mutate("run_state", run=True)
        for run in (True, False):
            self.mutate("run_state", run=run)
            action = self.mutate("function_key", key="F3")["actions"][0]
            self.assertEqual((action["template"], action["sentExchange"], action["sentSerial"]), ("{EXCHANGE} {SENTNR}", "OLIVER", "001"))
        self.mutate("run_state", run=True)
        result = self.mutate("esm", field="callsign", fields={"callsign": "K1ABC", "other_2": "BOB"})
        self.assertEqual([action["key"] for action in result["actions"]], ["F2", "F3"])
        with self.assertRaises(HostError):
            self.mutate("esm", field="other_2")
        params = {"sessionID": self.session, "operationID": uid(), "expectedRevision": self.revision,
                  "field": "other_2", "fields": {"other_2": "BOB 12"}}
        result = self.call("esm", params)
        self.assertEqual([action["key"] for action in result["actions"]], ["F4"])
        self.assertEqual(self.read("log")["total"], 1)
        replay = self.call("esm", params)
        self.assertTrue(replay["replayed"])
        self.assertEqual(replay["actions"], [])
        self.assertEqual(self.fields()["other_1"]["value"], "002")


if __name__ == "__main__":
    unittest.main()
