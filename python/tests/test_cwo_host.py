"""Actual pinned CWOPS Open plugin through the Python/SQLite contest host."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Host, HostError
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures

uid = fixtures.uid


class CWOHostTests(unittest.TestCase):
    call = fixtures.HostTests.call
    mutate = fixtures.HostTests.mutate
    read = fixtures.HostTests.read
    tearDown = fixtures.HostTests.tearDown

    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve() / "host"
        self.host = Host(self.root)
        self.session, self.workspace, self.revision = uid(), uid(), 0
        self.create = {
            "sessionID": self.session,
            "workspaceGeneration": self.workspace,
            "operationID": uid(),
            "expectedRevision": 0,
            "pluginID": "cwo",
            "station": {"Call": "OM0RX", "Name": "OLIVER BROSS", "GridSquare": "JN88TQ"},
            "frequencyHz": 14025000,
            "settings": {"SentExchange": "OLIVER", "ModeCategory": "CW"},
            "reference": {"id": "test-cty-v1", "countries": deepcopy(fixtures.CTY)},
        }
        self.call("session_create", self.create)

    def fields(self):
        return {row["id"]: row for row in self.read("projection")["projection"]["fields"]}

    def log(self, call="K1ABC", exchange="12 ALICE", minute=0, frequency=14025000):
        qso_id = uid()
        self.mutate(
            "qso_commit",
            qsoID=qso_id,
            timestamp=f"2026-10-20 10:{minute:02}:00",
            frequencyHz=frequency,
            fields={"callsign": call, "other_2": exchange},
        )
        return qso_id

    def test_original_bytes_catalog_layout_history_and_macros(self):
        source = VENDOR / "not1mm/plugins/cwo.py"
        self.assertEqual(
            sha256(source.read_bytes()).hexdigest(),
            "e162c7e11759cd97322e2d60257f05e47312d997751c2fb2db2b5751872b3a8e",
        )
        self.assertEqual(load_plugin("cwo").__file__, str(source))
        catalog = {row["id"]: row for row in self.call("catalog", {})["plugins"]}
        self.assertEqual(catalog["cwo"]["name"], "CWOPS - Open")

        view = self.read("session_open")["projection"]
        self.assertEqual(view["pluginName"], "CWOPS - Open")
        self.assertEqual(view["reservedSerial"], 1)
        self.assertTrue(view["allowDuplicateCommit"])
        self.assertEqual(view["nextField"], "other_2")
        self.assertEqual(view["tabNext"], {"callsign": "other_2", "other_1": "other_2", "other_2": "callsign"})
        self.assertEqual(view["tabPrevious"], {"callsign": "other_2", "other_1": "callsign", "other_2": "callsign"})
        fields = self.fields()
        self.assertFalse(fields["sent"]["visible"])
        self.assertFalse(fields["receive"]["visible"])
        self.assertEqual((fields["other_1"]["label"], fields["other_2"]["label"]),
                         ("SentNR", "Recd Number and Name"))
        self.assertEqual((fields["other_1"]["value"], fields["other_1"]["readOnly"]), ("001", True))

        for run in (False, True):
            self.mutate("run_state", run=run)
            action = self.mutate("function_key", key="F3")["actions"][0]
            self.assertEqual((action["template"], action["sentSerial"], action["sentExchange"]),
                             ("{SENTNR} {EXCHANGE}", "001", "OLIVER"))

        store = self.host.database(self.session)
        store.conn.execute(
            "INSERT INTO callhistory(Call,Name,UserText) VALUES(?,?,?)",
            ("K1ABC", "ALICE", "CW Open regular"),
        )
        store.conn.commit()
        self.mutate("draft_apply", fields={"callsign": "K1ABC", "other_2": ""})
        self.assertEqual(self.fields()["other_2"]["value"], "ALICE ")
        self.assertIn("CW Open regular", self.read("projection")["projection"]["history"])

    def test_exchange_and_sent_name_validation_are_atomic(self):
        invalid = ("", "ALICE", "12", "0 ALICE", "ALICE 0", "-1 ALICE", "ALICE -1",
                   "ALICE ABC", "12 34", "ALICE  12", " ALICE 12", "ALICE 12 ",
                   "ALICE 12 EXTRA", "9223372036854775808 ALICE")
        for exchange in invalid:
            with self.subTest(exchange=exchange):
                revision = self.revision
                with self.assertRaises(HostError):
                    self.mutate("qso_commit", fields={"callsign": "K1ABC", "other_2": exchange})
                self.assertEqual(self.read("projection")["projection"]["revision"], revision)
        self.assertEqual(self.read("log")["total"], 0)

        for name in ("", "OLIVER 1", "123", " OLIVER", "OLIVER ", 123):
            params = deepcopy(self.create)
            params.update(sessionID=uid(), operationID=uid(), settings={"SentExchange": name})
            with self.subTest(name=name), self.assertRaises(HostError):
                self.call("session_create", params)

        with self.assertRaisesRegex(HostError, "reserved"):
            self.mutate("draft_apply", fields={"other_1": "002"})

    def test_scoring_band_dupes_correction_delete_export_and_reopen(self):
        first = self.log(exchange="12 ALICE")
        duplicate = self.log(exchange="ALICE 13", minute=1)
        accepted_other_band = self.log(exchange="14 ALICE", minute=2, frequency=7025000)
        self.log("DL1ABC", "HANS 7", minute=3)

        score = self.read("score")["score"]
        self.assertEqual((score["qsos"], score["points"], score["uniqueCalls"], score["total"]), (4, 3, 2, 6))
        rows = {row["ID"]: row for row in self.read("log")["rows"]}
        self.assertEqual((rows[first]["NR"], rows[first]["Name"], rows[first]["Points"]), (12, "ALICE", 1))
        self.assertEqual((rows[duplicate]["NR"], rows[duplicate]["Name"], rows[duplicate]["Points"]), (13, "ALICE", 0))

        self.mutate("qso_correct", qsoID=accepted_other_band,
                    fields={"other_1": "50", "other_2": "ROB 99"}, reason="Correct copied exchange")
        corrected = next(row for row in self.read("log")["rows"] if row["ID"] == accepted_other_band)
        self.assertEqual((corrected["SentNr"], corrected["NR"], corrected["Name"]), (50, 99, "ROB"))

        self.mutate("qso_delete", qsoID=first, reason="Wrong contact")
        promoted = next(row for row in self.read("log")["rows"] if row["ID"] == duplicate)
        self.assertEqual(promoted["Points"], 1)
        self.assertEqual(self.read("score")["score"]["total"], 6)

        content = self.read("export")["content"]
        self.assertIn("CONTEST: CW-OPEN\r\n", content)
        self.assertIn("CLAIMED-SCORE: 6\r\n", content)
        lines = [line.split() for line in content.splitlines() if line.startswith("QSO:")]
        self.assertEqual(len(lines), 3)
        self.assertEqual([(line[6], line[7], line[8], line[9], line[10]) for line in lines],
                         [("2", "OLIVER", "K1ABC", "13", "ALICE"),
                          ("50", "OLIVER", "K1ABC", "99", "ROB"),
                          ("4", "OLIVER", "DL1ABC", "7", "HANS")])
        self.assertTrue(content.endswith("END-OF-LOG:\r\n"))

        self.host.close()
        self.host = Host(self.root)
        reopened = self.read("session_open")["projection"]
        self.assertEqual(reopened["reservedSerial"], 5)
        self.assertEqual(reopened["score"]["total"], 6)

    def test_esm_commit_receipt_replay_and_serial_progression(self):
        self.mutate("run_state", run=True)
        result = self.mutate("esm", field="callsign",
                             fields={"callsign": "K1ABC", "other_2": ""})
        self.assertEqual([action["key"] for action in result["actions"]], ["F2", "F3"])
        params = {
            "sessionID": self.session,
            "operationID": uid(),
            "expectedRevision": self.revision,
            "field": "other_2",
            "fields": {"other_2": "12 ALICE"},
        }
        result = self.call("esm", params)
        self.assertEqual([action["key"] for action in result["actions"]], ["F4"])
        self.assertEqual((self.read("log")["total"], self.fields()["other_1"]["value"]), (1, "002"))
        replay = self.call("esm", params)
        self.assertTrue(replay["replayed"])
        self.assertEqual(replay["actions"], [])
        self.assertEqual(self.read("log")["total"], 1)


if __name__ == "__main__":
    unittest.main()
