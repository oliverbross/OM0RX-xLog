"""Pinned CQ WPX, NAQP and Weekly RTTY host coverage."""
from copy import deepcopy
from hashlib import sha256
import os
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Host, HostError
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures


uid = fixtures.uid
RTTY_MODES = ["RTTY", "RTTY-R", "LSB-D", "USB-D", "AM-D", "FM-D",
              "DIGI-U", "DIGI-L", "RTTYR", "PKTLSB", "PKTUSB"]
HASHES = {
    "cq_wpx_rtty": "71d8ee0996f91ce3ad0dabaa524aae49bd1197b5313bfeb3d709c15e7b84a351",
    "naqp_rtty": "f74bc7f40d257e0f3db7270c8e7b4bec00d6c50c11af37baa8aaa8a7f3f131c1",
    "weekly_rtty": "595cc4514d88fd3c7d8568bf695366a700b4d08c2a491334958e42702df6d02a",
}


class RTTYHostCase(unittest.TestCase):
    plugin_id = ""
    sent_exchange = ""
    frequency = 14080000

    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve() / "host"
        self.host = Host(self.root)
        self.session, self.workspace, self.revision = uid(), uid(), 0
        self.call("session_create", {
            "sessionID": self.session,
            "workspaceGeneration": self.workspace,
            "operationID": uid(),
            "expectedRevision": 0,
            "pluginID": self.plugin_id,
            "station": {"Call": "OM0RX", "GridSquare": "JN88", "ARRLSection": "DX"},
            "frequencyHz": self.frequency,
            "settings": {
                "SentExchange": self.sent_exchange,
                "ModeCategory": "RTTY",
                "OperatorCategory": "SINGLE-OP",
                "BandCategory": "ALL",
                "PowerCategory": "LOW",
            },
            "reference": {"id": "test-cty-v1", "countries": deepcopy(fixtures.CTY)},
        })

    def tearDown(self):
        self.host.close()
        self.temporary.cleanup()

    def call(self, method, params):
        result = self.host.dispatch({"id": uid(), "method": method, "params": params})
        if "revision" in result:
            self.revision = max(self.revision, result["revision"])
        return result

    def mutate(self, method, **kwargs):
        return self.call(method, {
            "sessionID": self.session,
            "operationID": uid(),
            "expectedRevision": self.revision,
            **kwargs,
        })

    def read(self, method, **kwargs):
        return self.call(method, {"sessionID": self.session, **kwargs})

    def assert_source_mode_macros_and_fldigi_output(self, name):
        source = VENDOR / f"not1mm/plugins/{self.plugin_id}.py"
        self.assertEqual(sha256(source.read_bytes()).hexdigest(), HASHES[self.plugin_id])
        self.assertEqual(load_plugin(self.plugin_id).__file__, str(source))
        catalog = self.host.dispatch({"id": uid(), "method": "catalog", "params": {}})["plugins"]
        item = next(plugin for plugin in catalog if plugin["id"] == self.plugin_id)
        self.assertEqual((item["name"], item["modes"]), (name, RTTY_MODES))
        setup = self.read("setup_get")
        macros = {(macro["mode"], macro["key"]): macro for macro in setup["effectiveMacros"]}
        expected_f3 = "{RST} {SENTNR}" if self.plugin_id == "cq_wpx_rtty" else "{RST} {EXCHANGE}"
        self.assertEqual(macros[("S", "F3")]["template"], expected_f3)
        self.assertEqual(macros[("R", "F6")]["template"], "{SENTNR}")
        self.assertEqual(sha256((VENDOR / "not1mm/data/rttymacros.txt").read_bytes()).hexdigest(),
                         "150d819c00a15c5e70fadce632704e13c220bef88012c7777269b3e1bf0638f9")
        action = self.mutate("function_key", key="F3")["actions"][0]
        self.assertEqual((action["kind"], action["signal"], action["mode"]), ("fldigi", "digital", "RTTY"))
        self.assertEqual((action["nlBefore"], action["rxAfter"]), (True, True))
        with self.assertRaisesRegex(HostError, "does not support CW"):
            self.read("cw_context")


