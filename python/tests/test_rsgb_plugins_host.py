"""Pinned RSGB 80M CC and Commonwealth BERU plugins through the Python host."""
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Host, HostError
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures


uid = fixtures.uid
CTY = {
    **deepcopy(fixtures.CTY),
    "VE3ABC": {"entity": "Canada", "continent": "NA", "cq": 4, "itu": 9,
               "primary_pfx": "VE"},
    "G3AAA": {"entity": "England", "continent": "EU", "cq": 14, "itu": 27,
              "primary_pfx": "G"},
    "VK3AAA": {"entity": "Australia", "continent": "OC", "cq": 30, "itu": 59,
               "primary_pfx": "VK"},
    "ZL1AAA": {"entity": "New Zealand", "continent": "OC", "cq": 32, "itu": 60,
               "primary_pfx": "ZL"},
}
HASHES = {
    "rsgb_80m_cc": "a849ebe314c4072ff4a684bef909d49c6235a9c3fec585ea9197318331b857ec",
    "rsgb_commonwealth_beru": "2c3cb60a3c1edbb88e29bc39d2ce360ec4144160c1ed6dae420f210fd4037766",
}


class RSGBHostCase:
    plugin_id = ""
    station_call = "OM0RX"
    frequency = 0

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
            "station": {"Call": self.station_call, "GridSquare": "FN03"},
            "frequencyHz": self.frequency,
            "settings": {
                "SentExchange": "#",
                "ModeCategory": "CW",
                "OperatorCategory": "SINGLE-OP",
                "BandCategory": "ALL",
                "PowerCategory": "LOW",
            },
            "reference": {"id": "rsgb-cty-v1", "countries": deepcopy(CTY)},
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

    def log(self, call, exchange, minute, frequency=None):
        qso = uid()
        self.mutate(
            "qso_commit",
            qsoID=qso,
            timestamp=f"2026-10-21 16:{minute:02}:00",
            frequencyHz=frequency or self.frequency,
            fields={"callsign": call, "other_2": exchange},
        )
        return qso

    def assert_source(self):
        source = VENDOR / f"not1mm/plugins/{self.plugin_id}.py"
        self.assertEqual(sha256(source.read_bytes()).hexdigest(), HASHES[self.plugin_id])
        self.assertEqual(load_plugin(self.plugin_id).__file__, str(source))


class RSGB80MCCHostTests(RSGBHostCase, unittest.TestCase):
    plugin_id = "rsgb_80m_cc"
    frequency = 3525000

    def test_source_catalog_projection_validation_and_esm(self):
        self.assert_source()
        catalog = self.host.dispatch({"id": uid(), "method": "catalog", "params": {}})["plugins"]
        item = next(value for value in catalog if value["id"] == self.plugin_id)
        self.assertEqual((item["name"], item["modes"], item["sentExchangeHint"]),
                         ("RSGB 80M CC", ["CW"], "Serial number"))
        projection = self.read("projection")["projection"]
        fields = {field["id"]: field for field in projection["fields"]}
        self.assertEqual((projection["supportedBands"], projection["reservedSerial"]), (["80m"], 1))
        self.assertEqual((fields["other_1"]["label"], fields["other_1"]["value"],
                          fields["other_1"]["readOnly"], fields["other_2"]["label"]),
                         ("SentNR", "001", True, "RcvNR"))

        with self.assertRaisesRegex(HostError, "only 80 metres"):
            self.mutate("qso_commit", frequencyHz=7025000,
                        fields={"callsign": "K1ABC", "other_2": "001"})
        for exchange in ("", "0", "ABC"):
            with self.subTest(exchange=exchange), self.assertRaisesRegex(HostError, "positive serial"):
                self.mutate("qso_commit", fields={"callsign": "K1ABC", "other_2": exchange})

        self.mutate("run_state", run=True)
        call = self.mutate("esm", field="callsign", fields={"callsign": "K1ABC"})
        exchange = self.mutate("esm", field="other_2", fields={"other_2": "001"})
        self.assertEqual([action["key"] for action in call["actions"]], ["F2", "F3"])
        self.assertEqual([action["key"] for action in exchange["actions"]], ["F4"])
        self.assertEqual(self.read("score")["score"]["total"], 1)

    def test_duplicate_correction_delete_restart_and_export(self):
        first = self.log("K1ABC", "001", 0)
        second = self.log("K1ABC", "002", 1)
        rows = {row["ID"]: row for row in self.read("log")["rows"]}
        self.assertEqual((rows[first]["Points"], rows[second]["Points"]), (1, 0))

        self.mutate("qso_correct", qsoID=second, fields={"callsign": "DL1ABC"},
                    reason="Correct callsign")
        self.assertEqual(self.read("score")["score"]["total"], 2)
        self.mutate("qso_delete", qsoID=first, reason="Remove duplicate source")
        self.assertEqual(self.read("score")["score"]["total"], 1)

        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"]["total"], 1)
        export = self.read("export")["content"]
        self.assertIn("CONTEST: RSGB-80M-CC\r\n", export)
        self.assertIn("CLAIMED-SCORE: 1\r\n", export)


