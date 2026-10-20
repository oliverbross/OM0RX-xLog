"""Pinned RSGB 80M CC and Commonwealth BERU plugins through the Python host."""
from copy import deepcopy
from hashlib import sha256
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