class CQWPXRTTYHostTests(RTTYHostCase):
    def test_external_actual_serial_conflict_and_future_reservations_share_one_ledger(self):
        before=self.read("projection")["projection"]
        packet={"CALL":"K1ABC","MODE":"RTTY","FREQ":"14.080000","QSO_DATE":"20261027","TIME_ON":"081500","STX":"1","SRX":"12","RST_SENT":"599","RST_RCVD":"599"}
        with self.assertRaisesRegex(HostError,"reserved"):
            self.mutate("digital_ingest",workspaceGeneration=self.workspace,semanticIdentity="4"*64,packet=packet)
        packet["STX"]="41"
        first=self.mutate("digital_ingest",workspaceGeneration=self.workspace,semanticIdentity="5"*64,packet=packet)
        self.assertEqual(self.read("log")["rows"][0]["SentNr"],41)
        self.assertEqual(first["projection"]["draftID"],before["draftID"])
        self.assertEqual(first["projection"]["fields"],before["fields"])
        self.assertTrue(self.mutate("digital_ingest",workspaceGeneration=self.workspace,semanticIdentity="5"*64,packet=packet)["digitalDuplicate"])
        self.mutate("qso_commit",timestamp="2026-10-27 08:16:00",fields={"callsign":"DL1ABC","other_2":"13"})
        self.assertEqual(self.read("projection")["projection"]["reservedSerial"],42)

    plugin_id = "cq_wpx_rtty"
    sent_exchange = "IGNORED BY SERIAL OWNER"

    def log(self, call="K1ABC", received="100", minute=0, frequency=14080000):
        qso = uid()
        self.mutate("qso_commit", qsoID=qso, timestamp=f"2026-10-21 08:{minute:02}:00",
                    frequencyHz=frequency, fields={"callsign": call, "other_2": received})
        return qso

    def test_provenance_catalog_serial_macro_esm_scoring_rebuild_restart_and_cabrillo(self):
        self.assert_source_mode_macros_and_fldigi_output("CQ WPX RTTY")
        view = self.read("projection")["projection"]
        fields = {field["id"]: field for field in view["fields"]}
        self.assertEqual(view["supportedBands"], ["80m", "40m", "20m", "15m", "10m"])
        self.assertEqual((fields["other_1"]["label"], fields["other_1"]["value"],
                          fields["other_1"]["readOnly"], fields["other_2"]["label"]),
                         ("SentNR", "001", True, "RcvNR"))
        setup = self.read("setup_get")
        f6 = next(m for m in setup["effectiveMacros"] if m["mode"] == "R" and m["key"] == "F6")
        self.assertEqual(f6["template"], "{SENTNR}")
        with self.assertRaisesRegex(HostError, "reserved by the contest host"):
            self.mutate("draft_apply", fields={"other_1": "999"})
        with self.assertRaisesRegex(HostError, "positive SQLite integers"):
            self.mutate("qso_commit", fields={"callsign": "K1ABC", "other_2": "ABC"})
        with self.assertRaisesRegex(HostError, "80 through 10 metres"):
            self.mutate("draft_apply", frequencyHz=1850000, fields={})
        invalid = self.read("setup_get")["setup"]
        invalid["settings"]["ModeCategory"] = "CW"
        with self.assertRaisesRegex(HostError, "supported RTTY submode"):
            self.mutate("setup_save", setup=invalid)

        first = self.log()
        replay_operation = uid()
        params = {"sessionID": self.session, "operationID": replay_operation,
                  "expectedRevision": self.revision, "qsoID": uid(),
                  "timestamp": "2026-10-21 08:01:00", "frequencyHz": 14080000,
                  "fields": {"callsign": "K1ABC", "other_2": "101"}}
        saved = self.call("qso_commit", params)
        self.assertEqual(saved["actions"], [])
        self.assertTrue(self.call("qso_commit", params)["replayed"])
        self.log("K1ABC", "102", 2, 7080000)
        corrected = self.log("K1ABC", "103", 3)
        self.mutate("qso_correct", qsoID=corrected,
                    fields={"callsign": "DL1ABC", "other_2": "200"}, reason="Correct prefix")
        self.assertEqual(self.read("score")["score"], {
            "qsos": 4, "points": 11, "countries": 0, "zones": 0,
            "prefixes": 2, "multipliers": 2, "total": 22,
        })
        self.mutate("qso_delete", qsoID=first, reason="Delete original")
        ledger = self.host.database(self.session).exec_sql_mult(
            "SELECT serial FROM xlog_serial ORDER BY serial")
        self.assertEqual([row["serial"] for row in ledger], [1, 2, 3, 4, 5])
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"]["total"], 22)
        rows = self.read("log")["rows"]
        self.assertEqual(sorted(row["Points"] for row in rows), [2, 3, 6])
        export = self.read("export")["content"]
        self.assertIn("CONTEST: CQ-WPX-RTTY\r\n", export)
        self.assertIn("CATEGORY-MODE: RTTY\r\n", export)
        self.assertIn("CLAIMED-SCORE: 22\r\n", export)
        self.assertTrue(any(line.startswith("QSO:") and line.split()[2] == "RY" for line in export.splitlines()))

    def test_esm_commits_with_fldigi_output(self):
        self.mutate("esm", field="callsign", fields={"callsign": "K1ABC", "other_2": "100"})
        result = self.mutate("esm", field="other_2", fields={"callsign": "K1ABC", "other_2": "100"})
        self.assertTrue(result["actions"])
        self.assertTrue(all(action["kind"] == "fldigi" for action in result["actions"]))
        self.assertEqual(self.read("log")["total"], 1)