class RSGBCommonwealthBERUHostTests(RSGBHostCase, unittest.TestCase):
    plugin_id = "rsgb_commonwealth_beru"
    station_call = "VE3ABC"
    frequency = 3525000

    def test_source_catalog_projection_band_and_exchange_validation(self):
        self.assert_source()
        catalog = self.host.dispatch({"id": uid(), "method": "catalog", "params": {}})["plugins"]
        item = next(value for value in catalog if value["id"] == self.plugin_id)
        self.assertEqual((item["name"], item["modes"], item["sentExchangeHint"]),
                         ("RSGB Commonwealth BERU", ["CW"], "Serial number (optional HQ)"))
        projection = self.read("projection")["projection"]
        self.assertEqual((projection["supportedBands"], projection["reservedSerial"]),
                         (["80m", "40m", "20m", "15m", "10m"], 1))
        with self.assertRaisesRegex(HostError, "80 through 10 metres"):
            self.mutate("qso_commit", frequencyHz=1825000,
                        fields={"callsign": "G3AAA", "other_2": "001"})
        for exchange in ("", "0", "HQ", "001 EXTRA"):
            with self.subTest(exchange=exchange), self.assertRaisesRegex(HostError, "positive serial"):
                self.mutate("qso_commit", fields={"callsign": "G3AAA", "other_2": exchange})
        self.log("K1ABC", "001 HQ", 0)
        row = self.read("log")["rows"][0]
        self.assertEqual((row["NR"], row["Points"], row["IsMultiplier2"]), ("001 HQ", 25, 1))

    def test_esm_commits_serial_and_hq_in_run_and_sandp_with_safe_reset_and_history(self):
        cases = (
            (True, "G3AAA", "101", ["F2", "F3"], ["F4"]),
            (True, "VK3AAA", "102 HQ", ["F2", "F3"], ["F4"]),
            (False, "ZL1AAA", "103", ["F5"], ["F3"]),
            (False, "K1ABC", "104 hq", ["F5"], ["F3"]),
        )
        for index, (run, callsign, received, call_keys, exchange_keys) in enumerate(cases, 1):
            self.mutate("run_state", run=run)
            call = self.mutate("esm", field="callsign", fields={"callsign": callsign})
            self.assertEqual([action["key"] for action in call["actions"]], call_keys)
            committed = self.mutate("esm", field="other_2", fields={"other_2": received})
            self.assertEqual([action["key"] for action in committed["actions"]], exchange_keys)
            self.assertEqual(self.read("log")["total"], index)
            projected = {field["id"]: field["value"] for field in committed["projection"]["fields"]}
            self.assertEqual((projected["callsign"], projected["other_2"], projected["other_1"]),
                             ("", "", f"{index + 1:03}"))

        rows = {row["Call"]: row for row in self.read("log")["rows"]}
        self.assertEqual((rows["G3AAA"]["NR"], rows["VK3AAA"]["NR"],
                          rows["ZL1AAA"]["NR"], rows["K1ABC"]["NR"]),
                         (101, "102 HQ", 103, "104 hq"))

        g3_id = rows["G3AAA"]["ID"]
        self.mutate("qso_correct", qsoID=g3_id, fields={"other_2": "201 HQ"},
                    reason="Correct BERU HQ exchange")
        corrected = next(row for row in self.read("log")["rows"] if row["ID"] == g3_id)
        self.assertEqual(corrected["NR"], "201 HQ")
        audit = self.host.database(self.session).exec_sql(
            "SELECT before_identity_json,after_identity_json FROM xlog_qso_audit "
            "WHERE qso_id=? AND kind='correct' ORDER BY sequence DESC LIMIT 1", (g3_id,))
        before = json.loads(audit["before_identity_json"])["rawFields"]
        after = json.loads(audit["after_identity_json"])["rawFields"]
        self.assertEqual((before["other_2"], after["other_2"]), ("101", "201 HQ"))

        self.mutate("run_state", run=True)
        self.mutate("esm", field="callsign", fields={"callsign": "G3AAA"})
        rejected = self.mutate("esm", field="other_2", fields={"other_2": "105 H"})
        self.assertEqual([action["key"] for action in rejected["actions"]], ["F9"])
        self.assertEqual(self.read("log")["total"], 4)

    def test_original_bonus_reallocation_delete_restart_and_export(self):
        first = self.log("G3AAA", "001", 0)
        self.log("VK3AAA", "002", 1)
        self.log("ZL1AAA", "003", 2)
        self.log("K1ABC", "004 HQ", 3)
        self.assertEqual(self.read("score")["score"], {
            "qsos": 4, "points": 95, "countries": 0, "zones": 0,
            "multipliers": 0, "total": 95,
        })

        self.mutate("qso_delete", qsoID=first, reason="Reallocate per-band bonus")
        self.assertEqual(self.read("score")["score"]["total"], 85)
        rows = sorted(self.read("log")["rows"], key=lambda row: row["TS"])
        self.assertEqual([(row["Points"], row["IsMultiplier2"]) for row in rows],
                         [(30, 1), (30, 1), (25, 1)])

        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"]["total"], 85)
        export = self.read("export")["content"]
        self.assertIn("CONTEST: RSGB-COMMONWEALTH\r\n", export)
        self.assertIn("CLAIMED-SCORE: 85\r\n", export)
        self.assertEqual(len([line for line in export.splitlines() if line.startswith("QSO:")]), 3)


if __name__ == "__main__":
    unittest.main()
