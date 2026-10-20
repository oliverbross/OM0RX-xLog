"""Actual pinned CWT and K1USN SST plugins through the Python host."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Host, HostError
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures

uid = fixtures.uid


class PluginHostMixin:
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
                       "operationID": uid(), "expectedRevision": 0, "pluginID": self.plugin_id,
                       "station": {"Call": "OM0RX"}, "frequencyHz": 14025000,
                       "settings": {"SentExchange": self.sent_exchange},
                       "reference": {"id": "test-cty-v1", "countries": deepcopy(fixtures.CTY)}}
        self.call("session_create", self.create)

    def fields(self):
        return {row["id"]: row for row in self.read("projection")["projection"]["fields"]}

    def log(self, call="K1ABC", name="ALICE", exchange=None, minute=0, frequency=14025000):
        qso = uid()
        self.mutate("qso_commit", qsoID=qso, timestamp=f"2026-10-20 09:{minute:02}:00",
                    frequencyHz=frequency,
                    fields={"callsign": call, "other_1": name,
                            "other_2": exchange or self.first_exchange})
        return qso

    def test_original_source_layout_and_catalog(self):
        path = VENDOR / f"not1mm/plugins/{self.plugin_id}.py"
        self.assertEqual(sha256(path.read_bytes()).hexdigest(), self.source_hash)
        self.assertEqual(load_plugin(self.plugin_id).__file__, str(path))
        catalog = {row["id"]: row for row in self.call("catalog", {})["plugins"]}
        self.assertEqual(catalog[self.plugin_id]["name"], self.plugin_name)
        view = self.read("session_open")["projection"]
        self.assertEqual(view["pluginName"], self.plugin_name)
        self.assertIsNone(view["reservedSerial"])
        self.assertEqual(view["nextField"], "other_1")
        self.assertEqual(view["tabNext"], {"callsign": "other_1", "other_1": "other_2", "other_2": "callsign"})
        self.assertEqual(view["tabPrevious"], {"callsign": "other_2", "other_1": "callsign", "other_2": "other_1"})
        fields = self.fields()
        self.assertFalse(fields["sent"]["visible"])
        self.assertFalse(fields["receive"]["visible"])
        self.assertEqual((fields["other_1"]["label"], fields["other_2"]["label"]),
                         ("Name", self.exchange_label))
        self.assertFalse(fields["other_1"]["readOnly"])
        self.assertTrue(fields["other_1"]["enabled"])
        self.mutate("draft_apply", fields={"other_1": "ALICE"})
        self.assertEqual(self.fields()["other_1"]["value"], "ALICE")

    def test_direct_commit_clears_received_name_for_next_draft_and_reopen(self):
        previous_draft = self.read("projection")["projection"]["draftID"]
        self.log()
        self.assertNotEqual(self.read("projection")["projection"]["draftID"], previous_draft)
        for field in ("callsign", "other_1", "other_2"):
            self.assertEqual(self.fields()[field]["value"], "")
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.fields()["other_1"]["value"], "")
        with self.assertRaises(HostError):
            self.mutate("qso_commit", fields={"callsign": "DL1ABC", "other_2": self.dx_exchange})
        self.assertEqual(self.read("log")["total"], 1)

    def test_setup_save_validates_sent_exchange_atomically(self):
        before = self.read("setup_get")["setup"]
        for invalid in ("", " ", " ALICE CT", "ALICE CT ", "A" * 65, 123, None):
            with self.subTest(sent_exchange=invalid):
                setup = deepcopy(before)
                if invalid is None:
                    del setup["settings"]["SentExchange"]
                else:
                    setup["settings"]["SentExchange"] = invalid
                revision = self.revision
                with self.assertRaises(HostError):
                    self.mutate("setup_save", setup=setup)
                self.assertEqual(self.read("projection")["projection"]["revision"], revision)
                self.assertEqual(self.read("setup_get")["setup"], before)

    def test_correction_preserves_historical_sent_exchange_after_setup_change(self):
        first = self.log()
        before = self.read("log")["rows"][0]
        setup = self.read("setup_get")["setup"]
        setup["settings"]["SentExchange"] = "BOB MA"
        self.mutate("setup_save", setup=setup)
        self.mutate("draft_apply", fields={"callsign": "DL1ABC", "other_1": "HANS",
                                            "other_2": self.dx_exchange})
        self.mutate("qso_correct", qsoID=first, fields={"other_1": "ROB"},
                    reason="Correct received name")
        row = self.read("log")["rows"][0]
        self.assertEqual(row["Name"], "ROB")
        self.assertEqual(row["SentNr"], before["SentNr"])
        self.assertEqual(self.fields()["other_1"]["value"], "HANS")
        self.mutate("qso_correct", qsoID=first, frequencyHz=7025000,
                    reason="Correct band")
        self.assertEqual(self.read("log")["rows"][0]["SentNr"], before["SentNr"])
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("log")["rows"][0]["SentNr"], before["SentNr"])
        qso_lines = [line for line in self.read("export")["content"].splitlines() if line.startswith("QSO:")]
        self.assertEqual(len(qso_lines), 1)
        self.assertIn(str(before["SentNr"]).upper(), qso_lines[0])
        self.assertNotIn("BOB MA", qso_lines[0])

    def test_scoring_dupes_rebuild_export_and_reopen(self):
        first = self.log()
        duplicate = self.log(minute=1)
        self.log(minute=2, frequency=7025000)
        self.log("DL1ABC", "HANS", self.dx_exchange, minute=3)
        score = self.read("score")["score"]
        self.assertEqual((score["qsos"], score["points"], score[self.multiplier_key], score["total"]),
                         (4, 3, 2, 6))

        self.mutate("qso_correct", qsoID=first,
                    fields={"other_1": "ROB", "other_2": self.corrected_exchange},
                    reason="Correct copied exchange")
        row = next(row for row in self.read("log")["rows"] if row["ID"] == first)
        self.assertEqual((row["Name"], row[self.exchange_column]),
                         ("ROB", self.corrected_database_exchange))
        self.assertEqual(str(row["SentNr"]), self.sent_exchange)

        self.mutate("qso_delete", qsoID=first, reason="Wrong contact")
        row = next(row for row in self.read("log")["rows"] if row["ID"] == duplicate)
        self.assertEqual(row["Points"], 1)
        self.assertEqual(self.read("score")["score"]["total"], 6)
        content = self.read("export")["content"]
        self.assertIn(f"CONTEST: {self.cabrillo_name}\r\n", content)
        self.assertIn("CLAIMED-SCORE: 6\r\n", content)
        self.assertTrue(content.endswith("END-OF-LOG:\r\n"))
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"]["total"], 6)

    def test_esm_and_exchange_validation_are_atomic(self):
        self.mutate("run_state", run=True)
        result = self.mutate("esm", field="callsign",
                             fields={"callsign": "K1ABC", "other_1": "", "other_2": ""})
        self.assertEqual([action["key"] for action in result["actions"]], ["F2", "F3"])
        result = self.mutate("esm", field="other_2",
                             fields={"other_1": "ALICE", "other_2": self.first_exchange})
        self.assertEqual([action["key"] for action in result["actions"]], ["F4"])
        self.assertEqual(self.read("log")["total"], 1)
        self.assertEqual({field: self.fields()[field]["value"]
                          for field in ("callsign", "other_1", "other_2")},
                         {"callsign": "", "other_1": "", "other_2": ""})
        for fields in ({"callsign": "DL1ABC", "other_1": "", "other_2": self.dx_exchange},
                       {"callsign": "DL1ABC", "other_1": "HANS", "other_2": " "}):
            revision = self.revision
            with self.assertRaises(HostError):
                self.mutate("qso_commit", fields=fields)
            self.assertEqual(self.read("projection")["projection"]["revision"], revision)


class CWTHostTests(PluginHostMixin, unittest.TestCase):
    plugin_id = "cwt"
    plugin_name = "CWT"
    source_hash = "12010bc2f8a4822e45444c996f82993aea952916405de8449a3ca6fe68c9de64"
    sent_exchange = "OLIVER 1234"
    first_exchange = "100"
    dx_exchange = "DL"
    corrected_exchange = "999"
    corrected_database_exchange = "ROB 999"
    exchange_label = "Number or State"
    exchange_column = "NR"
    multiplier_key = "uniqueCalls"
    cabrillo_name = "CW-OPS"


class K1USNSSTHostTests(PluginHostMixin, unittest.TestCase):
    plugin_id = "k1usn_sst"
    plugin_name = "K1USN SLOW SPEED TEST"
    source_hash = "73cf9b72f53c6bd65d1f804f28b4ea80f6bf82d2b8b08406b2153691fd1d8120"
    sent_exchange = "OLIVER SD"
    first_exchange = "CT"
    dx_exchange = "DX"
    corrected_exchange = "MA"
    corrected_database_exchange = "MA"
    exchange_label = "SPC"
    exchange_column = "Sect"
    multiplier_key = "sections"
    cabrillo_name = "K1USNSST"


if __name__ == "__main__":
    unittest.main()