class NameSPCRTTYCase(RTTYHostCase):
    sent_exchange = "OLIVER DX"

    def log(self, call, name, section, minute, frequency=14080000):
        qso = uid()
        self.mutate("qso_commit", qsoID=qso, timestamp=f"2026-10-21 09:{minute:02}:00",
                    frequencyHz=frequency,
                    fields={"callsign": call, "other_1": name, "other_2": section})
        return qso

    def assert_entry_contract(self, contest_name):
        self.assert_source_mode_macros_and_fldigi_output(contest_name)
        fields = {field["id"]: field for field in self.read("projection")["projection"]["fields"]}
        self.assertEqual((fields["sent"]["visible"], fields["receive"]["visible"]), (False, False))
        self.assertEqual((fields["other_1"]["label"], fields["other_2"]["label"]), ("Name", "State" if self.plugin_id == "naqp_rtty" else "SPC"))
        for values in ({"other_1": "", "other_2": "CT"},
                       {"other_1": "JOHN1", "other_2": "CT"},
                       {"other_1": "JOHN", "other_2": ""}):
            with self.subTest(values=values), self.assertRaises(HostError):
                self.mutate("qso_commit", fields={"callsign": "K1ABC", **values})
        self.mutate("esm", field="callsign",
                    fields={"callsign": "K1ABC", "other_1": "JOHN", "other_2": "CT"})
        result = self.mutate("esm", field="other_2",
                             fields={"callsign": "K1ABC", "other_1": "JOHN", "other_2": "CT"})
        self.assertTrue(result["actions"])
        self.assertTrue(all(action["kind"] == "fldigi" for action in result["actions"]))
        self.assertEqual(self.read("log")["total"], 1)
        values = {field["id"]: field["value"] for field in result["projection"]["fields"]}
        self.assertEqual((values["other_1"], values["other_2"]), ("", ""))

    def assert_historical_exchange_survives_correction(self, qso):
        setup = self.read("setup_get")["setup"]
        setup["settings"]["SentExchange"] = "NEWNAME DX"
        self.mutate("setup_save", setup=setup)
        self.mutate("qso_correct", qsoID=qso,
                    fields={"other_1": "JACK", "other_2": "MA"}, reason="Correct exchange")
        row = next(row for row in self.read("log")["rows"] if row["ID"] == qso)
        self.assertEqual((row["Name"], row["Sect"], row["SentNr"]), ("JACK", "MA", "OLIVER DX"))


class NAQPRTTYHostTests(NameSPCRTTYCase):
    plugin_id = "naqp_rtty"

    def test_section_scoring_correction_delete_restart_and_cabrillo(self):
        self.assert_entry_contract("NAQP RTTY")
        first = self.read("log")["rows"][0]["ID"]
        self.log("K1ABC", "JOHN", "CT", 1)
        second_band = self.log("K1ABC", "JOHN", "CT", 2, 7080000)
        self.log("DL1ABC", "HANS", "", 3)
        self.assertEqual(self.read("score")["score"], {
            "qsos": 4, "points": 2, "countries": 0, "zones": 0,
            "sections": 3, "multipliers": 3, "total": 6,
        })
        self.assert_historical_exchange_survives_correction(first)
        self.mutate("qso_delete", qsoID=second_band, reason="Remove second band")
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"]["total"], 3)
        export = self.read("export")["content"]
        self.assertIn("CONTEST: NAQP-RTTY\r\n", export)
        self.assertIn("CLAIMED-SCORE: 3\r\n", export)
        self.assertIn("OLIVER DX", export)


