"""Original Trans Tasman plugin, scoped durable serials and compatibility fixes."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from contest_host.host import Desk, Host, HostError, SOURCE_REVISION
from contest_host.store import Store
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures

uid = fixtures.uid


class TransTasmanHostTests(unittest.TestCase):
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
        countries["VK4ABC"] = {"entity": "Australia", "continent": "OC", "cq": 30, "itu": 55, "primary_pfx": "VK"}
        self.create = {"sessionID": self.session, "workspaceGeneration": self.workspace,
                       "operationID": uid(), "expectedRevision": 0, "pluginID": "trans_tasman",
                       "station": {"Call": "VK4ABC"}, "frequencyHz": 7025000,
                       "settings": {"OperatorCategory": "SINGLE-OP"},
                       "reference": {"id": "test-cty-v1", "countries": countries}}
        self.call("session_create", self.create)

    def log(self, call="ZL1ABC", stamp="2026-10-20 08:10:00", frequency=7025000):
        qso = uid()
        self.mutate("qso_commit", qsoID=qso, timestamp=stamp, frequencyHz=frequency,
                    fields={"callsign": call, "other_2": "012"})
        return qso

    def test_source_fields_macros_and_band_serial_validation(self):
        source = VENDOR / "not1mm/plugins/trans_tasman.py"
        self.assertEqual(sha256(source.read_bytes()).hexdigest(), "e077c5bc1f77d7f4ef75c7591cf4a0d5f984a26997fbd6831ddd7f92093e3344")
        self.assertEqual(load_plugin("trans_tasman").__file__, str(source))
        view = self.read("projection")["projection"]
        fields = {field["id"]: field for field in view["fields"]}
        self.assertEqual((fields["other_1"]["label"], fields["other_2"]["label"]), ("SentNR", "RcvNR"))
        self.assertEqual(fields["other_1"]["value"], "001")
        self.assertTrue(fields["other_1"]["readOnly"])
        self.assertEqual(view["supportedBands"], ["160m", "80m", "40m"])
        self.assertEqual(view["supportedModes"], ["CW"])
        self.assertTrue(view["allowDuplicateCommit"])
        self.assertEqual(view["ruleIdentity"], {"id": "trans-tasman", "version": "26.10.11",
                                               "edition": "not1mm-python",
                                               "sourceRevision": SOURCE_REVISION})
        self.assertIn("2-hour", view["dupeExplanation"])
        for run in (True, False):
            self.mutate("run_state", run=run)
            action = self.mutate("function_key", key="F3")["actions"][0]
            self.assertEqual((action["template"], action["sentSerial"]), ("{RST} {SENTNR}", "001"))
        for value in ("", "0", "-1", " 12", "12 ", "１２", "9223372036854775808"):
            with self.subTest(value=value), self.assertRaises(HostError):
                self.mutate("qso_commit", fields={"callsign": "ZL1ABC", "other_2": value})
        for method in ("draft_apply", "qso_commit"):
            with self.assertRaisesRegex(HostError, "160, 80 and 40"):
                self.mutate(method, frequencyHz=14025000)
        create = deepcopy(self.create)
        create.update(sessionID=uid(), operationID=uid(), frequencyHz=14025000)
        with self.assertRaises(HostError):
            self.call("session_create", create)
        self.assertEqual(self.read("projection")["projection"]["reservedSerial"], 1)

    def test_blocks_duplicates_score_correction_delete_export_and_reopen(self):
        first = self.log()
        duplicate = self.log(stamp="2026-10-20 09:59:59")
        self.log(stamp="2026-10-20 10:00:00")
        self.log("VK2ABC", "2026-10-20 10:01:00", 3525000)
        self.log("K1ABC", "2026-10-20 10:02:00")
        score = self.read("score")["score"]
        self.assertEqual((score["qsos"], score["points"], score["prefixes"], score["total"]), (3, 3, 3, 5))
        self.assertEqual(self.read("log")["total"], 5)
        self.mutate("draft_apply", fields={"callsign": "ZL1ABC"})
        for stamp, expected in (("2026-10-20 09:59:59", True), ("2026-10-20 10:00:00", True), ("2026-10-20 12:00:00", False)):
            with patch("contest_host.host.now", return_value=stamp):
                self.assertEqual(self.read("projection")["projection"]["dupe"], expected)
        self.mutate("qso_correct", qsoID=duplicate, timestamp="2026-10-20 12:00:00", reason="Correct time")
        self.assertEqual(self.read("score")["score"]["total"], 6)
        self.mutate("qso_delete", qsoID=first, reason="Wrong contact")
        self.assertEqual(self.read("score")["score"]["total"], 5)
        content = self.read("export")["content"]
        self.assertIn("CONTEST: WIA-TRANS TASMAN\r\n", content)
        self.assertIn("CLAIMED-SCORE: 5\r\n", content)
        lines = [line.split() for line in content.splitlines() if line.startswith("QSO:")]
        self.assertEqual(len(lines), 4)
        self.assertEqual({line[1] for line in lines}, {"7025", "3525"})
        self.assertEqual({line[2] for line in lines}, {"CW"})
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"]["total"], 5)
        self.assertEqual(self.read("projection")["projection"]["reservedSerial"], 6)

    def test_multi_band_reservations_repeat_and_retry(self):
        setup = self.read("setup_get")["setup"]
        setup["settings"]["OperatorCategory"] = "MULTI-OP"
        self.mutate("setup_save", setup=setup)
        self.mutate("run_state", run=True)
        for frequency in (3525000, 7025000, 3525000):
            self.mutate("draft_apply", frequencyHz=frequency)
            for repeat in range(2):
                result = self.mutate("esm", field="callsign", fields={"callsign": "ZL1ABC"})
                self.assertEqual(result["actions"][-1]["sentSerial"], "001")
        params = {"sessionID": self.session, "operationID": uid(), "expectedRevision": self.revision,
                  "field": "other_2", "fields": {"other_2": "12"}}
        self.call("esm", params)
        self.assertTrue(self.call("esm", params)["replayed"])
        self.assertEqual(self.read("projection")["projection"]["reservedSerial"], 2)
        self.mutate("draft_apply", frequencyHz=7025000)
        self.assertEqual(self.read("projection")["projection"]["reservedSerial"], 2)
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("projection")["projection"]["reservedSerial"], 2)
        ledger = self.host.database(self.session).exec_sql_mult("SELECT scope,serial FROM xlog_serial ORDER BY scope,serial")
        self.assertEqual([(row["scope"], row["serial"]) for row in ledger],
                         [("band:3.5", 1), ("band:3.5", 2), ("band:7.0", 1), ("band:7.0", 2), ("contest", 1)])

    def test_mode_groups_out_of_order_rebuild_and_invalid_correction(self):
        later = self.log(stamp="2026-10-20 09:00:00")
        earlier = self.log(stamp="2026-10-20 08:00:00")
        rows = {row["ID"]: row for row in self.read("log")["rows"]}
        self.assertEqual((rows[earlier]["Points"], rows[later]["Points"]), (1, 0))
        self.assertEqual(self.read("score")["score"]["total"], 1)
        store = self.host.database(self.session)
        desk = Desk(store, store.state(self.session), self.host.commit)
        for mode, expected in (("CW", True), ("CW-R", True), ("USB", False), ("RTTY", False)):
            self.assertEqual(desk.is_dupe("ZL1ABC", 7.0, "2026-10-20 08:30:00", mode), expected)
        store.conn.execute("UPDATE DXLOG SET Mode='LSB' WHERE ID=?", (earlier,))
        store.conn.execute("UPDATE DXLOG SET Mode='RTTY' WHERE ID=?", (later,))
        store.conn.commit()
        for mode in ("USB", "SSB", "FM", "AM", "PSK31"):
            self.assertTrue(desk.is_dupe("ZL1ABC", 7.0, "2026-10-20 08:30:00", mode))
        with self.assertRaises(HostError):
            self.mutate("qso_correct", qsoID=later, fields={"other_2": "0"})
        with self.assertRaises(HostError):
            self.mutate("qso_correct", qsoID=later, frequencyHz=14025000)
        self.assertEqual(self.read("log")["total"], 2)

    def test_sp_esm_failed_save_repeat_and_delete_promotes_duplicate(self):
        self.mutate("draft_apply", fields={"callsign": "ZL1ABC", "other_2": "0"})
        with self.assertRaises(HostError):
            self.mutate("esm", field="other_2")
        self.assertEqual(self.read("log")["total"], 0)
        self.assertEqual(self.read("cw_context")["sentSerial"], "001")
        params = {"sessionID": self.session, "operationID": uid(), "expectedRevision": self.revision,
                  "field": "other_2", "fields": {"other_2": "12"}}
        with patch("contest_host.host.now", return_value="2026-10-20 08:00:00"):
            result = self.call("esm", params)
        self.assertEqual([(action["key"], action["sentSerial"]) for action in result["actions"]], [("F3", "001")])
        first = self.read("log")["rows"][0]["ID"]
        self.assertEqual(self.call("esm", params)["actions"], [])
        duplicate = self.log(stamp="2026-10-20 08:01:00")
        self.mutate("qso_delete", qsoID=first)
        self.assertEqual(self.read("log")["rows"][0]["ID"], duplicate)
        self.assertEqual(self.read("log")["rows"][0]["Points"], 1)
        self.assertEqual(self.read("score")["score"]["total"], 1)
        self.assertEqual(self.read("cw_context")["sentSerial"], "003")

    def test_legacy_ledger_migrates_without_losing_issued_rows(self):
        path = self.root / "legacy.sqlite"
        store = Store(path)
        store.close()
        with sqlite3.connect(path) as connection:
            connection.executescript("DROP TABLE xlog_serial; CREATE TABLE xlog_serial(draft_id TEXT PRIMARY KEY,serial INTEGER NOT NULL UNIQUE,operation_id TEXT NOT NULL);")
            connection.execute("INSERT INTO xlog_serial VALUES(?,?,?)", ("old-draft", 7, "old-operation"))
        store = Store(path)
        try:
            self.assertEqual(store.exec_sql("SELECT * FROM xlog_serial"),
                             {"draft_id": "old-draft", "serial": 7, "operation_id": "old-operation", "scope": "contest"})
            store.conn.execute("INSERT INTO xlog_serial VALUES(?,?,?,?)", ("new-draft", 7, "new-operation", "band:7.0"))
        finally:
            store.close()


if __name__ == "__main__":
    unittest.main()