class WeeklyRTTYHostTests(NameSPCRTTYCase):
    plugin_id = "weekly_rtty"

    def test_unique_call_scoring_is_not_naqp_and_relocates(self):
        self.assert_entry_contract("WEEKLY RTTY TEST")
        first = self.read("log")["rows"][0]["ID"]
        self.log("K1ABC", "JOHN", "CT", 1)
        second_band = self.log("K1ABC", "JOHN", "CT", 2, 7080000)
        dl = self.log("DL1ABC", "HANS", "DX", 3)
        self.assertEqual(self.read("score")["score"], {
            "qsos": 4, "points": 3, "countries": 0, "zones": 0,
            "uniqueCalls": 2, "multipliers": 2, "total": 6,
        })
        self.assertNotIn("sections", self.read("score")["score"])
        self.assert_historical_exchange_survives_correction(first)
        self.mutate("qso_delete", qsoID=second_band, reason="Remove second band")
        self.mutate("qso_delete", qsoID=dl, reason="Remove unique call")
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"], {
            "qsos": 2, "points": 1, "countries": 0, "zones": 0,
            "uniqueCalls": 1, "multipliers": 1, "total": 1,
        })
        export = self.read("export")["content"]
        self.assertIn("CONTEST: WRT\r\n", export)
        self.assertIn("CLAIMED-SCORE: 1\r\n", export)
        self.assertIn("OLIVER DX", export)

        with TemporaryDirectory() as directory:
            relocated = Path(directory) / "python"
            shutil.copytree(Path(__file__).resolve().parents[1] / "contest_host", relocated / "contest_host")
            shutil.copytree(Path(__file__).resolve().parents[1] / "vendor", relocated / "vendor")
            environment = {**os.environ, "PYTHONPATH": str(relocated)}
            completed = subprocess.run(
                [sys.executable, "-c", "from contest_host.upstream import load_plugin; print(load_plugin('weekly_rtty').name)"],
                check=True, capture_output=True, text=True, cwd=directory, env=environment,
            )
            self.assertEqual(completed.stdout.strip(), "WEEKLY RTTY TEST")


class RTTYCatalogOrderTests(unittest.TestCase):
    def test_catalog_keeps_rtty_family_order_as_later_plugins_are_added(self):
        with TemporaryDirectory() as directory:
            host = Host(Path(directory).resolve())
            try:
                ids = [item["id"] for item in host.dispatch(
                    {"id": uid(), "method": "catalog", "params": {}})["plugins"]]
            finally:
                host.close()
            self.assertEqual(len(ids), 97)
        self.assertEqual(ids[-3:], ["wae_cw", "wae_ssb", "wae_rtty"])
        ids = ids[:-3]  # Existing 94-profile family order remains exact.
        self.assertEqual(ids[3:6], ["cq_wpx_cw", "cq_wpx_ssb", "cq_wpx_rtty"])
        self.assertEqual(ids[10:15], ["naqp_cw", "naqp_ssb", "naqp_rtty",
                                      "phone_weekly_test", "weekly_rtty"])
        old_tail = ids.index("ari_40_80")
        self.assertEqual(ids[old_tail:old_tail + 5],
                         ["ari_40_80", "ea_rtty", "ok1wc", "ssa_mt_cw", "ssa_mt_ssb"])
        self.assertEqual(ids[old_tail + 5:old_tail + 10],
                         ["dxpedition", "general_logging", "randomgram", "qso_party_rst", "qso_party_sn"])
        self.assertEqual(ids[-20:-15],
                         ["ca_qso_party", "canada_day", "cqws", "darc_schwaben", "winter_field_day"])
        self.assertEqual(ids[-15:-7], ["agcw_qrp", "raem", "rda_contest", "rdxc", "rsgb_iota",
                                      "stew_perry_topband", "ukeidx", "wia_remembrance"])
        self.assertEqual(ids[-7:], ["cq_ww_vhf", "darc_vhf", "john_moyle_field_day",
                                    "labre_rs_digi", "nac_vhf", "ta_vhf_uhf_contest", "vhf_sprint"])


if __name__ == "__main__":
    unittest.main()
